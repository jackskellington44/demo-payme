const API_BASE = (import.meta.env.VITE_API_URL || '').trim();
const AUTH_PATH = '/api/auth';
const RETRY_DELAY_MS = 1000;
const MAX_RETRIES = 1;
const UPLOAD_BASE_TIMEOUT_MS = 180000;
const UPLOAD_TIMEOUT_PER_MB_MS = 8000;
const UPLOAD_MAX_TIMEOUT_MS = 900000;
const DIRECT_UPLOAD_MIN_BYTES = 8 * 1024 * 1024;

function truncateForDebug(value, max = 220) {
  if (!value) return '';
  const str = String(value).replace(/\s+/g, ' ').trim();
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function buildResponseDebugError({ path, status, statusText, contentType, bodyPreview, parseFailure = false, context = 'request' }) {
  const preview = truncateForDebug(bodyPreview);
  const looksLikeHtml = /<!doctype html|<html[\s>]/i.test(preview);
  const parts = [
    `${context} failed`,
    `url=${API_BASE}${path}`,
    `path=${path}`,
    `status=${status}${statusText ? ` ${statusText}` : ''}`,
    `content-type=${contentType || 'unknown'}`,
  ];

  if (parseFailure) {
    parts.push('reason=Expected JSON response but received non-JSON body');
  }
  if (looksLikeHtml) {
    parts.push('hint=Response appears to be HTML (likely wrong route, reverse-proxy rewrite, or SPA fallback)');
  }
  if (bodyPreview) {
    parts.push(`body-preview="${preview}"`);
  }

  return parts.join(' | ');
}

function withEndpointContext(path, errorMessage) {
  const raw = String(errorMessage || 'Unknown API error');
  // Add endpoint context even if lower layers only returned a generic status message.
  return `endpoint=${API_BASE}${path} | ${raw}`;
}

function buildNetworkDebugError(path, err, context = 'API request') {
  const message = String(err?.message || err || 'Network error');
  const online = typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
    ? navigator.onLine
    : 'unknown';
  const origin = typeof window !== 'undefined' && window.location
    ? window.location.origin
    : 'unknown';

  const hints = [];
  const lower = message.toLowerCase();
  if (lower.includes('failed to fetch')) {
    hints.push('Browser could not establish an HTTP response');
    hints.push('Check HTTPS certificate, DNS, ad-blocker/privacy extensions, and CDN/firewall rules');
  }
  if (err?.name === 'AbortError') {
    hints.push('Request timed out or was aborted before the server responded');
  }

  const parts = [
    `${context} network failure`,
    `url=${API_BASE}${path}`,
    `origin=${origin}`,
    `online=${online}`,
    `error=${message}`,
  ];

  if (hints.length) {
    parts.push(`hint=${hints.join('; ')}`);
  }

  return parts.join(' | ');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getUploadTimeoutMs(file) {
  const fileSize = Number(file?.size || 0);
  const fileMb = fileSize > 0 ? Math.ceil(fileSize / (1024 * 1024)) : 0;
  return Math.min(
    UPLOAD_MAX_TIMEOUT_MS,
    UPLOAD_BASE_TIMEOUT_MS + (fileMb * UPLOAD_TIMEOUT_PER_MB_MS)
  );
}

async function tryDirectStorageUpload({ token, fields = {}, file } = {}) {
  if (!file || !fields.bucket || !fields.path || Number(file.size || 0) < DIRECT_UPLOAD_MIN_BYTES) {
    return { skipped: true };
  }

  const presign = await apiFetch('/api/storage/presign-upload', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucket: fields.bucket,
      path: fields.path,
      contentType: file.type || 'application/octet-stream',
      size: file.size || 0,
      upsert: fields.upsert === 'true'
    })
  });

  if (presign.error || !presign.data?.uploadUrl) {
    return { skipped: true, error: presign.error };
  }

  try {
    const res = await fetchWithTimeoutAndRetry(presign.data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    }, getUploadTimeoutMs(file));

    if (!res.ok) {
      const rawText = await res.text().catch(() => '');
      return {
        skipped: true,
        error: buildResponseDebugError({
          path: '/api/storage/presign-upload',
          status: res.status,
          statusText: res.statusText,
          contentType: res.headers.get('content-type') || '',
          bodyPreview: rawText,
          context: 'Direct upload'
        })
      };
    }

    return {
      data: {
        path: presign.data.path || fields.path,
        url: presign.data.url || getPublicObjectUrl(fields.bucket, fields.path)
      },
      error: null
    };
  } catch (err) {
    return { skipped: true, error: buildNetworkDebugError('/api/storage/presign-upload', err, 'Direct upload') };
  }
}

async function fetchWithTimeoutAndRetry(url, options = {}, timeoutMs = 30000) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const requestOptions = { ...options, signal: controller.signal };

    try {
      return await fetch(url, requestOptions);
    } catch (err) {
      const isAbort = err?.name === 'AbortError';
      const isLastAttempt = attempt === MAX_RETRIES;
      if (isAbort || isLastAttempt) throw err;
      await delay(RETRY_DELAY_MS);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw new Error('Request failed');
}

// ─── Token helpers ─────────────────────────────────────────────────────────────

function getToken() {
  return localStorage.getItem('auth_token');
}

function setSession(token, user) {
  localStorage.setItem('auth_token', token);
  localStorage.setItem('auth_user', JSON.stringify(user));
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: 'Bearer ' + token } : {};
}

