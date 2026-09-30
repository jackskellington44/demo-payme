require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || process.env.AUTH_JWT_SECRET;

// Fail fast on required secrets
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET (or AUTH_JWT_SECRET) environment variable is not set');
  process.exit(1);
}

const express      = require('express');
const cors         = require('cors');
const bcrypt       = require('bcrypt');
const jwt          = require('jsonwebtoken');
const multer       = require('multer');
const rateLimit    = require('express-rate-limit');
const Minio        = require('minio');
const { v4: uuidv4 } = require('uuid');

const pool           = require('./db');
const authMiddleware = require('./middleware/auth');

const app = express();

// ─── Constants ─────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS  = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
const MINIO_USE_SSL  = process.env.MINIO_USE_SSL === 'true';
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const MINIO_PORT     = process.env.MINIO_PORT     || '9000';
const MINIO_BUCKET   = process.env.MINIO_BUCKET   || 'group0-pfps';
const MINIO_PROTOCOL = MINIO_USE_SSL ? 'https' : 'http';
const SLOW_REQUEST_MS = 200;

function getEnvInt(name, fallback, min = 1) {
  const raw = process.env[name];
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, parsed);
}

const MAX_PFP_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_MEDIA_UPLOAD_BYTES = getEnvInt('MAX_MEDIA_UPLOAD_MB', 220) * 1024 * 1024;
const UPLOAD_REQUEST_TIMEOUT_MS = getEnvInt('UPLOAD_REQUEST_TIMEOUT_MS', 10 * 60 * 1000);
const DIRECT_UPLOAD_URL_TTL_SECONDS = getEnvInt('DIRECT_UPLOAD_URL_TTL_SECONDS', 15 * 60);
const ALLOWED_PFP_MIMETYPES = new Set(['image/webp', 'image/gif', 'image/png', 'image/jpeg']);
const MIME_TO_EXT = { 'image/webp': 'webp', 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg' };

function inferPublicObjectContentType(objectKey = '') {
  const normalized = String(objectKey || '').split('?')[0].toLowerCase();
  if (normalized.endsWith('.html')) return 'text/html; charset=utf-8';
  if (normalized.endsWith('.css')) return 'text/css; charset=utf-8';
  if (normalized.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (normalized.endsWith('.json')) return 'application/json; charset=utf-8';
  if (normalized.endsWith('.svg')) return 'image/svg+xml';
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.avif')) return 'image/avif';
  if (normalized.endsWith('.mp4')) return 'video/mp4';
  if (normalized.endsWith('.webm')) return 'video/webm';
  return 'application/octet-stream';
}

// Username: 1–30 chars, letters/digits/underscore/hyphen only
const USERNAME_RE = /^[A-Za-z0-9_-]{1,30}$/;
const MIN_PASSWORD_LENGTH = 6;

// All tables the generic query/mutate endpoints are allowed to touch
const ALLOWED_TABLES = new Set([
  'users', 'posts', 'worlds', 'world_access', 'music_tracks', 'categories',
  'comments', 'notifications', 'post_links'
]);

// MinIO buckets that should exist
const REQUIRED_BUCKETS = [
  MINIO_BUCKET,
  'group0-posts',
  'group0-worlds',
];

// ─── MinIO client ──────────────────────────────────────────────────────────────

const minioClient = new Minio.Client({
  endPoint:  MINIO_ENDPOINT,
  port:      parseInt(MINIO_PORT, 10),
  useSSL:    MINIO_USE_SSL,
  accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
  secretKey: process.env.MINIO_SECRET_KEY || 'changeme',
});

// Auto-create required MinIO buckets on startup (best-effort)
async function ensureBuckets() {
  for (const bucket of REQUIRED_BUCKETS) {
    try {
      const exists = await minioClient.bucketExists(bucket);
      if (!exists) {
        await minioClient.makeBucket(bucket);
        console.log(`Created MinIO bucket: ${bucket}`);
      }
    } catch (err) {
      console.warn(`Could not ensure MinIO bucket "${bucket}": ${err.message}`);
    }
  }
}
ensureBuckets();

// ─── Multer (memory, with size limit) ─────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PFP_BYTES },
});