// ─── Low-level fetch wrapper ───────────────────────────────────────────────────

async function apiFetch(path, options = {}, timeoutMs = 30000) {
  try {
    const res = await fetchWithTimeoutAndRetry(`${API_BASE}${path}`, options, timeoutMs);
    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();
    let json = null;
    if (rawText) {
      try {
        json = JSON.parse(rawText);
      } catch {
        json = null;
      }
    }

    if (!json) {
      return {
        data: null,
        error: buildResponseDebugError({
          path,
          status: res.status,
          statusText: res.statusText,
          contentType,
          bodyPreview: rawText,
          parseFailure: true,
          context: 'API request',
        }),
      };
    }

    if (!res.ok) {
      return {
        data: null,
        error: json.error || buildResponseDebugError({
          path,
          status: res.status,
          statusText: res.statusText,
          contentType,
          bodyPreview: rawText,
          context: 'API request',
        }),
      };
    }
    return json;
  } catch (err) {
    return { data: null, error: buildNetworkDebugError(path, err, 'API request') };
  }
}

// ─── Shared helpers used by supabase-config.js ────────────────────────────────

export async function apiRequest(path, { method = 'GET', token, body } = {}, timeoutMs = 30000) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  try {
    const res = await fetchWithTimeoutAndRetry(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, timeoutMs);
    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();
    let json = {};
    if (rawText) {
      try { json = JSON.parse(rawText); } catch { json = {}; }
    }
    if (!res.ok) {
      return {
        data: null,
        error: json.error || buildResponseDebugError({
          path,
          status: res.status,
          statusText: res.statusText,
          contentType,
          bodyPreview: rawText,
          context: 'API request',
        }),
      };
    }
    if (!json || (typeof json === 'object' && Object.keys(json).length === 0 && rawText)) {
      return {
        data: null,
        error: buildResponseDebugError({
          path,
          status: res.status,
          statusText: res.statusText,
          contentType,
          bodyPreview: rawText,
          parseFailure: true,
          context: 'API request',
        }),
      };
    }
    return json;
  } catch (err) {
    return { data: null, error: buildNetworkDebugError(path, err, 'API request') };
  }
}

export async function apiUpload(path, { token, fields = {}, file } = {}) {
  if (path === '/api/storage/upload') {
    const directResult = await tryDirectStorageUpload({ token, fields, file });
    if (!directResult.skipped) return directResult;
  }

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  if (file) formData.append('file', file);
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  try {
    const res = await fetchWithTimeoutAndRetry(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: formData
    }, getUploadTimeoutMs(file));
    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();
    let json = {};
    if (rawText) {
      try { json = JSON.parse(rawText); } catch { json = {}; }
    }
    if (!res.ok) {
      return {
        data: null,
        error: json.error || buildResponseDebugError({
          path,
          status: res.status,
          statusText: res.statusText,
          contentType,
          bodyPreview: rawText,
          context: 'Upload request',
        }),
      };
    }
    if (!json || (typeof json === 'object' && Object.keys(json).length === 0 && rawText)) {
      return {
        data: null,
        error: buildResponseDebugError({
          path,
          status: res.status,
          statusText: res.statusText,
          contentType,
          bodyPreview: rawText,
          parseFailure: true,
          context: 'Upload request',
        }),
      };
    }
    return json;
  } catch (err) {
    return { data: null, error: buildNetworkDebugError(path, err, 'Upload request') };
  }
}

export function getPublicObjectUrl(bucket, path) {
  return `${API_BASE}/api/storage/public/${encodeURIComponent(bucket)}/${path}`;
}

// ─── API client ────────────────────────────────────────────────────────────────

export const api = {
  auth: {
    signUp: async ({ username, password, pfp }) => {
      const result = await apiFetch(`${AUTH_PATH}/signup`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password, pfp }),
      });
      if (result.error) {
        return { data: null, error: withEndpointContext(`${AUTH_PATH}/signup`, result.error) };
      }
      if (result.data?.token) {
        setSession(result.data.token, result.data.user);
      }
      return result;
    },

    signIn: async ({ username, password }) => {
      const result = await apiFetch(`${AUTH_PATH}/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      });
      if (result.error) {
        return { data: null, error: withEndpointContext(`${AUTH_PATH}/login`, result.error) };
      }
      if (result.data?.token) {
        setSession(result.data.token, result.data.user);
      }
      return result;
    },

    changePassword: async ({ currentPassword, newPassword }) => {
      const result = await apiFetch(`${AUTH_PATH}/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (result.error) {
        return { data: null, error: withEndpointContext(`${AUTH_PATH}/change-password`, result.error) };
      }
      return result;
    },

    signOut: async () => {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
    },

    getUser: async () => {
      const token = getToken();
      if (!token) return { data: null, error: 'Not authenticated' };
      return apiFetch(`${AUTH_PATH}/me`, {
        headers: { ...authHeaders() },
      });
    },

    uploadPfp: async (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch(`${AUTH_PATH}/upload-pfp`, {
        method:  'POST',
        headers: { ...authHeaders() },
        body:    formData,
      });
    },
  },

  worlds: {
    getTheme: async (worldId) => {
      return apiFetch(`/worlds/${encodeURIComponent(worldId)}/theme`);
    },
  },

  users: {
    getByUsername: async (username) => {
      return apiFetch(`/api/users?username=${encodeURIComponent(username)}`);
    },

    getById: async (id) => {
      return apiFetch(`/api/users/${encodeURIComponent(id)}`);
    },
  },
};