const uploadAny = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MEDIA_UPLOAD_BYTES }
});

// ─── App middleware ────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (durationMs <= SLOW_REQUEST_MS) return;
    const safeUrl = (req.originalUrl || req.url || '').split('?')[0];
    console.warn(`[slow-request] ${req.method} ${safeUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`);
  });
  next();
});

// ─── Rate limiting ─────────────────────────────────────────────────────────────

const RATE_WINDOW_AUTH_MS = getEnvInt('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60 * 1000);
const RATE_WINDOW_READ_MS = getEnvInt('RATE_LIMIT_READ_WINDOW_MS', 15 * 60 * 1000);
const RATE_WINDOW_MUTATE_MS = getEnvInt('RATE_LIMIT_MUTATE_WINDOW_MS', 60 * 1000);
const RATE_WINDOW_UPLOAD_MS = getEnvInt('RATE_LIMIT_UPLOAD_WINDOW_MS', 60 * 1000);

const RATE_MAX_AUTH = getEnvInt('RATE_LIMIT_AUTH_MAX', 20);
const RATE_MAX_READ = getEnvInt('RATE_LIMIT_READ_MAX', 300);
const RATE_MAX_MUTATE = getEnvInt('RATE_LIMIT_MUTATE_MAX', 180);
const RATE_MAX_UPLOAD = getEnvInt('RATE_LIMIT_UPLOAD_MAX', 90);
const RATE_MAX_PFP_UPLOAD = getEnvInt('RATE_LIMIT_PFP_UPLOAD_MAX', 20);

const authLimiter = rateLimit({
  windowMs: RATE_WINDOW_AUTH_MS,
  max: RATE_MAX_AUTH,
  standardHeaders: true,
  legacyHeaders: false,
  message: { data: null, error: 'Too many requests, please try again later.' },
});

const pfpUploadLimiter = rateLimit({
  windowMs: RATE_WINDOW_AUTH_MS,
  max: RATE_MAX_PFP_UPLOAD,
  standardHeaders: true,
  legacyHeaders: false,
  message: { data: null, error: 'Too many requests, please try again later.' },
});

const mediaUploadLimiter = rateLimit({
  windowMs: RATE_WINDOW_UPLOAD_MS,
  max: RATE_MAX_UPLOAD,
  standardHeaders: true,
  legacyHeaders: false,
  message: { data: null, error: 'Too many requests, please try again later.' },
});

const mutateLimiter = rateLimit({
  windowMs: RATE_WINDOW_MUTATE_MS,
  max: RATE_MAX_MUTATE,
  standardHeaders: true,
  legacyHeaders: false,
  message: { data: null, error: 'Too many requests, please try again later.' },
});

const readLimiter = rateLimit({
  windowMs: RATE_WINDOW_READ_MS,
  max: RATE_MAX_READ,
  standardHeaders: true,
  legacyHeaders: false,
  message: { data: null, error: 'Too many requests, please try again later.' },
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function safeUser(row) {
  return { id: row.id, username: row.username, pfp: row.pfp, pfp_url: row.pfp_url };
}

// Build WHERE conditions + values array from a filters array.
// Supports eq, in, is operators.
function buildWhereClause(filters, startIdx = 1) {
  const conditions = [];
  const values = [];
  let idx = startIdx;

  for (const f of (filters || [])) {
    if (f.operator === 'eq') {
      conditions.push(`"${f.column}" = $${idx++}`);
      values.push(f.value);
    } else if (f.operator === 'in') {
      if (!Array.isArray(f.value) || f.value.length === 0) {
        // IN () is invalid SQL — produce a never-true condition
        conditions.push('FALSE');
      } else {
        const placeholders = f.value.map(() => `$${idx++}`).join(', ');
        conditions.push(`"${f.column}" IN (${placeholders})`);
        values.push(...f.value);
      }
    } else if (f.operator === 'is') {
      if (f.value === null) {
        conditions.push(`"${f.column}" IS NULL`);
      } else {
        conditions.push(`"${f.column}" = $${idx++}`);
        values.push(f.value);
      }
    }
  }

  return { conditions, values };
}

// ─── POST /auth/signup ─────────────────────────────────────────────────────────

app.post(['/auth/signup', '/api/auth/signup'], authLimiter, async (req, res) => {
  const { username, password, pfp, pfp_url } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ data: null, error: 'username and password are required' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ data: null, error: 'Username must be 1–30 characters and may only contain letters, numbers, underscores, or hyphens' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ data: null, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  try {
    const { rows: existing } = await pool.query(
      'SELECT id FROM public.users WHERE username = $1',
      [username]
    );
    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const id  = uuidv4();
    const now = new Date().toISOString();

    await pool.query(
      `INSERT INTO public.users (id, username, password_hash, pfp, pfp_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, username, passwordHash, pfp || null, pfp_url || null, now, now]
    );

    const user  = { id, username, pfp: pfp || null, pfp_url: pfp_url || null };
    const token = signToken(user);

    return res.status(201).json({ data: { token, user }, error: null });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
});

// ─── POST /auth/login ──────────────────────────────────────────────────────────

app.post(['/auth/login', '/api/auth/login', '/api/auth/signin'], authLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ data: null, error: 'username and password are required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, username, password_hash, pfp, pfp_url FROM public.users WHERE username = $1',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ data: null, error: 'Username not found' });
    }

    const row   = rows[0];
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) {
      return res.status(401).json({ data: null, error: 'Incorrect password' });
    }

    const user  = safeUser(row);
    const token = signToken(user);

    return res.json({ data: { token, user }, error: null });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
});

// ─── GET /auth/me ──────────────────────────────────────────────────────────────

app.get(['/auth/me', '/api/auth/me'], readLimiter, authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, pfp, pfp_url FROM public.users WHERE id = $1',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: 'User not found' });
    }

    return res.json({ data: { user: safeUser(rows[0]) }, error: null });
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
});

// ─── POST /auth/change-password ───────────────────────────────────────────────

app.post(['/auth/change-password', '/api/auth/change-password'], authLimiter, authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ data: null, error: 'currentPassword and newPassword are required' });
  }

  if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ data: null, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  if (String(currentPassword) === String(newPassword)) {
    return res.status(400).json({ data: null, error: 'New password must be different from current password' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, password_hash FROM public.users WHERE id = $1',
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ data: null, error: 'User not found' });
    }

    const currentRow = rows[0];
    const isMatch = await bcrypt.compare(String(currentPassword), currentRow.password_hash || '');
    if (!isMatch) {
      return res.status(401).json({ data: null, error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
    await pool.query(
      'UPDATE public.users SET password_hash = $1, updated_at = $2 WHERE id = $3',
      [passwordHash, new Date().toISOString(), req.user.id]
    );

    return res.json({ data: { success: true }, error: null });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
});

// ─── POST /auth/upload-pfp ─────────────────────────────────────────────────────

app.post(['/auth/upload-pfp', '/api/auth/upload-pfp'], pfpUploadLimiter, authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ data: null, error: 'No file uploaded' });
  }

  if (!ALLOWED_PFP_MIMETYPES.has(req.file.mimetype)) {
    return res.status(400).json({ data: null, error: 'Profile picture must be webp, gif, png, or jpeg' });
  }

  if (req.file.size > MAX_PFP_BYTES) {
    return res.status(400).json({ data: null, error: 'Profile picture must be 2 MB or smaller' });
  }

  const ext       = MIME_TO_EXT[req.file.mimetype];
  const objectKey = `${req.user.id}.${ext}`;

  try {
    await minioClient.putObject(MINIO_BUCKET, objectKey, req.file.buffer, req.file.size, {
      'Content-Type': req.file.mimetype,
    });

    const url = `${MINIO_PROTOCOL}://${MINIO_ENDPOINT}:${MINIO_PORT}/${MINIO_BUCKET}/${objectKey}`;

    await pool.query(
      'UPDATE public.users SET pfp_url = $1, updated_at = $2 WHERE id = $3',
      [url, new Date().toISOString(), req.user.id]
    );

    return res.json({ data: { url }, error: null });
  } catch (err) {
    console.error('Upload pfp error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
});

// ─── GET /worlds/:id/theme ─────────────────────────────────────────────────────

app.get('/worlds/:id/theme', readLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, background_url, font_family, font_color, ui_color FROM public.worlds WHERE id = $1',
      [req.params.id]
    );

    return res.json({ data: rows[0] || null, error: null });
  } catch (err) {
    console.error('World theme error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
});

// ─── GET /users ────────────────────────────────────────────────────────────────

async function handleGetUserByUsername(req, res) {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ data: null, error: 'username query param is required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, username, pfp, pfp_url FROM public.users WHERE username = $1',
      [username]
    );

    return res.json({ data: rows[0] || null, error: null });
  } catch (err) {
    console.error('Get user by username error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
}

app.get('/users', readLimiter, handleGetUserByUsername);
app.get('/api/users', readLimiter, handleGetUserByUsername);

// ─── GET /users/:id ────────────────────────────────────────────────────────────

async function handleGetUserById(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, pfp, pfp_url FROM public.users WHERE id = $1',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: 'User not found' });
    }

    return res.json({ data: safeUser(rows[0]), error: null });
  } catch (err) {
    console.error('Get user by id error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
}

app.get('/users/:id', readLimiter, handleGetUserById);
app.get('/api/users/:id', readLimiter, handleGetUserById);

// ─── POST /api/db/query ────────────────────────────────────────────────────────

app.post('/api/db/query', readLimiter, authMiddleware, async (req, res) => {
  const { table, select, filters, or, order = [], limit, range, single, maybeSingle } = req.body || {};

  if (!table) return res.status(400).json({ data: null, error: 'table is required' });
  if (!ALLOWED_TABLES.has(table)) {
    return res.status(400).json({ data: null, error: `Unknown table: ${table}` });
  }

  try {
    const cols = (select && select !== '*')
      ? select.split(',').map(c => `"${c.trim()}"`).join(', ')
      : '*';

    const { conditions, values } = buildWhereClause(filters);

    // Soft-delete: automatically exclude deleted posts
    if (table === 'posts') conditions.push('"deleted_at" IS NULL');

    let sql = `SELECT ${cols} FROM public."${table}"`;
    if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;

    if (order.length) {
      const orderClauses = order.map(o => `"${o.column}" ${o.ascending !== false ? 'ASC' : 'DESC'}`);
      sql += ` ORDER BY ${orderClauses.join(', ')}`;
    }

    if (limit != null) sql += ` LIMIT ${parseInt(limit, 10)}`;
    if (range != null) {
      const from = parseInt(range.from, 10);
      const to   = parseInt(range.to, 10);
      sql += ` LIMIT ${to - from + 1} OFFSET ${from}`;
    }

    const { rows } = await pool.query(sql, values);

    if (single) {
      if (rows.length === 0) return res.status(406).json({ data: null, error: 'No rows found' });
      return res.json({ data: rows[0], error: null });
    }
    if (maybeSingle) {
      return res.json({ data: rows[0] || null, error: null });
    }
    return res.json({ data: rows, error: null });
  } catch (err) {
    console.error('DB query error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
});

// ─── POST /api/db/mutate ───────────────────────────────────────────────────────

app.post('/api/db/mutate', mutateLimiter, authMiddleware, async (req, res) => {
  const { table, action, values: mutValues, filters, select, single, maybeSingle } = req.body || {};

  if (!table) return res.status(400).json({ data: null, error: 'table is required' });
  if (!action) return res.status(400).json({ data: null, error: 'action is required' });
  if (!ALLOWED_TABLES.has(table)) {
    return res.status(400).json({ data: null, error: `Unknown table: ${table}` });
  }

  try {
    let sql = '';
    let values = [];

    if (action === 'insert') {
      const inputRows = Array.isArray(mutValues) ? mutValues : [mutValues];
      const keys = Object.keys(inputRows[0]);
      const colNames = keys.map(k => `"${k}"`).join(', ');
      const rowPlaceholders = inputRows.map((row) => {
        return '(' + keys.map((k) => {
          values.push(row[k]);
          return `$${values.length}`;
        }).join(', ') + ')';
      });
      sql = `INSERT INTO public."${table}" (${colNames}) VALUES ${rowPlaceholders.join(', ')}`;

    } else if (action === 'update') {
      const keys = Object.keys(mutValues);
      const setClauses = keys.map(k => {
        values.push(mutValues[k]);
        return `"${k}" = $${values.length}`;
      });
      sql = `UPDATE public."${table}" SET ${setClauses.join(', ')}`;

      const { conditions: whereConds, values: whereVals } = buildWhereClause(filters, values.length + 1);
      values = values.concat(whereVals);
      if (whereConds.length) sql += ` WHERE ${whereConds.join(' AND ')}`;

    } else if (action === 'delete') {
      const { conditions: whereConds, values: whereVals } = buildWhereClause(filters);
      values = whereVals;

      if (whereConds.length === 0) {
        // Safety: never allow an unfiltered delete
        return res.status(400).json({ data: null, error: 'Delete requires at least one filter' });
      }

      if (table === 'posts') {
        // Soft delete: set deleted_at instead of removing the row
        sql = `UPDATE public."posts" SET "deleted_at" = NOW() WHERE ${whereConds.join(' AND ')} AND "deleted_at" IS NULL`;
      } else {
        sql = `DELETE FROM public."${table}" WHERE ${whereConds.join(' AND ')}`;
      }

    } else {
      return res.status(400).json({ data: null, error: `Unknown action: ${action}` });
    }

    if (select && action !== 'delete') {
      const cols = (select && select !== '*')
        ? select.split(',').map(c => `"${c.trim()}"`).join(', ')
        : '*';
      sql += ` RETURNING ${cols}`;
    }

    const result = await pool.query(sql, values);
    const rows = result.rows || [];

    if (single)      return res.json({ data: rows[0] || null, error: null });
    if (maybeSingle) return res.json({ data: rows[0] || null, error: null });
    return res.json({ data: select ? rows : null, error: null });
  } catch (err) {
    console.error('DB mutate error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
});

// ─── POST /api/storage/upload ──────────────────────────────────────────────────

app.post('/api/storage/presign-upload', mediaUploadLimiter, authMiddleware, async (req, res) => {
  const { bucket = 'uploads', path, contentType = 'application/octet-stream', size = 0 } = req.body || {};
  const fileSize = Number(size || 0);

  if (!path) return res.status(400).json({ data: null, error: 'path is required' });
  if (fileSize > MAX_MEDIA_UPLOAD_BYTES) {
    return res.status(413).json({
      data: null,
      error: `Upload is too large. Max is ${Math.floor(MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024))} MB.`
    });
  }

  try {
    const uploadUrl = await minioClient.presignedPutObject(bucket, path, DIRECT_UPLOAD_URL_TTL_SECONDS);
    const url = `${MINIO_PROTOCOL}://${MINIO_ENDPOINT}:${MINIO_PORT}/${bucket}/${path}`;
    return res.json({ data: { path, url, uploadUrl, contentType }, error: null });
  } catch (err) {
    console.error('Storage presign error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
});

function handleUploadMulterError(err, req, res, next) {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      data: null,
      error: `Upload is too large. Max is ${Math.floor(MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024))} MB.`
    });
  }
  return res.status(400).json({ data: null, error: err.message || 'Upload failed.' });
}

function setUploadRequestTimeout(req, res, next) {
  req.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS);
  res.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS);
  next();
}

app.post('/api/storage/upload', mediaUploadLimiter, authMiddleware, setUploadRequestTimeout, uploadAny.single('file'), handleUploadMulterError, async (req, res) => {
  if (!req.file) return res.status(400).json({ data: null, error: 'No file uploaded' });

  const bucket  = req.body.bucket || 'uploads';
  const path    = req.body.path   || `${uuidv4()}-${req.file.originalname}`;

  try {
    await minioClient.putObject(bucket, path, req.file.buffer, req.file.size, {
      'Content-Type': req.file.mimetype,
    });
    const url = `${MINIO_PROTOCOL}://${MINIO_ENDPOINT}:${MINIO_PORT}/${bucket}/${path}`;
    return res.json({ data: { path, url }, error: null });
  } catch (err) {
    console.error('Storage upload error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
});

// ─── POST /api/storage/list ────────────────────────────────────────────────────

app.post('/api/storage/list', readLimiter, authMiddleware, async (req, res) => {
  const { bucket, prefix = '' } = req.body || {};
  if (!bucket) return res.status(400).json({ data: null, error: 'bucket is required' });

  try {
    const objects = [];
    await new Promise((resolve, reject) => {
      const stream = minioClient.listObjects(bucket, prefix, false);
      stream.on('data', obj => objects.push(obj));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    return res.json({ data: objects, error: null });
  } catch (err) {
    console.error('Storage list error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
});

// ─── POST /api/storage/remove ─────────────────────────────────────────────────

app.post('/api/storage/remove', mediaUploadLimiter, authMiddleware, async (req, res) => {
  const { bucket, paths = [] } = req.body || {};
  if (!bucket) return res.status(400).json({ data: null, error: 'bucket is required' });

  try {
    await minioClient.removeObjects(bucket, paths);
    return res.json({ data: null, error: null });
  } catch (err) {
    console.error('Storage remove error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
});

// ─── GET /api/storage/public/:bucket/* ────────────────────────────────────────

app.get('/api/storage/public/:bucket/*', async (req, res) => {
  const bucket    = req.params.bucket;
  const objectKey = req.params[0];

  try {
    let stat = null;
    try {
      stat = await minioClient.statObject(bucket, objectKey);
    } catch {
      stat = null;
    }

    const meta = stat?.metaData || {};
    const contentType = meta['content-type'] || meta['Content-Type'] || inferPublicObjectContentType(objectKey);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', bucket === 'worlds' ? 'no-store' : 'public, max-age=3600');
    if (stat?.size) res.setHeader('Content-Length', String(stat.size));

    const stream = await minioClient.getObject(bucket, objectKey);
    stream.pipe(res);
  } catch (err) {
    console.error('Storage get public error:', err);
    return res.status(404).json({ data: null, error: 'Object not found' });
  }
});

function normalizeWorldPasswordMode(mode = 'view') {
  return String(mode || 'view').toLowerCase() === 'edit' ? 'edit' : 'view';
}

const tableColumnCache = new Map();

async function getTableColumns(tableName) {
  const normalizedTable = String(tableName || '').trim();
  if (!normalizedTable) return new Set();
  if (tableColumnCache.has(normalizedTable)) return tableColumnCache.get(normalizedTable);

  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [normalizedTable]
  );
  const columns = new Set((result.rows || []).map((row) => row.column_name));
  tableColumnCache.set(normalizedTable, columns);
  return columns;
}

async function hasColumns(tableName, columnNames = []) {
  const columns = await getTableColumns(tableName);
  return columnNames.every((columnName) => columns.has(columnName));
}

async function hasSplitWorldPasswordColumns() {
  return hasColumns('worlds', [
    'view_password_hash',
    'edit_password_hash',
    'view_password_updated_at',
    'edit_password_updated_at'
  ]);
}

async function hasSplitWorldAccessColumns() {
  return hasColumns('world_access', ['view_unlocked_at', 'edit_unlocked_at']);
}

function getWorldPasswordHash(row, mode = 'view') {
  const normalizedMode = normalizeWorldPasswordMode(mode);
  if (normalizedMode === 'edit') {
    return row?.edit_password_hash || row?.password_hash || null;
  }
  return row?.view_password_hash || row?.password_hash || null;
}

async function verifyWorldPassword(worldId, password, mode = 'view') {
  const normalizedMode = normalizeWorldPasswordMode(mode);
  const hasSplitColumns = await hasSplitWorldPasswordColumns();
  const selectColumns = hasSplitColumns
    ? 'password_hash, view_password_hash, edit_password_hash'
    : 'password_hash';
  const result = await pool.query(
    `SELECT ${selectColumns} FROM public.worlds WHERE id = $1`,
    [worldId]
  );
  const hash = getWorldPasswordHash(result.rows[0], normalizedMode);
  if (!hash) return false;
  return bcrypt.compare(String(password || ''), hash);
}

async function grantWorldAccess(userId, worldId, password, mode = 'view') {
  const normalizedMode = normalizeWorldPasswordMode(mode);
  const allowed = await verifyWorldPassword(worldId, password, normalizedMode);
  if (!allowed) return false;

  if (await hasSplitWorldAccessColumns()) {
    const columnName = normalizedMode === 'edit' ? 'edit_unlocked_at' : 'view_unlocked_at';

    await pool.query(
      `INSERT INTO public.world_access (user_id, world_id, unlocked_at, ${columnName})
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (user_id, world_id)
       DO UPDATE SET unlocked_at = EXCLUDED.unlocked_at, ${columnName} = EXCLUDED.${columnName}`,
      [userId, worldId]
    );

    return true;
  }

  await pool.query(
    `INSERT INTO public.world_access (user_id, world_id, unlocked_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, world_id)
     DO UPDATE SET unlocked_at = EXCLUDED.unlocked_at`,
    [userId, worldId]
  );

  return true;
}

async function setWorldPassword(userId, worldId, options = {}) {
  const hasLegacyPassword = Object.prototype.hasOwnProperty.call(options, 'password');
  const hasViewPassword = Object.prototype.hasOwnProperty.call(options, 'viewPassword');
  const hasEditPassword = Object.prototype.hasOwnProperty.call(options, 'editPassword');
  const viewPassword = String((hasViewPassword ? options.viewPassword : options.password) || '').trim();
  const editPassword = String((hasEditPassword ? options.editPassword : options.password) || '').trim();
  const viewIsPublic = Boolean(options.viewIsPublic);
  const editIsPublic = Boolean(options.editIsPublic);

  const updates = [];
  const values = [];
  const pushUpdate = (sql, value) => {
    values.push(value);
    updates.push(sql.replace('?', `$${values.length}`));
  };

  const hasSplitColumns = await hasSplitWorldPasswordColumns();

  if (!hasSplitColumns) {
    const legacyPassword = viewPassword || editPassword;
    if (!viewIsPublic || !editIsPublic) {
      if (!legacyPassword) return true;
      pushUpdate('password_hash = ?', await bcrypt.hash(legacyPassword, BCRYPT_ROUNDS));
    } else if (hasLegacyPassword || hasViewPassword || hasEditPassword) {
      updates.push('password_hash = NULL');
    }

    if (!updates.length) return true;

    values.push(worldId, userId);
    const result = await pool.query(
      `UPDATE public.worlds
       SET ${updates.join(', ')}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}`,
      values
    );

    return result.rowCount > 0;
  }

  if (viewIsPublic) {
    updates.push('view_password_hash = NULL', 'view_password_updated_at = NOW()');
  } else if (viewPassword) {
    pushUpdate('view_password_hash = ?', await bcrypt.hash(viewPassword, BCRYPT_ROUNDS));
    updates.push('view_password_updated_at = NOW()');
  } else if (hasLegacyPassword) {
    updates.push('view_password_hash = NULL', 'view_password_updated_at = NOW()');
  }

  if (editIsPublic) {
    updates.push('edit_password_hash = NULL', 'edit_password_updated_at = NOW()');
  } else if (editPassword) {
    pushUpdate('edit_password_hash = ?', await bcrypt.hash(editPassword, BCRYPT_ROUNDS));
    updates.push('edit_password_updated_at = NOW()');
  } else if (hasLegacyPassword) {
    updates.push('edit_password_hash = NULL', 'edit_password_updated_at = NOW()');
  }

  if (hasLegacyPassword) {
    const legacyPassword = viewPassword || editPassword;
    if (legacyPassword) {
      pushUpdate('password_hash = ?', await bcrypt.hash(legacyPassword, BCRYPT_ROUNDS));
    } else {
      updates.push('password_hash = NULL');
    }
  }

  if (!updates.length) return true;

  values.push(worldId, userId);
  const result = await pool.query(
    `UPDATE public.worlds
     SET ${updates.join(', ')}
     WHERE id = $${values.length - 1} AND user_id = $${values.length}`,
    values
  );

  return result.rowCount > 0;
}

// ─── POST /api/rpc/:name ───────────────────────────────────────────────────────

app.post('/api/rpc/:name', readLimiter, async (req, res) => {
  const fnName = req.params.name;
  const args   = req.body || {};

  const PUBLIC_RPCS = new Set(['verify_world_password']);
  const AUTH_RPCS = new Set(['set_world_password', 'grant_world_access']);
  if (!PUBLIC_RPCS.has(fnName) && !AUTH_RPCS.has(fnName)) {
    return res.status(400).json({ data: null, error: `Unknown RPC: ${fnName}` });
  }

  const executeWorldRpc = async () => {
    try {
      const worldId = args.p_world_id || args.world_id;
      const password = args.p_password ?? args.password ?? '';
      const mode = args.p_mode ?? args.mode ?? 'view';
      if (!worldId) {
        return res.status(400).json({ data: null, error: 'world id is required' });
      }

      if (fnName === 'verify_world_password') {
        const data = await verifyWorldPassword(worldId, password, mode);
        return res.json({ data, error: null });
      }

      if (fnName === 'grant_world_access') {
        const data = await grantWorldAccess(req.user.id, worldId, password, mode);
        return res.json({ data, error: null });
      }

      if (fnName === 'set_world_password') {
        const passwordOptions = {
          viewIsPublic: args.p_view_public ?? args.view_public,
          editIsPublic: args.p_edit_public ?? args.edit_public
        };
        if (Object.prototype.hasOwnProperty.call(args, 'p_password') || Object.prototype.hasOwnProperty.call(args, 'password')) {
          passwordOptions.password = password;
        }
        if (Object.prototype.hasOwnProperty.call(args, 'p_view_password') || Object.prototype.hasOwnProperty.call(args, 'view_password')) {
          passwordOptions.viewPassword = args.p_view_password ?? args.view_password;
        }
        if (Object.prototype.hasOwnProperty.call(args, 'p_edit_password') || Object.prototype.hasOwnProperty.call(args, 'edit_password')) {
          passwordOptions.editPassword = args.p_edit_password ?? args.edit_password;
        }
        const data = await setWorldPassword(req.user.id, worldId, passwordOptions);
        return res.json({ data, error: null });
      }

      return res.status(400).json({ data: null, error: `Unknown RPC: ${fnName}` });
    } catch (err) {
      console.error(`RPC ${fnName} error:`, err);
      return res.status(500).json({ data: null, error: err.message });
    }
  };

  if (fnName === 'verify_world_password') {
    return executeWorldRpc();
  }

  if (fnName === 'grant_world_access' || fnName === 'set_world_password') {
    return authMiddleware(req, res, executeWorldRpc);
  }

  const executeRpc = async () => {
    try {
      const keys   = Object.keys(args);
      const params = keys.map(k => args[k]);
      const named  = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
      const sql    = `SELECT * FROM ${fnName}(${named})`;
      const result = await pool.query(sql, params);
      return res.json({ data: result.rows[0] || null, error: null });
    } catch (err) {
      console.error(`RPC ${fnName} error:`, err);
      return res.status(500).json({ data: null, error: err.message });
    }
  };

  if (AUTH_RPCS.has(fnName)) {
    return authMiddleware(req, res, executeRpc);
  }

  return executeRpc();
});

// ─── POST /api/admin/purge-deleted-posts ──────────────────────────────────────

app.post('/api/admin/purge-deleted-posts', authLimiter, async (req, res) => {
  const purgeSecret = req.headers['x-purge-secret'];
  if (!purgeSecret || purgeSecret !== process.env.PURGE_SECRET) {
    return res.status(403).json({ data: null, error: 'Forbidden' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM public."posts" WHERE "deleted_at" < NOW() - INTERVAL '24 hours'`
    );
    return res.json({ data: { deleted: result.rowCount }, error: null });
  } catch (err) {
    console.error('Purge deleted posts error:', err);
    return res.status(500).json({ data: null, error: err.message });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3001', 10);
const server = app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
server.requestTimeout = Math.max(server.requestTimeout || 0, UPLOAD_REQUEST_TIMEOUT_MS);
server.headersTimeout = Math.max(server.headersTimeout || 0, UPLOAD_REQUEST_TIMEOUT_MS + 5000);
