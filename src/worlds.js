import JSZip from 'jszip';
import { attachFakePasswordInput, getFakePasswordValue, setFakePasswordValue } from './password-mask.js';

const WORLD_BUCKET = 'worlds';
const WORLD_QUERY_PARAM = 'world';
const MY_WORLDS_STORAGE_PREFIX = 'demo0-my-worlds-v1';
const WORLD_GUEST_ACCESS_STORAGE_PREFIX = 'demo0-world-guest-access-v1';
const OPTIONAL_UPDATES_DISABLED_STORAGE_KEY = 'demo0-updates-table-disabled-v1';
const MY_WORLDS_LIMIT = 48;
const MAIN_WORLD_LABEL = '4thworld';
const MAIN_WORLD_USERNAME = 'cu!>.<later';
const DEFAULT_LOADER_TINT = '23, 27, 34';
const DEFAULT_UI_COLOR = '#cfd8e3';
const DEFAULT_WORLD_TITLE = 'untitled world';
const WORLD_BG_MAX_WIDTH = 2560;
const WORLD_BG_MAX_HEIGHT = 1440;
const WORLD_BG_TARGET_TYPE = 'image/webp';
const WORLD_BG_TARGET_QUALITY = 0.82;
const WORLD_COVER_MAX_WIDTH = 640;
const WORLD_COVER_MAX_HEIGHT = 640;
const WORLD_COVER_TARGET_TYPE = 'image/webp';
const WORLD_COVER_TARGET_QUALITY = 0.74;
const WORLD_COVER_MAX_STATIC_BYTES = 2 * 1024 * 1024;
const WORLD_COVER_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const WORLD_UI_ASSET_MAX_PNGS = 20;
const WORLD_UI_ASSET_MAX_JPEGS = 4;
const WORLD_UI_ASSET_MAX_VIDEOS = 2;
const WORLD_UI_ASSET_MAX_PNG_BYTES = 2 * 1024 * 1024;
const WORLD_UI_ASSET_MAX_JPEG_BYTES = 4 * 1024 * 1024;
const WORLD_UI_ASSET_MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const WORLD_UI_ASSET_MAX_TOTAL_BYTES = 180 * 1024 * 1024;
const PASSWORD_MASK_PLACEHOLDER = '#**^%**+!@*!+^%**+!*%';

function getWorldPathSlug(world) {
  const rawName = String(world?.name || '').trim();
  const slug = rawName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || String(world?.id || '').trim();
}

function normalizeWorldPathSegment(value = '') {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

const WORLD_COVER_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif'
]);

const WORLD_FONTS = [
  { value: "'Liberation Sans', Arial, sans-serif", label: 'Liberation Sans' },
  { value: "'Liberation Mono', 'Courier New', monospace", label: 'Liberation Mono' },
  { value: "'Liberation Serif', 'Times New Roman', serif", label: 'Liberation Serif' },
  { value: "'Linux Biolinum G', 'Liberation Sans', Arial, sans-serif", label: 'Linux Biolinum G' }
];

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeStorageName(fileName = 'asset') {
  return String(fileName)
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '') || 'asset';
}

function getErrorMessage(error, fallback = 'Unknown error.') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;

  const detail = [error.message, error.error_description, error.details, error.hint]
    .map((value) => String(value || '').trim())
    .find(Boolean);

  if (detail) return detail;

  const code = String(error.code || error.status || '').trim();
  if (code) {
    return `Request failed (${code}).`;
  }

  return fallback;
}

function getFileExtension(fileName = '') {
  const parts = String(fileName || '').split('.');
  return parts.length > 1 ? String(parts.pop() || '').toLowerCase() : '';
}

function guessFileExtensionFromMime(mime = '') {
  const normalized = String(mime || '').toLowerCase();
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/avif') return 'avif';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/heic') return 'heic';
  if (normalized === 'image/heif') return 'heif';
  return 'jpg';
}

function guessMimeFromFileName(fileName = '') {
  const ext = getFileExtension(fileName);
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  return '';
}

function getFileNameFromUrl(url, fallbackBase = 'background') {
  try {
    const parsed = new URL(String(url || ''), window.location.origin);
    const lastSegment = parsed.pathname.split('/').pop() || '';
    const safe = normalizeStorageName(lastSegment);
    if (safe && safe !== 'asset') return safe;
  } catch {
    // Ignore parse failures; fallback below.
  }

  return `${fallbackBase}.jpg`;
}

function clampImageDimensions(width, height, maxWidth, maxHeight) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const scale = Math.min(1, maxWidth / safeWidth, maxHeight / safeHeight);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale))
  };
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image for optimization.'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode optimized image.'));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function isRateLimitedError(error) {
  if (!error) return false;
  const status = Number(error.status || error.code || 0);
  if (status === 429) return true;

  const message = getErrorMessage(error, '').toLowerCase();
  return message.includes('too many requests')
    || message.includes('rate limit')
    || message.includes('status 429')
    || message.includes('http 429');
}

async function withRateLimitRetry(task, options = {}) {
  const {
    retries = 4,
    baseDelayMs = 500,
    maxDelayMs = 6000
  } = options;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRateLimitedError(error)) {
        throw error;
      }

      const backoff = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
      const jitter = Math.floor(Math.random() * 180);
      await sleep(backoff + jitter);
    }
  }

  throw lastError || new Error('Request failed after retries.');
}

async function normalizeWorldImageFile(file) {
  const mime = String(file?.type || '').toLowerCase();
  const ext = getFileExtension(file?.name || '');
  if (mime === 'image/heic' || mime === 'image/heif' || ext === 'heic' || ext === 'heif') {
    const heic2anyModule = await import('heic2any');
    const heic2any = heic2anyModule.default || heic2anyModule;
    const converted = await heic2any({
      blob: file,
      toType: 'image/jpeg'
    });
    const convertedBlob = Array.isArray(converted) ? converted[0] : converted;
    const baseName = String(file.name || 'background').replace(/\.[^.]+$/, '');
    return new File([convertedBlob], `${baseName}.jpg`, { type: 'image/jpeg' });
  }

  return file;
}

async function optimizeWorldImageToWebp(file, options = {}) {
  const {
    maxWidth,
    maxHeight,
    targetType,
    targetQuality,
    maxOutputBytes = Infinity
  } = options;

  const decoded = await loadImageFromBlob(file);
  const { width, height } = clampImageDimensions(
    decoded.naturalWidth || decoded.width,
    decoded.naturalHeight || decoded.height,
    maxWidth,
    maxHeight
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return file;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(decoded, 0, 0, width, height);

  const qualitySteps = [
    targetQuality,
    Math.max(0.68, targetQuality - 0.06),
    Math.max(0.62, targetQuality - 0.12),
    Math.max(0.55, targetQuality - 0.18),
    Math.max(0.48, targetQuality - 0.24)
  ];

  let optimizedBlob = null;
  for (const quality of qualitySteps) {
    const candidate = await canvasToBlob(canvas, targetType, quality);
    optimizedBlob = candidate;
    if ((candidate?.size || 0) <= maxOutputBytes) {
      break;
    }
  }

  if (!optimizedBlob) {
    throw new Error('Failed to optimize image output.');
  }

  const baseName = String(file.name || 'image').replace(/\.[^.]+$/, '');
  return new File([optimizedBlob], `${baseName}.webp`, { type: targetType });
}

async function optimizeWorldBackgroundImage(file) {
  if (!file) return null;

  const normalizedFile = await normalizeWorldImageFile(file);
  return optimizeWorldImageToWebp(normalizedFile, {
    maxWidth: WORLD_BG_MAX_WIDTH,
    maxHeight: WORLD_BG_MAX_HEIGHT,
    targetType: WORLD_BG_TARGET_TYPE,
    targetQuality: WORLD_BG_TARGET_QUALITY
  });
}

function getWorldCardCoverUrl(world, baseUrl) {
  return String(world?.cover_url || world?.background_url || '').trim() || getDefaultBackgroundUrl(baseUrl);
}

function getOptimizedWorldCardCoverUrl(coverUrl) {
  const normalized = String(coverUrl || '').trim();
  if (!normalized) return normalized;

  try {
    const parsed = new URL(normalized, window.location.origin);
    if (!parsed.pathname.includes('/storage/v1/object/public/')) {
      return normalized;
    }

    parsed.pathname = parsed.pathname.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
    parsed.searchParams.set('width', '640');
    parsed.searchParams.set('height', '640');
    parsed.searchParams.set('resize', 'cover');
    parsed.searchParams.set('quality', '70');
    parsed.searchParams.set('format', 'origin');
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function getOptimizedWorldLoaderBackdropUrl(backgroundUrl) {
  const normalized = String(backgroundUrl || '').trim();
  if (!normalized) return normalized;

  try {
    const parsed = new URL(normalized, window.location.origin);
    if (!parsed.pathname.includes('/storage/v1/object/public/')) {
      return normalized;
    }

    parsed.pathname = parsed.pathname.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
    parsed.searchParams.set('width', '96');
    parsed.searchParams.set('height', '96');
    parsed.searchParams.set('resize', 'cover');
    parsed.searchParams.set('quality', '18');
    parsed.searchParams.set('format', 'origin');
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function getOptimizedWorldLoaderCoverUrl(coverUrl) {
  const normalized = String(coverUrl || '').trim();
  if (!normalized) return normalized;

  try {
    const parsed = new URL(normalized, window.location.origin);
    if (!parsed.pathname.includes('/storage/v1/object/public/')) {
      return normalized;
    }

    parsed.pathname = parsed.pathname.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
    parsed.searchParams.set('width', '420');
    parsed.searchParams.set('height', '420');
    parsed.searchParams.set('resize', 'cover');
    parsed.searchParams.set('quality', '72');
    parsed.searchParams.set('format', 'origin');
    return parsed.toString();
  } catch {
    return normalized;
  }
}

const loaderTintCache = new Map();

function clampColorChannel(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function toRgbTripletString(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';

  const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return hex.split('').map((char) => parseInt(`${char}${char}`, 16)).join(', ');
    }
    return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(', ');
  }

  const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').slice(0, 3).map((part) => clampColorChannel(part.trim()));
    if (parts.length === 3) return parts.join(', ');
  }

  return '';
}

function setWorldLoaderTint(loaderOverlay, tintValue = '') {
  if (!loaderOverlay) return;
  const nextTint = toRgbTripletString(tintValue) || DEFAULT_LOADER_TINT;
  loaderOverlay.style.setProperty('--world-loader-tint', nextTint);
}

async function sampleLoaderTintFromImage(imageUrl) {
  const normalizedUrl = String(imageUrl || '').trim();
  if (!normalizedUrl) return '';
  if (loaderTintCache.has(normalizedUrl)) {
    return loaderTintCache.get(normalizedUrl) || '';
  }

  const sampled = await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const width = Math.max(1, Math.min(16, img.naturalWidth || img.width || 1));
        const height = Math.max(1, Math.min(16, img.naturalHeight || img.height || 1));
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve('');
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height).data;
        const pixelCount = Math.max(1, data.length / 4);
        const startIndex = Math.floor(Math.random() * pixelCount) * 4;
        const red = clampColorChannel(data[startIndex]);
        const green = clampColorChannel(data[startIndex + 1]);
        const blue = clampColorChannel(data[startIndex + 2]);
        resolve(`${red}, ${green}, ${blue}`);
      } catch {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = normalizedUrl;
  });

  loaderTintCache.set(normalizedUrl, sampled || '');
  return sampled || '';
}

function syncWorldLoaderTint(loaderOverlay, backgroundUrl, fallbackTint = '') {
  const backdropUrl = getOptimizedWorldLoaderBackdropUrl(backgroundUrl);
  const fallback = toRgbTripletString(fallbackTint) || DEFAULT_LOADER_TINT;
  setWorldLoaderTint(loaderOverlay, fallback);

  if (!loaderOverlay || !backdropUrl) return;

  loaderOverlay.dataset.loaderTintKey = backdropUrl;
  sampleLoaderTintFromImage(backdropUrl)
    .then((sampledTint) => {
      if (!sampledTint) return;
      if (loaderOverlay?.dataset.loaderTintKey !== backdropUrl) return;
      setWorldLoaderTint(loaderOverlay, sampledTint);
    })
    .catch(() => {
      // Fallback tint already applied.
    });
}

function normalizeWorldPasswordMode(mode = 'view') {
  return String(mode || 'view').toLowerCase() === 'edit' ? 'edit' : 'view';
}

function getWorldPasswordUpdatedAt(world, mode = 'view') {
  const normalizedMode = normalizeWorldPasswordMode(mode);
  const field = normalizedMode === 'edit' ? 'edit_password_updated_at' : 'view_password_updated_at';
  return String(world?.[field] || '').trim();
}

function hasWorldPassword(world, mode = 'view') {
  const normalizedMode = normalizeWorldPasswordMode(mode);
  if (normalizedMode === 'edit') {
    return Boolean(world?.edit_password_hash || world?.password_hash);
  }
  return Boolean(world?.view_password_hash || world?.password_hash);
}

function hasAnyWorldPassword(world) {
  return Boolean(world?.view_password_hash || world?.edit_password_hash || world?.password_hash);
}

function getGuestWorldAccessStorageKey(worldId, mode = 'view') {
  return `${WORLD_GUEST_ACCESS_STORAGE_PREFIX}:${normalizeWorldPasswordMode(mode)}:${String(worldId || '').trim()}`;
}

function hasGuestWorldAccess(worldId, mode = 'view', passwordUpdatedAt = '') {
  const storageKey = getGuestWorldAccessStorageKey(worldId, mode);
  if (!storageKey || storageKey.endsWith(':')) return false;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return false;
    if (raw === '1') return !passwordUpdatedAt;
    const parsed = JSON.parse(raw);
    return String(parsed?.passwordUpdatedAt || '') === String(passwordUpdatedAt || '');
  } catch {
    return false;
  }
}

function rememberGuestWorldAccess(worldId, mode = 'view', passwordUpdatedAt = '', unlocked = true) {
  const storageKey = getGuestWorldAccessStorageKey(worldId, mode);
  if (!storageKey || storageKey.endsWith(':')) return;

  try {
    if (unlocked) {
      window.localStorage.setItem(storageKey, JSON.stringify({ passwordUpdatedAt: String(passwordUpdatedAt || '') }));
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Ignore storage errors.
  }
}

async function optimizeWorldCoverImage(file) {
  if (!file) return null;

  const normalizedMime = String(file.type || '').toLowerCase();
  const normalizedExt = getFileExtension(file.name || '');
  const looksHeicLike = normalizedMime === 'image/heic' || normalizedMime === 'image/heif' || normalizedExt === 'heic' || normalizedExt === 'heif';

  if (!looksHeicLike && normalizedMime && !WORLD_COVER_ALLOWED_MIME_TYPES.has(normalizedMime)) {
    throw new Error('World cover must be JPEG, PNG, GIF, WEBP, HEIC, or HEIF.');
  }

  if ((file.size || 0) > WORLD_COVER_MAX_SOURCE_BYTES) {
    throw new Error('World cover source file is too large. Use a file under 20 MB.');
  }

  const normalizedFile = await normalizeWorldImageFile(file);

  const optimized = await optimizeWorldImageToWebp(normalizedFile, {
    maxWidth: WORLD_COVER_MAX_WIDTH,
    maxHeight: WORLD_COVER_MAX_HEIGHT,
    targetType: WORLD_COVER_TARGET_TYPE,
    targetQuality: WORLD_COVER_TARGET_QUALITY,
    maxOutputBytes: WORLD_COVER_MAX_STATIC_BYTES
  });

  if (optimized.size > WORLD_COVER_MAX_STATIC_BYTES) {
    throw new Error('World cover is too large after optimization. Use an image that can compress below 2 MB.');
  }

  return optimized;
}

function isTypingSurface(target = document.activeElement) {
  if (!target) return false;
  const element = target instanceof Element ? target : null;
  if (element) {
    const rects = element.getClientRects?.();
    const styles = window.getComputedStyle(element);
    const isVisible = rects?.length > 0 && styles.visibility !== 'hidden' && styles.display !== 'none';
    if (!isVisible) return false;
  }
  const tag = target.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return !target.readOnly && !target.disabled;
  if (!target.isContentEditable) return false;
  return Boolean(element?.closest?.('.post-form, .comment-input-wrap, .world-maker-modal, .profile-modal, .settings-panel'));
}

function getDefaultBackgroundUrl(baseUrl) {
  return `${baseUrl}images/background.jpg`;
}

function getPfpSrc(user, baseUrl) {
  const fallback = `${baseUrl}images/pfps/default.png`;
  if (!user) return fallback;
  return user.pfp_url || (user.pfp ? `${baseUrl}images/pfps/${user.pfp}` : fallback);
}

function isDefaultPfpSrc(src = '') {
  return /(?:^|\/)images\/pfps\/default\.png(?:[?#].*)?$/i.test(String(src || '').trim());
}

function getWorldAccent(world) {
  return String(world?.ui_color || world?.font_color || DEFAULT_UI_COLOR).trim() || DEFAULT_UI_COLOR;
}

function getSystemSettingsBackgroundColor() {
  const root = document.documentElement;
  const inlineBg = root.style.getPropertyValue('--sys-bg').trim();
  if (inlineBg) return inlineBg;

  try {
    const saved = JSON.parse(localStorage.getItem('demo4-sys-theme-v1') || 'null');
    const savedBg = String(saved?.bg || '').trim();
    if (savedBg) return savedBg;
  } catch {}

  const bgInput = document.getElementById('settingsBgColor');
  const inputBg = String(bgInput?.value || '').trim();
  if (inputBg) return inputBg;

  const rootStyles = getComputedStyle(root);
  return rootStyles.getPropertyValue('--sys-bg').trim() || '#ffffff';
}

function normalizeColorInputValue(value, fallback) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function createWorldsDom(baseUrl) {
  const host = document.createElement('div');
  host.id = 'worldsFeatureHost';
  const fontOptions = WORLD_FONTS
    .map((font) => `<option value="${escapeHtml(font.value)}">${escapeHtml(font.label)}</option>`)
    .join('');
  host.innerHTML = `
    <div class="world-maker-overlay" id="worldMakerOverlay" style="display:none;">
      <div class="world-maker-modal" id="worldMakerModal">
        <button type="button" class="world-maker-close" id="worldMakerClose" aria-label="close world maker">close</button>
        <div class="world-maker-shell" id="worldMakerShell" data-step="mode">
          <section class="world-maker-step is-active" data-step-panel="mode">
            <div class="world-maker-mode-grid">
              <button type="button" class="world-maker-mode-btn" id="worldModePlugBtn">plug your world</button>
              <button type="button" class="world-maker-mode-btn" id="worldModeCodeBtn">code your world</button>
            </div>
          </section>

          <section class="world-maker-step" data-step-panel="plug">
            <div class="world-maker-kicker">plug &amp; play</div>
            <h2 class="world-maker-title">build a reskinned world</h2>
            <div class="world-maker-form-grid world-maker-form-grid--plug">
              <input class="world-maker-input" type="text" id="worldPlugName" maxlength="80" autocomplete="off" placeholder="world name">
              <div class="world-maker-inline-row world-maker-inline-row--font world-maker-field--wide">
                <label class="world-maker-inline-control world-maker-inline-control--font" for="worldPlugFont">
                  <div class="world-maker-dropdown ui-dropdown ui-dropdown--world" data-world-dropdown>
                    <select id="worldPlugFont" class="world-maker-native-select" aria-label="world font">
                      ${fontOptions}
                    </select>
                    <div class="world-maker-dropdown-display ui-dropdown-display" data-world-dropdown-display role="button" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-controls="worldPlugFontDropdown">
                      <span data-world-dropdown-text>font</span>
                      <span class="world-maker-dropdown-chevron ui-dropdown-chevron" aria-hidden="true">v</span>
                    </div>
                    <div id="worldPlugFontDropdown" class="world-maker-dropdown-list ui-dropdown-list" data-world-dropdown-list role="listbox"></div>
                  </div>
                </label>
              </div>
              <div class="world-maker-inline-row world-maker-inline-row--colors world-maker-field--wide">
                <label class="world-maker-inline-control world-maker-inline-control--color" for="worldPlugBackgroundColor">
                  <input type="color" id="worldPlugBackgroundColor" value="#05070b" aria-label="world background color">
                  <span class="world-maker-color-label">background color</span>
                </label>
                <label class="world-maker-inline-control world-maker-inline-control--color" for="worldPlugFontColor">
                  <input type="color" id="worldPlugFontColor" value="#cfd8e3" aria-label="world font color">
                  <span class="world-maker-color-label">font color</span>
                </label>
              </div>
              <div class="post-form-category-row">
                <input type="hidden" id="worldPlugCategory" value="">
                <div class="post-form-category-custom" id="worldPlugCategoryCustom">
                  <div class="post-form-category-display" id="worldPlugCategoryDisplay" role="button" tabindex="0">
                    <span id="worldPlugCategoryDisplayText" class="is-placeholder">select category</span>
                    <span class="post-form-category-display-actions">
                      <button type="button" class="post-form-category-inline-btn" id="worldPlugCategoryDropdownToggle" aria-label="open category dropdown">v</button>
                      <button type="button" class="post-form-category-inline-btn" id="worldPlugCategoryEditorToggle" aria-label="open category editor">☰</button>
                    </span>
                  </div>
                  <div class="post-form-category-dropdown" id="worldPlugCategoryDropdown"></div>
                </div>
              </div>
              <div class="post-form-category-panel" id="worldPlugCategoryPanel" style="display:none;">
                <div class="post-form-category-create-row">
                  <input type="text" class="post-form-category-input" id="worldPlugCategoryInput" placeholder="new category" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                  <button type="button" class="post-form-category-create-btn" id="worldPlugCategoryCreateBtn">+</button>
                </div>
                <div class="post-form-category-list" id="worldPlugCategoryList"></div>
              </div>
              <label class="world-maker-field world-maker-field--upload world-maker-field--wide">
                <label class="world-maker-upload world-maker-upload--compact world-maker-input-box">
                  <span id="worldPlugCoverLabel">use world background as cover</span>
                  <input type="file" id="worldPlugCover" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif">
                </label>
              </label>
              <label class="world-maker-field world-maker-field--upload world-maker-field--wide">
                <label class="world-maker-upload world-maker-upload--compact world-maker-input-box">
                  <span id="worldPlugBackgroundLabel">use site background</span>
                  <input type="file" id="worldPlugBackground" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif">
                </label>
              </label>
              <div class="world-maker-mode-row world-maker-field--wide">
                <div class="world-maker-mode-setting" id="worldPlugViewModeRow" data-private="false">
                  <label class="world-maker-inline-control world-maker-inline-control--font world-maker-inline-control--mode" for="worldPlugVisibility">
                    <span class="world-maker-mode-label-box">view mode</span>
                    <div class="world-maker-dropdown world-maker-dropdown--compact ui-dropdown ui-dropdown--world" data-world-dropdown>
                      <select id="worldPlugVisibility" class="world-maker-native-select" aria-label="view mode">
                        <option value="true">public</option>
                        <option value="false">private</option>
                      </select>
                      <div class="world-maker-dropdown-display ui-dropdown-display" data-world-dropdown-display role="button" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-controls="worldPlugVisibilityDropdown">
                        <span data-world-dropdown-text>public</span>
                        <span class="world-maker-dropdown-chevron ui-dropdown-chevron" aria-hidden="true">v</span>
                      </div>
                      <div id="worldPlugVisibilityDropdown" class="world-maker-dropdown-list ui-dropdown-list" data-world-dropdown-list role="listbox"></div>
                    </div>
                  </label>
                  <input class="world-maker-mode-password" type="password" id="worldPlugViewPassword" autocomplete="new-password" placeholder="${PASSWORD_MASK_PLACEHOLDER}" style="display:none;">
                  <input class="world-maker-mode-password" type="password" id="worldPlugViewPasswordConfirm" autocomplete="new-password" placeholder="confirm${PASSWORD_MASK_PLACEHOLDER}" style="display:none;">
                </div>
                <div class="world-maker-mode-setting" id="worldPlugEditModeRow" data-private="false">
                  <label class="world-maker-inline-control world-maker-inline-control--font world-maker-inline-control--mode" for="worldPlugEditing">
                    <span class="world-maker-mode-label-box">edit mode</span>
                    <div class="world-maker-dropdown world-maker-dropdown--compact ui-dropdown ui-dropdown--world" data-world-dropdown>
                      <select id="worldPlugEditing" class="world-maker-native-select" aria-label="edit mode">
                        <option value="true">public</option>
                        <option value="false">private</option>
                      </select>
                      <div class="world-maker-dropdown-display ui-dropdown-display" data-world-dropdown-display role="button" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-controls="worldPlugEditingDropdown">
                        <span data-world-dropdown-text>public</span>
                        <span class="world-maker-dropdown-chevron ui-dropdown-chevron" aria-hidden="true">v</span>
                      </div>
                      <div id="worldPlugEditingDropdown" class="world-maker-dropdown-list ui-dropdown-list" data-world-dropdown-list role="listbox"></div>
                    </div>
                  </label>
                  <input class="world-maker-mode-password" type="password" id="worldPlugEditPassword" autocomplete="new-password" placeholder="${PASSWORD_MASK_PLACEHOLDER}" style="display:none;">
                  <input class="world-maker-mode-password" type="password" id="worldPlugEditPasswordConfirm" autocomplete="new-password" placeholder="confirm${PASSWORD_MASK_PLACEHOLDER}" style="display:none;">
                </div>
              </div>
            </div>
            <div class="world-maker-actions">
              <button type="button" class="world-maker-danger" id="worldMakerDelete" style="display:none;">delete world</button>
              <button type="button" class="world-maker-secondary" id="worldPlugBack" aria-label="close world maker">close</button>
              <button type="button" class="world-maker-primary" id="worldPlugPublish" aria-label="submit world maker">submit</button>
            </div>
          </section>

          <section class="world-maker-step" data-step-panel="code">
            <div class="world-maker-form-grid world-maker-form-grid--plug">
              <input class="world-maker-input" type="text" id="worldCodeName" maxlength="80" autocomplete="off" placeholder="world name">
              <div class="world-maker-inline-row world-maker-inline-row--font world-maker-field--wide">
                <label class="world-maker-inline-control world-maker-inline-control--font" for="worldCodeFont">
                  <div class="world-maker-dropdown ui-dropdown ui-dropdown--world" data-world-dropdown>
                    <select id="worldCodeFont" class="world-maker-native-select" aria-label="world font">
                      ${fontOptions}
                    </select>
                    <div class="world-maker-dropdown-display ui-dropdown-display" data-world-dropdown-display role="button" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-controls="worldCodeFontDropdown">
                      <span data-world-dropdown-text>font</span>
                      <span class="world-maker-dropdown-chevron ui-dropdown-chevron" aria-hidden="true">v</span>
                    </div>
                    <div id="worldCodeFontDropdown" class="world-maker-dropdown-list ui-dropdown-list" data-world-dropdown-list role="listbox"></div>
                  </div>
                </label>
              </div>
              <div class="world-maker-inline-row world-maker-inline-row--colors world-maker-field--wide">
                <label class="world-maker-inline-control world-maker-inline-control--color" for="worldCodeBackgroundColor">
                  <input type="color" id="worldCodeBackgroundColor" value="#05070b" aria-label="loading screen background color">
                  <span class="world-maker-color-label">loading screen background</span>
                </label>
                <label class="world-maker-inline-control world-maker-inline-control--color" for="worldCodeFontColor">
                  <input type="color" id="worldCodeFontColor" value="#cfd8e3" aria-label="loading screen font color">
                  <span class="world-maker-color-label">loading screen font color</span>
                </label>
              </div>
              <div class="post-form-category-row">
                <input type="hidden" id="worldCodeCategory" value="">
                <div class="post-form-category-custom" id="worldCodeCategoryCustom">
                  <div class="post-form-category-display" id="worldCodeCategoryDisplay" role="button" tabindex="0">
                    <span id="worldCodeCategoryDisplayText" class="is-placeholder">select category</span>
                    <span class="post-form-category-display-actions">
                      <button type="button" class="post-form-category-inline-btn" id="worldCodeCategoryDropdownToggle" aria-label="open category dropdown">v</button>
                      <button type="button" class="post-form-category-inline-btn" id="worldCodeCategoryEditorToggle" aria-label="open category editor">☰</button>
                    </span>
                  </div>
                  <div class="post-form-category-dropdown" id="worldCodeCategoryDropdown"></div>
                </div>
              </div>
              <div class="post-form-category-panel" id="worldCodeCategoryPanel" style="display:none;">
                <div class="post-form-category-create-row">
                  <input type="text" class="post-form-category-input" id="worldCodeCategoryInput" placeholder="new category" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                  <button type="button" class="post-form-category-create-btn" id="worldCodeCategoryCreateBtn">+</button>
                </div>
                <div class="post-form-category-list" id="worldCodeCategoryList"></div>
              </div>
              <button type="button" class="world-maker-download world-maker-input-box" id="worldCodeDownload">download template zip</button>
              <label class="world-maker-field world-maker-field--upload world-maker-field--wide">
                <label class="world-maker-upload world-maker-upload--compact world-maker-input-box">
                  <span id="worldCodeHtmlLabel">choose html</span>
                  <input type="file" id="worldCodeHtml" accept=".html,text/html">
                </label>
              </label>
              <label class="world-maker-field world-maker-field--upload world-maker-field--wide">
                <label class="world-maker-upload world-maker-upload--compact world-maker-input-box">
                  <span id="worldCodeCssLabel">choose css</span>
                  <input type="file" id="worldCodeCss" accept=".css,text/css">
                </label>
              </label>
              <label class="world-maker-field world-maker-field--upload world-maker-field--wide">
                <label class="world-maker-upload world-maker-upload--compact world-maker-input-box">
                  <span id="worldCodeAssetsLabel">choose ui assets</span>
                  <input type="file" id="worldCodeAssets" accept="image/png,image/jpeg,video/mp4,video/webm,.png,.jpg,.jpeg,.mp4,.webm" multiple>
                </label>
              </label>
              <label class="world-maker-field world-maker-field--upload world-maker-field--wide">
                <label class="world-maker-upload world-maker-upload--compact world-maker-input-box">
                  <span id="worldCodeCoverLabel">choose world card cover</span>
                  <input type="file" id="worldCodeCover" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif">
                </label>
              </label>
              <div class="world-maker-mode-row world-maker-field--wide">
                <div class="world-maker-mode-setting" id="worldCodeViewModeRow" data-private="false">
                  <label class="world-maker-inline-control world-maker-inline-control--font world-maker-inline-control--mode" for="worldCodeVisibility">
                    <span class="world-maker-mode-label-box">view mode</span>
                    <div class="world-maker-dropdown world-maker-dropdown--compact ui-dropdown ui-dropdown--world" data-world-dropdown>
                      <select id="worldCodeVisibility" class="world-maker-native-select" aria-label="view mode">
                        <option value="true">public</option>
                        <option value="false">private</option>
                      </select>
                      <div class="world-maker-dropdown-display ui-dropdown-display" data-world-dropdown-display role="button" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-controls="worldCodeVisibilityDropdown">
                        <span data-world-dropdown-text>public</span>
                        <span class="world-maker-dropdown-chevron ui-dropdown-chevron" aria-hidden="true">v</span>
                      </div>
                      <div id="worldCodeVisibilityDropdown" class="world-maker-dropdown-list ui-dropdown-list" data-world-dropdown-list role="listbox"></div>
                    </div>
                  </label>
                  <input class="world-maker-mode-password" type="password" id="worldCodeViewPassword" autocomplete="new-password" placeholder="${PASSWORD_MASK_PLACEHOLDER}" style="display:none;">
                  <input class="world-maker-mode-password" type="password" id="worldCodeViewPasswordConfirm" autocomplete="new-password" placeholder="confirm${PASSWORD_MASK_PLACEHOLDER}" style="display:none;">
                </div>
                <div class="world-maker-mode-setting" id="worldCodeEditModeRow" data-private="false">
                  <label class="world-maker-inline-control world-maker-inline-control--font world-maker-inline-control--mode" for="worldCodeEditing">
                    <span class="world-maker-mode-label-box">edit mode</span>
                    <div class="world-maker-dropdown world-maker-dropdown--compact ui-dropdown ui-dropdown--world" data-world-dropdown>
                      <select id="worldCodeEditing" class="world-maker-native-select" aria-label="edit mode">
                        <option value="true">public</option>
                        <option value="false">private</option>
                      </select>
                      <div class="world-maker-dropdown-display ui-dropdown-display" data-world-dropdown-display role="button" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-controls="worldCodeEditingDropdown">
                        <span data-world-dropdown-text>public</span>
                        <span class="world-maker-dropdown-chevron ui-dropdown-chevron" aria-hidden="true">v</span>
                      </div>
                      <div id="worldCodeEditingDropdown" class="world-maker-dropdown-list ui-dropdown-list" data-world-dropdown-list role="listbox"></div>
                    </div>
                  </label>
                  <input class="world-maker-mode-password" type="password" id="worldCodeEditPassword" autocomplete="new-password" placeholder="${PASSWORD_MASK_PLACEHOLDER}" style="display:none;">
                  <input class="world-maker-mode-password" type="password" id="worldCodeEditPasswordConfirm" autocomplete="new-password" placeholder="confirm${PASSWORD_MASK_PLACEHOLDER}" style="display:none;">
                </div>
              </div>
            </div>
            <div class="world-maker-actions">
              <button type="button" class="world-maker-danger" id="worldCodeDelete" style="display:none;">delete world</button>
              <button type="button" class="world-maker-secondary" id="worldCodeBack" aria-label="close code world maker">close</button>
              <button type="button" class="world-maker-primary" id="worldCodePublish" aria-label="submit code world maker">submit</button>
            </div>
          </section>
        </div>
      </div>
    </div>

    <div class="world-mode-chrome" id="worldModeChrome" style="display:block;">
      <div class="world-mode-nav-bar" id="worldModeNavBar">
        <nav class="world-mode-breadcrumbs" id="worldModeTabs" aria-label="world navigation"><span class="world-mode-breadcrumb world-mode-breadcrumb-current" aria-current="page">loading...</span></nav>
        <div class="world-mode-nav-actions" id="worldModeNavActions" style="display:none;">
          <button type="button" class="world-mode-breadcrumb world-mode-edit-world" id="worldModeEditBtn" style="display:none;">edit world</button>
          <button type="button" class="world-mode-breadcrumb world-mode-logout" id="logoutBtn">log out</button>
        </div>
      </div>
      <div class="world-mode-myworlds-menu" id="worldModeMyWorldsMenu" style="display:none;"></div>
      <button type="button" class="world-mode-delete" id="worldModeDelete" style="display:none;">delete</button>
      <iframe id="worldModeFrame" class="world-mode-frame" sandbox="allow-scripts allow-same-origin allow-forms" referrerpolicy="no-referrer" style="display:none;"></iframe>
    </div>

    <div class="world-loader-overlay" id="worldLoaderOverlay" data-mode="loading" style="display:none;">
      <div class="world-loader-backdrop" id="worldLoaderBackdrop"></div>
      <div class="world-loader-wash" id="worldLoaderWash"></div>
      <div class="world-loader-copy">
        <div class="world-loader-kicker" id="worldLoaderKicker">world</div>
        <h2 class="world-loader-title" id="worldLoaderTitle">untitled world</h2>
        <div class="world-loader-meta" id="worldLoaderMeta">by unknown</div>
        <div class="world-loader-status" id="worldLoaderStatusWrap">
          <div class="world-loader-progress" aria-hidden="true">
            <span class="world-loader-progress-bar"></span>
          </div>
          <div class="world-loader-status-text" id="worldLoaderStatus">loading world...</div>
        </div>
        <span class="world-loader-pfp-box" id="worldLoaderPfpBox" aria-hidden="true">
          <img class="world-loader-pfp" id="worldLoaderPfp" src="" alt="">
          <span class="ui-icon icon-profile world-loader-profile-icon" id="worldLoaderProfileIcon" aria-hidden="true"></span>
        </span>
      </div>

      <div class="world-password-panel" id="worldPasswordPanel">
        <input class="world-password-input" type="password" id="worldPasswordInput" autocomplete="current-password" spellcheck="false" placeholder="${PASSWORD_MASK_PLACEHOLDER}">
        <input class="world-password-input" type="password" id="worldEditPasswordInput" autocomplete="current-password" spellcheck="false" placeholder="${PASSWORD_MASK_PLACEHOLDER}" style="display:none;">
        <div class="world-password-error" id="worldPasswordError" aria-live="polite"></div>
        <button type="button" class="world-password-secondary" id="worldPasswordCancel" aria-label="cancel password prompt" style="display:none;">cancel</button>
        <button type="button" class="world-password-primary" id="worldPasswordSubmit" aria-label="submit password" style="display:none;">unlock</button>
      </div>
    </div>
  `;

  document.body.appendChild(host);
  document.getElementById('worldNavBootShell')?.remove();
  return {
    makerOverlay: host.querySelector('#worldMakerOverlay'),
    makerShell: host.querySelector('#worldMakerShell'),
    makerClose: host.querySelector('#worldMakerClose'),
    plugName: host.querySelector('#worldPlugName'),
    plugFont: host.querySelector('#worldPlugFont'),
    plugBackgroundColor: host.querySelector('#worldPlugBackgroundColor'),
    plugFontColor: host.querySelector('#worldPlugFontColor'),
    plugCategoryHidden: host.querySelector('#worldPlugCategory'),
    plugCategoryDisplay: host.querySelector('#worldPlugCategoryDisplay'),
    plugCategoryDisplayText: host.querySelector('#worldPlugCategoryDisplayText'),
    plugCategoryDropdownToggle: host.querySelector('#worldPlugCategoryDropdownToggle'),
    plugCategoryEditorToggle: host.querySelector('#worldPlugCategoryEditorToggle'),
    plugCategoryDropdown: host.querySelector('#worldPlugCategoryDropdown'),
    plugCategoryPanel: host.querySelector('#worldPlugCategoryPanel'),
    plugCategoryInput: host.querySelector('#worldPlugCategoryInput'),
    plugCategoryCreateBtn: host.querySelector('#worldPlugCategoryCreateBtn'),
    plugCategoryList: host.querySelector('#worldPlugCategoryList'),

    plugCover: host.querySelector('#worldPlugCover'),
    plugCoverLabel: host.querySelector('#worldPlugCoverLabel'),
    plugBackground: host.querySelector('#worldPlugBackground'),
    plugBackgroundLabel: host.querySelector('#worldPlugBackgroundLabel'),
    plugVisibility: host.querySelector('#worldPlugVisibility'),
    plugEditing: host.querySelector('#worldPlugEditing'),
    plugViewModeRow: host.querySelector('#worldPlugViewModeRow'),
    plugEditModeRow: host.querySelector('#worldPlugEditModeRow'),
    plugViewPassword: host.querySelector('#worldPlugViewPassword'),
    plugViewPasswordConfirm: host.querySelector('#worldPlugViewPasswordConfirm'),
    plugEditPassword: host.querySelector('#worldPlugEditPassword'),
    plugEditPasswordConfirm: host.querySelector('#worldPlugEditPasswordConfirm'),
    plugBack: host.querySelector('#worldPlugBack'),
    plugPublish: host.querySelector('#worldPlugPublish'),
    codeHtml: host.querySelector('#worldCodeHtml'),
    codeCss: host.querySelector('#worldCodeCss'),
    codeAssets: host.querySelector('#worldCodeAssets'),
    codeCover: host.querySelector('#worldCodeCover'),
    codeHtmlLabel: host.querySelector('#worldCodeHtmlLabel'),
    codeCssLabel: host.querySelector('#worldCodeCssLabel'),
    codeAssetsLabel: host.querySelector('#worldCodeAssetsLabel'),
    codeCoverLabel: host.querySelector('#worldCodeCoverLabel'),
    codeName: host.querySelector('#worldCodeName'),
    codeFont: host.querySelector('#worldCodeFont'),
    codeBackgroundColor: host.querySelector('#worldCodeBackgroundColor'),
    codeFontColor: host.querySelector('#worldCodeFontColor'),
    codeCategoryHidden: host.querySelector('#worldCodeCategory'),
    codeCategoryDisplay: host.querySelector('#worldCodeCategoryDisplay'),
    codeCategoryDisplayText: host.querySelector('#worldCodeCategoryDisplayText'),
    codeCategoryDropdownToggle: host.querySelector('#worldCodeCategoryDropdownToggle'),
    codeCategoryEditorToggle: host.querySelector('#worldCodeCategoryEditorToggle'),
    codeCategoryDropdown: host.querySelector('#worldCodeCategoryDropdown'),
    codeCategoryPanel: host.querySelector('#worldCodeCategoryPanel'),
    codeCategoryInput: host.querySelector('#worldCodeCategoryInput'),
    codeCategoryCreateBtn: host.querySelector('#worldCodeCategoryCreateBtn'),
    codeCategoryList: host.querySelector('#worldCodeCategoryList'),
    codeVisibility: host.querySelector('#worldCodeVisibility'),
    codeEditing: host.querySelector('#worldCodeEditing'),
    codeViewModeRow: host.querySelector('#worldCodeViewModeRow'),
    codeEditModeRow: host.querySelector('#worldCodeEditModeRow'),
    codeViewPassword: host.querySelector('#worldCodeViewPassword'),
    codeViewPasswordConfirm: host.querySelector('#worldCodeViewPasswordConfirm'),
    codeEditPassword: host.querySelector('#worldCodeEditPassword'),
    codeEditPasswordConfirm: host.querySelector('#worldCodeEditPasswordConfirm'),
    codeBack: host.querySelector('#worldCodeBack'),
    codePublish: host.querySelector('#worldCodePublish'),
    codeDownload: host.querySelector('#worldCodeDownload'),
    modePlugBtn: host.querySelector('#worldModePlugBtn'),
    modeCodeBtn: host.querySelector('#worldModeCodeBtn'),
    modeChrome: host.querySelector('#worldModeChrome'),
    modeNavBar: host.querySelector('#worldModeNavBar'),
    modeNavActions: host.querySelector('#worldModeNavActions'),
    modeTabs: host.querySelector('#worldModeTabs'),
    modeMyWorldsMenu: host.querySelector('#worldModeMyWorldsMenu'),
    modeEditBtn: host.querySelector('#worldModeEditBtn'),
    logoutBtn: host.querySelector('#logoutBtn'),
    modeDelete: host.querySelector('#worldModeDelete'),
    modeIdentityPanel: host.querySelector('.world-mode-identity-panel'),
    titleCard: host.querySelector('#worldModeTitleCard'),
    modeFrame: host.querySelector('#worldModeFrame'),
    loaderOverlay: host.querySelector('#worldLoaderOverlay'),
    loaderBackdrop: host.querySelector('#worldLoaderBackdrop'),
    loaderWash: host.querySelector('#worldLoaderWash'),
    loaderKicker: host.querySelector('#worldLoaderKicker'),
    loaderPfp: host.querySelector('#worldLoaderPfp'),
    loaderProfileIcon: host.querySelector('#worldLoaderProfileIcon'),
    loaderTitle: host.querySelector('#worldLoaderTitle'),
    loaderMeta: host.querySelector('#worldLoaderMeta'),
    loaderStatusWrap: host.querySelector('#worldLoaderStatusWrap'),
    loaderStatus: host.querySelector('#worldLoaderStatus'),
    loaderCoverShell: host.querySelector('#worldLoaderCoverShell'),
    loaderCover: host.querySelector('#worldLoaderCover'),
    passwordOverlay: host.querySelector('#worldLoaderOverlay'),
    passwordModal: host.querySelector('#worldPasswordPanel'),
    passwordTitle: host.querySelector('#worldPasswordTitle'),
    passwordCopy: host.querySelector('#worldPasswordCopy'),
    passwordInput: host.querySelector('#worldPasswordInput'),
    editPasswordInput: host.querySelector('#worldEditPasswordInput'),
    passwordError: host.querySelector('#worldPasswordError'),
    passwordCancel: host.querySelector('#worldPasswordCancel'),
    passwordSubmit: host.querySelector('#worldPasswordSubmit'),
    makerDelete: host.querySelector('#worldMakerDelete'),
    makerDeleteButtons: [...host.querySelectorAll('.world-maker-danger')]
  };
}

async function buildTemplateZip() {
  const zip = new JSZip();
  zip.file('world.html', `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>world</title>
  <link rel="stylesheet" href="./world.css">
</head>
<body>
  <main class="world-root" id="worldRoot">
    <div class="world-toolbar">
      <button type="button" id="newPostBtn">new post</button>
      <button type="button" id="newWorldBtn">new world</button>
      <button type="button" id="refreshBtn">refresh</button>
    </div>
    <section class="world-stage" id="worldStage" aria-live="polite"></section>
  </main>
  <script>
    (function () {
      var requestId = 0;
      var pending = new Map();

      function request(method, params) {
        requestId += 1;
        var id = String(requestId);
        window.parent.postMessage({
          demo0WorldBridge: true,
          type: 'request',
          requestId: id,
          method: method,
          params: params || {}
        }, '*');

        return new Promise(function (resolve, reject) {
          pending.set(id, { resolve: resolve, reject: reject });
          window.setTimeout(function () {
            if (!pending.has(id)) return;
            pending.delete(id);
            reject(new Error('WorldSDK request timed out: ' + method));
          }, 15000);
        });
      }

      window.addEventListener('message', function (event) {
        var data = event.data || {};
        if (data.demo0WorldBridge !== true) return;
        if (data.type === 'ready') {
          window.WorldSDK.context = data.payload || null;
          window.dispatchEvent(new CustomEvent('worldsdkready', { detail: data.payload || null }));
          return;
        }
        if (data.type !== 'response') return;
        var waiter = pending.get(data.requestId);
        if (!waiter) return;
        pending.delete(data.requestId);
        if (data.ok) waiter.resolve(data.payload);
        else waiter.reject(new Error(data.error || 'WorldSDK request failed'));
      });

      window.WorldSDK = {
        version: 1,
        context: null,
        request: request,
        auth: {
          currentUser: function () { return request('auth.currentUser'); }
        },
        contextApi: {
          get: function () { return request('context.get'); }
        },
        posts: {
          list: function (params) { return request('posts.list', params); },
          create: function (params) { return request('posts.create', params); },
          open: function (postId) { return request('posts.open', { postId: postId }); },
          openCreateForm: function () { return request('posts.openCreateForm'); }
        },
        comments: {
          list: function (postId) { return request('comments.list', { postId: postId }); },
          create: function (postId, body) { return request('comments.create', { postId: postId, body: body }); }
        },
        worlds: {
          list: function () { return request('worlds.list'); },
          create: function (params) { return request('worlds.create', params); },
          open: function (worldId) { return request('worlds.open', { worldId: worldId }); },
          openMaker: function () { return request('worlds.openMaker'); }
        },
        categories: {
          list: function () { return request('categories.list'); }
        }
      };
    })();

    var stage = document.getElementById('worldStage');
    var refreshBtn = document.getElementById('refreshBtn');
    var newPostBtn = document.getElementById('newPostBtn');
    var newWorldBtn = document.getElementById('newWorldBtn');

    function text(value) {
      return String(value == null ? '' : value);
    }

    function setStatus(message) {
      stage.innerHTML = '<div class="empty-state">' + text(message) + '</div>';
    }

    function renderPost(post, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'star-post';
      button.style.left = ((Number(post.x) || (120 + index * 82)) % 900) + 'px';
      button.style.top = ((Number(post.y) || (100 + index * 55)) % 520) + 'px';
      button.innerHTML = '<span class="star-shape"></span><span class="star-title"></span>';
      button.querySelector('.star-title').textContent = post.title || post.body || 'untitled post';
      button.addEventListener('click', function () {
        window.WorldSDK.posts.open(post.id).catch(function (error) { console.error(error); });
      });
      stage.appendChild(button);
    }

    function renderWorld(world, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'moon-world';
      button.style.left = (80 + index * 130) + 'px';
      button.style.top = (380 + (index % 2) * 72) + 'px';
      button.textContent = world.name || 'untitled world';
      button.addEventListener('click', function () {
        window.WorldSDK.worlds.open(world.id).catch(function (error) { console.error(error); });
      });
      stage.appendChild(button);
    }

    async function render() {
      setStatus('loading custom world...');
      var context = await window.WorldSDK.contextApi.get();
      var posts = await window.WorldSDK.posts.list({ limit: 100 });
      var worlds = await window.WorldSDK.worlds.list();

      stage.innerHTML = '';
      if (!posts.length && !worlds.length) {
        setStatus((context.world && context.world.name ? context.world.name : 'custom world') + ' is empty');
        return;
      }

      posts.forEach(renderPost);
      worlds.forEach(renderWorld);
    }

    refreshBtn.addEventListener('click', function () { render().catch(function (error) { setStatus(error.message); }); });
    newPostBtn.addEventListener('click', async function () {
      var title = window.prompt('post title', '');
      if (title == null) return;
      var body = window.prompt('post text', '');
      if (body == null) return;
      try {
        await window.WorldSDK.posts.create({ title: title, body: body });
        await render();
      } catch (error) {
        setStatus(error.message);
      }
    });
    newWorldBtn.addEventListener('click', async function () {
      var name = window.prompt('world name', '');
      if (name == null) return;
      try {
        await window.WorldSDK.worlds.create({
          type: 'plug',
          name: name,
          visibility: 'public',
          editing: 'public'
        });
        await render();
      } catch (error) {
        setStatus(error.message);
      }
    });
    window.addEventListener('worldsdkready', function () { render().catch(function (error) { setStatus(error.message); }); });
    window.setTimeout(function () {
      if (!window.WorldSDK.context) render().catch(function (error) { setStatus(error.message); });
    }, 500);
  </script>
</body>
</html>
`);
  zip.file('world.css', `:root {
  color-scheme: dark;
  --bg-a: #07080d;
  --bg-b: #18231e;
  --fg: #eef2ff;
  --muted: rgba(238, 242, 255, 0.72);
  --accent: #e8d774;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  font-family: Georgia, 'Times New Roman', serif;
  color: var(--fg);
  background: linear-gradient(135deg, var(--bg-a), var(--bg-b));
}

.world-root {
  min-height: 100vh;
  position: relative;
  overflow: hidden;
}

.world-toolbar {
  position: fixed;
  z-index: 10;
  top: 18px;
  left: 18px;
  display: flex;
  gap: 8px;
}

.world-toolbar button,
.moon-world,
.star-post {
  border: 1px solid rgba(255,255,255,0.26);
  color: var(--fg);
  background: rgba(0,0,0,0.34);
  cursor: pointer;
}

.world-toolbar button {
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
}

.world-stage {
  position: relative;
  min-height: 100vh;
}

.empty-state {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: var(--muted);
}

.star-post {
  position: absolute;
  width: 132px;
  min-height: 118px;
  border: 0;
  background: transparent;
}

.star-shape {
  display: block;
  width: 78px;
  height: 78px;
  margin: 0 auto 8px;
  background: var(--accent);
  clip-path: polygon(50% 0%, 62% 35%, 98% 35%, 68% 56%, 79% 91%, 50% 70%, 21% 91%, 32% 56%, 2% 35%, 38% 35%);
  filter: drop-shadow(0 0 16px rgba(232,215,116,0.44));
}

.star-title {
  display: block;
  width: 100%;
  color: var(--fg);
  font-size: 13px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.moon-world {
  position: absolute;
  min-width: 112px;
  min-height: 52px;
  padding: 10px 14px;
  border-radius: 999px;
  box-shadow: 0 0 20px rgba(255,255,255,0.16);
}
`);
  zip.file('README.txt', `World sandbox notes

- Your custom world runs inside a sandboxed iframe.
- You do not get direct access to the parent app DOM or raw Supabase client.
- Use window.WorldSDK from world.html to ask the parent app for approved capabilities.
- Custom-code worlds can upload a world card cover in the native maker; SDK-created code worlds can pass cover.
- You can upload initial UI assets with the custom-code maker: up to 20 PNG files, 4 JPEG files, and 2 video files.
- PNG UI assets must be 2 MB or smaller each; JPEG UI assets must be 4 MB or smaller each; video UI assets must be 80 MB or smaller each; total UI assets must stay under 180 MB.
- Reference uploaded UI assets from world.html/world.css with ./assets/filename.png, ./assets/filename.jpg, ./assets/filename.mp4, or ./assets/filename.webm.
- Asset filenames are cleaned before upload, so simple lowercase names without spaces are safest.
- Uploaded UI asset metadata is also written to ./assets/manifest.json.
- Available SDK methods in v1:
  - WorldSDK.contextApi.get()
  - WorldSDK.auth.currentUser()
  - WorldSDK.posts.list({ limit, category, userId })
  - WorldSDK.posts.create({ title, body, category, url, x, y })
  - WorldSDK.posts.open(postId)
  - WorldSDK.posts.openCreateForm() for the native full file/upload form
  - WorldSDK.comments.list(postId)
  - WorldSDK.comments.create(postId, body)
  - WorldSDK.worlds.list()
  - WorldSDK.worlds.create({ type, name, category, visibility, editing, viewPassword, editPassword, html, css, assets, cover })
  - WorldSDK.worlds.open(worldId)
  - WorldSDK.worlds.openMaker() for the native full world maker
  - WorldSDK.categories.list()
- The parent app still enforces world scope, passwords, edit access, files, posts, comments, and nested worlds.
- The app currently publishes world.html and world.css into your world's storage folder. Put JavaScript inline in world.html unless the uploader is expanded later.
`);

  return zip.generateAsync({ type: 'blob' });
}

export function initWorldsFeature(options) {
  const {
    supabase,
    baseUrl,
    getCurrentUser,
    getIsEditMode,
    getCategories,
    getCategoryRecords,
    getCategoryColor,
    canEditCategory,
    onAddCategory,
    onDeleteCategory,
    onRenameCategory,
    onUpdateCategoryColor,
    onWorldCreated,
    onWorldDeleted,
    onEnterWorld,
    onExitWorld,
    onBeforeShowLoader,
    onOpenProfile,
    onBeforeOpenMaker,
    onCustomWorldGetContext,
    onCustomWorldListPosts,
    onCustomWorldCreatePost,
    onCustomWorldOpenPost,
    onCustomWorldOpenPostForm,
    onCustomWorldListComments,
    onCustomWorldCreateComment,
    isMusicPanelOpen,
    onCloseMusicPanel,
    onRequestCloseEditorMode
  } = options;

  const dom = createWorldsDom(baseUrl);
  [
    dom.plugViewPassword,
    dom.plugViewPasswordConfirm,
    dom.plugEditPassword,
    dom.plugEditPasswordConfirm,
    dom.codeViewPassword,
    dom.codeViewPasswordConfirm,
    dom.codeEditPassword,
    dom.codeEditPasswordConfirm,
    dom.passwordInput,
    dom.editPasswordInput
  ].forEach((input) => {
    if (!input) return;
    input.placeholder = input.id?.endsWith('Confirm') ? `confirm${PASSWORD_MASK_PLACEHOLDER}` : PASSWORD_MASK_PLACEHOLDER;
    attachFakePasswordInput(input);
  });
  let publishInFlight = false;
  let activeWorld = null;
  let activeWorldCreator = null;
  let worldNavStack = [];
  let passwordPromptState = null;
  let makerMode = 'create';
  let makerEditingWorld = null;
  let makerEditingType = 'plug';
  let latestUpdateInfo = null;
  let latestUpdateInfoPromise = null;
  let latestUpdateInfoRetryAt = 0;
  let loadWorldsInFlightPromise = null;
  let loadWorldsInFlightKey = '';
  let customWorldFrameSrc = '';
  let customWorldFrameLoadSeq = 0;
  let customWorldFrameReadyPromise = Promise.resolve(false);
  let resolveCustomWorldFrameReady = null;
  const customWorldFrameVersionById = new Map();
  let myWorldIds = [];
  let myWorldMap = new Map();
  let myWorldsHydrated = false;
  let makerSourceWorldId = '';
  const worldDropdownControllers = new Map();
  let makerBaselineState = null;
  let customWorldEditRevealWorldId = '';
  let worldNavLastRightClickAt = 0;
  let parentTabAction = async () => {
    await exitWorldMode();
  };

  function safeBridgeUser(user = null) {
    if (!user) return null;
    return {
      id: user.id || null,
      username: user.username || user.email || '',
      pfp: user.pfp || null,
      pfp_url: user.pfp_url || null
    };
  }

  function safeBridgeWorld(world = null) {
    if (!world) return null;
    return {
      id: world.id || null,
      user_id: world.user_id || null,
      parent_world_id: world.parent_world_id || null,
      name: world.name || '',
      category: world.category || null,
      background_url: world.background_url || null,
      cover_url: world.cover_url || null,
      custom_code_url: world.custom_code_url || null,
      font_family: world.font_family || null,
      font_color: world.font_color || null,
      ui_color: world.ui_color || null,
      background_color: world.background_color || null,
      is_public_view: world.is_public_view !== false,
      is_public_edit: world.is_public_edit !== false,
      x: Number.isFinite(Number(world.x)) ? Number(world.x) : null,
      y: Number.isFinite(Number(world.y)) ? Number(world.y) : null
    };
  }

  function safeBridgeCategory(record = null) {
    if (!record) return null;
    return {
      id: record.id || null,
      name: record.name || '',
      world_id: record.world_id || null,
      color: record.thread_color || record.color || record.line_color || record.network_color || null
    };
  }

  function isActiveCustomWorldFrame(source = null) {
    return Boolean(
      activeWorld?.id
      && canUseCustomWorldFrame(activeWorld)
      && dom.modeFrame?.contentWindow
      && source === dom.modeFrame.contentWindow
    );
  }

  async function getCustomWorldBridgeContext() {
    const customContext = typeof onCustomWorldGetContext === 'function'
      ? await onCustomWorldGetContext({ world: activeWorld, creator: activeWorldCreator })
      : null;

    return {
      version: 1,
      world: safeBridgeWorld(activeWorld),
      creator: safeBridgeUser(activeWorldCreator),
      currentUser: safeBridgeUser(getCurrentUser?.()),
      editMode: Boolean(getIsEditMode?.()),
      categories: (getCategoryRecords?.() || getCategories?.() || []).map(safeBridgeCategory).filter(Boolean),
      ...(customContext || {})
    };
  }

  async function runCustomWorldBridgeMethod(method, params = {}) {
    const normalizedMethod = String(method || '').trim();

    if (!activeWorld?.id || !canUseCustomWorldFrame(activeWorld)) {
      throw new Error('No active custom world.');
    }

    if (normalizedMethod === 'context.get') {
      return getCustomWorldBridgeContext();
    }

    if (normalizedMethod === 'auth.currentUser') {
      return safeBridgeUser(getCurrentUser?.());
    }

    if (normalizedMethod === 'categories.list') {
      return (getCategoryRecords?.() || getCategories?.() || []).map(safeBridgeCategory).filter(Boolean);
    }

    if (normalizedMethod === 'posts.list') {
      if (typeof onCustomWorldListPosts !== 'function') return [];
      return onCustomWorldListPosts({ world: activeWorld, params });
    }

    if (normalizedMethod === 'posts.create') {
      if (typeof onCustomWorldCreatePost !== 'function') return null;
      return onCustomWorldCreatePost({ world: activeWorld, params });
    }

    if (normalizedMethod === 'posts.open') {
      if (typeof onCustomWorldOpenPost !== 'function') return false;
      return Boolean(await onCustomWorldOpenPost({ world: activeWorld, postId: params?.postId }));
    }

    if (normalizedMethod === 'posts.openCreateForm') {
      if (typeof onCustomWorldOpenPostForm !== 'function') return false;
      return Boolean(await onCustomWorldOpenPostForm({ world: activeWorld }));
    }

    if (normalizedMethod === 'comments.list') {
      if (typeof onCustomWorldListComments !== 'function') return [];
      return onCustomWorldListComments({ world: activeWorld, postId: params?.postId });
    }

    if (normalizedMethod === 'comments.create') {
      if (typeof onCustomWorldCreateComment !== 'function') return null;
      return onCustomWorldCreateComment({
        world: activeWorld,
        postId: params?.postId,
        body: params?.body
      });
    }

    if (normalizedMethod === 'worlds.list') {
      const childWorlds = await loadWorlds({ parentWorldId: activeWorld.id });
      return (childWorlds || []).map(safeBridgeWorld).filter(Boolean);
    }

    if (normalizedMethod === 'worlds.create') {
      return createCustomWorldForBridge(params || {});
    }

    if (normalizedMethod === 'worlds.open') {
      await openWorldById(params?.worldId);
      return true;
    }

    if (normalizedMethod === 'worlds.openMaker') {
      return Boolean(await openMaker());
    }

    throw new Error(`Unknown custom world method: ${normalizedMethod}`);
  }

  function postCustomWorldFrameMessage(message, origin = '*') {
    if (!dom.modeFrame?.contentWindow || !activeWorld?.id || !canUseCustomWorldFrame(activeWorld)) return;
    const targetOrigin = origin && origin !== 'null' ? origin : '*';
    dom.modeFrame.contentWindow.postMessage({
      demo0WorldBridge: true,
      ...message
    }, targetOrigin);
  }

  async function postCustomWorldBridgeReady() {
    if (!dom.modeFrame?.contentWindow || !activeWorld?.id || !canUseCustomWorldFrame(activeWorld)) return;
    try {
      postCustomWorldFrameMessage({
        type: 'ready',
        payload: await getCustomWorldBridgeContext()
      });
    } catch (error) {
      postCustomWorldFrameMessage({
        type: 'error',
        error: getErrorMessage(error)
      });
    }
  }

  async function handleCustomWorldBridgeMessage(event) {
    const data = event?.data || null;
    if (!data || data.demo0WorldBridge !== true || data.type !== 'request') return;
    if (!isActiveCustomWorldFrame(event.source)) return;

    const requestId = data.requestId || null;
    try {
      const result = await runCustomWorldBridgeMethod(data.method, data.params || {});
      postCustomWorldFrameMessage({
        type: 'response',
        requestId,
        ok: true,
        payload: result
      }, event.origin);
    } catch (error) {
      postCustomWorldFrameMessage({
        type: 'response',
        requestId,
        ok: false,
        error: getErrorMessage(error)
      }, event.origin);
    }
  }

  function readPasswordInput(input) {
    return String(getFakePasswordValue(input) || '').trim();
  }

  function writePasswordInput(input, value = '') {
    setFakePasswordValue(input, value);
  }

  function getMakerColorSource(isEdit = false) {
    return isEdit ? (makerEditingWorld || {}) : (activeWorld || {});
  }

  function applyMakerStyleDefaults(prefix, source = {}) {
    const fontSelect = prefix === 'code' ? dom.codeFont : dom.plugFont;
    const bgInput = prefix === 'code' ? dom.codeBackgroundColor : dom.plugBackgroundColor;
    const fontColorInput = prefix === 'code' ? dom.codeFontColor : dom.plugFontColor;

    if (fontSelect) {
      const nextFont = String(source.font_family || WORLD_FONTS[0]?.value || '').trim();
      fontSelect.value = nextFont;
      if (fontSelect.value !== nextFont && fontSelect.options.length) {
        fontSelect.selectedIndex = 0;
      }
    }

    if (bgInput) {
      bgInput.value = normalizeColorInputValue(source.background_color || source.ui_color || '#05070b', '#05070b');
    }

    if (fontColorInput) {
      fontColorInput.value = normalizeColorInputValue(source.font_color || source.ui_color || DEFAULT_UI_COLOR, DEFAULT_UI_COLOR);
    }
  }

  function applyMakerOverlayTheme(source = null) {
    if (!dom.makerOverlay) return;

    const bg = normalizeColorInputValue(source?.background_color || source?.ui_color || '', '');
    const fg = normalizeColorInputValue(source?.font_color || source?.ui_color || '', '');
    const font = String(source?.font_family || '').trim();

    if (bg) dom.makerOverlay.style.setProperty('--post-overlay-bg', bg);
    else dom.makerOverlay.style.removeProperty('--post-overlay-bg');

    if (fg) dom.makerOverlay.style.setProperty('--post-overlay-color', fg);
    else dom.makerOverlay.style.removeProperty('--post-overlay-color');

    if (font) dom.makerOverlay.style.setProperty('--world-maker-font-family', font);
    else dom.makerOverlay.style.removeProperty('--world-maker-font-family');
  }

  function clearMakerOverlayTheme() {
    if (!dom.makerOverlay) return;
    dom.makerOverlay.style.removeProperty('--post-overlay-bg');
    dom.makerOverlay.style.removeProperty('--post-overlay-color');
    dom.makerOverlay.style.removeProperty('--world-maker-font-family');
  }

  function readMakerStyle(prefix) {
    const fontSelect = prefix === 'code' ? dom.codeFont : dom.plugFont;
    const bgInput = prefix === 'code' ? dom.codeBackgroundColor : dom.plugBackgroundColor;
    const fontColorInput = prefix === 'code' ? dom.codeFontColor : dom.plugFontColor;
    const fontColor = normalizeColorInputValue(fontColorInput?.value, DEFAULT_UI_COLOR);
    return {
      font_family: String(fontSelect?.value || WORLD_FONTS[0]?.value || '').trim() || null,
      font_color: fontColor,
      ui_color: fontColor,
      background_color: normalizeColorInputValue(bgInput?.value, '#05070b')
    };
  }

  // ─── Plug Category Widget ─────────────────────────────────────────────────
  let plugCategorySelected = '';
  let plugCategoryEditingName = null;
  let plugColorPickerState = { h: 200, s: 0.5, v: 0.9, categoryName: null };
  let plugColorPickerEl = null;

  function clampNum(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function plugHsvToHex(h, s, v) {
    const hue = ((Number(h) % 360) + 360) % 360;
    const sat = clampNum(Number(s), 0, 1);
    const val = clampNum(Number(v), 0, 1);
    const c = val * sat;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = val - c;
    let r = 0, g = 0, b = 0;
    if (hue < 60) { r = c; g = x; }
    else if (hue < 120) { r = x; g = c; }
    else if (hue < 180) { g = c; b = x; }
    else if (hue < 240) { g = x; b = c; }
    else if (hue < 300) { r = x; b = c; }
    else { r = c; b = x; }
    const toH = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
    return `#${toH(r)}${toH(g)}${toH(b)}`;
  }

  function plugHexToHsv(hex) {
    const raw = String(hex || '#808080').replace(/^#/, '');
    const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw.padEnd(6, '0');
    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hh = 0;
    if (delta !== 0) {
      if (max === r) hh = ((g - b) / delta) % 6;
      else if (max === g) hh = ((b - r) / delta) + 2;
      else hh = ((r - g) / delta) + 4;
      hh *= 60;
      if (hh < 0) hh += 360;
    }
    return { h: hh, s: max === 0 ? 0 : delta / max, v: max };
  }

  function getPlugPickerHex() {
    return plugHsvToHex(plugColorPickerState.h, plugColorPickerState.s, plugColorPickerState.v);
  }

  function setPlugCategory(val) {
    plugCategorySelected = val || '';
    if (dom.plugCategoryHidden) dom.plugCategoryHidden.value = plugCategorySelected;
    if (dom.plugCategoryDisplayText) {
      dom.plugCategoryDisplayText.textContent = plugCategorySelected || 'select category';
      dom.plugCategoryDisplayText.classList.toggle('is-placeholder', !plugCategorySelected);
    }
  }

  function openPlugCategoryDropdown() {
    closePlugCategoryPanel();
    if (dom.plugCategoryDropdown) dom.plugCategoryDropdown.style.display = 'flex';
    dom.plugCategoryDisplay?.classList.add('is-open');
    dom.plugCategoryDropdownToggle?.classList.add('is-open');
  }

  function closePlugCategoryDropdown() {
    if (dom.plugCategoryDropdown) dom.plugCategoryDropdown.style.display = 'none';
    dom.plugCategoryDisplay?.classList.remove('is-open');
    dom.plugCategoryDropdownToggle?.classList.remove('is-open');
  }

  function openPlugCategoryPanel() {
    plugCategoryEditingName = null;
    closePlugCategoryDropdown();
    closePlugColorPicker();
    renderPlugCategoryEditor();
    if (dom.plugCategoryPanel) {
      dom.plugCategoryPanel.style.display = 'flex';
      dom.plugCategoryPanel.classList.add('is-open');
    }
    dom.plugCategoryEditorToggle?.classList.add('is-open');
  }

  function closePlugCategoryPanel() {
    plugCategoryEditingName = null;
    closePlugColorPicker();
    renderPlugCategoryEditor();
    if (dom.plugCategoryPanel) {
      dom.plugCategoryPanel.style.display = 'none';
      dom.plugCategoryPanel.classList.remove('is-open');
    }
    dom.plugCategoryEditorToggle?.classList.remove('is-open');
  }

  function renderPlugCategoryDropdown() {
    if (!dom.plugCategoryDropdown) return;
    const categories = getCategories?.() || [];
    dom.plugCategoryDropdown.innerHTML = '';
    const noneItem = document.createElement('div');
    noneItem.className = 'post-form-category-option';
    noneItem.dataset.value = '';
    noneItem.textContent = 'none';
    noneItem.addEventListener('click', () => { setPlugCategory(''); closePlugCategoryDropdown(); });
    dom.plugCategoryDropdown.appendChild(noneItem);
    categories.forEach((cat) => {
      const item = document.createElement('div');
      item.className = 'post-form-category-option';
      item.dataset.value = cat.name;
      item.textContent = cat.name;
      item.addEventListener('click', () => { setPlugCategory(cat.name); closePlugCategoryDropdown(); });
      dom.plugCategoryDropdown.appendChild(item);
    });
  }

  function renderPlugCategoryEditor() {
    if (!dom.plugCategoryList) return;
    const records = getCategoryRecords?.() || [];
    const editable = records.filter((cat) => canEditCategory?.(cat) ?? true);
    if (!editable.length) {
      dom.plugCategoryList.innerHTML = '<div class="post-form-category-empty">no editable categories yet</div>';
      return;
    }
    dom.plugCategoryList.innerHTML = editable.map((cat) => {
      const name = String(cat.name || '');
      const enc = encodeURIComponent(name);
      const isEditing = plugCategoryEditingName === name;
      const color = getCategoryColor?.(cat) || '#888';
      const swatch = `<button type="button" class="post-form-category-color-swatch" data-action="recolor" data-category-name="${enc}" aria-label="set category color" style="background:${escapeHtml(color)};"></button>`;
      if (isEditing) {
        return `<div class="post-form-category-item" data-category-name="${enc}">${swatch}<input type="text" class="post-form-category-edit-input" value="${escapeHtml(name)}" data-category-edit-input="${enc}"><div class="post-form-category-actions"><button type="button" class="post-form-category-action delete" data-action="delete" data-category-name="${enc}">x</button></div></div>`;
      }
      return `<div class="post-form-category-item" data-category-name="${enc}">${swatch}<span class="post-form-category-name">${escapeHtml(name)}</span><div class="post-form-category-actions"><button type="button" class="post-form-category-action delete" data-action="delete" data-category-name="${enc}">x</button></div></div>`;
    }).join('');
    if (plugCategoryEditingName) {
      const input = dom.plugCategoryList.querySelector('.post-form-category-edit-input');
      input?.focus();
      const pos = input?.value?.length || 0;
      input?.setSelectionRange(pos, pos);
    }
  }

  function ensurePlugColorPicker() {
    if (plugColorPickerEl?.root?.isConnected) return plugColorPickerEl;
    if (!dom.plugCategoryPanel) return null;
    const root = document.createElement('div');
    root.className = 'post-form-category-picker';
    root.style.display = 'none';
    root.innerHTML = `
      <div class="post-form-category-picker-sv" data-role="sv">
        <div class="post-form-category-picker-sv-cursor" data-role="sv-cursor"></div>
      </div>
      <input type="range" min="0" max="360" step="1" class="post-form-category-picker-hue" data-role="hue" aria-label="category hue">
      <button type="button" class="post-form-category-picker-submit" data-role="submit" aria-label="save category color">✓</button>
    `;
    dom.plugCategoryPanel.appendChild(root);
    const sv = root.querySelector('[data-role="sv"]');
    const svCursor = root.querySelector('[data-role="sv-cursor"]');
    const hueInput = root.querySelector('[data-role="hue"]');
    const submitButton = root.querySelector('[data-role="submit"]');
    const syncUi = () => {
      const hue = clampNum(plugColorPickerState.h, 0, 360);
      const sat = clampNum(plugColorPickerState.s, 0, 1);
      const val = clampNum(plugColorPickerState.v, 0, 1);
      sv.style.setProperty('--picker-hue', String(hue));
      svCursor.style.left = `${sat * 100}%`;
      svCursor.style.top = `${(1 - val) * 100}%`;
      hueInput.value = String(hue);
      submitButton.style.background = getPlugPickerHex();
    };
    const setSvFromPointer = (e) => {
      const rect = sv.getBoundingClientRect();
      plugColorPickerState.s = rect.width > 0 ? clampNum(e.clientX - rect.left, 0, rect.width) / rect.width : 0;
      plugColorPickerState.v = rect.height > 0 ? 1 - clampNum(e.clientY - rect.top, 0, rect.height) / rect.height : 0;
      syncUi();
    };
    let dragging = false;
    sv.addEventListener('pointerdown', (e) => { dragging = true; sv.setPointerCapture(e.pointerId); setSvFromPointer(e); });
    sv.addEventListener('pointermove', (e) => { if (dragging) setSvFromPointer(e); });
    sv.addEventListener('pointerup', () => { dragging = false; });
    sv.addEventListener('pointercancel', () => { dragging = false; });
    hueInput.addEventListener('input', () => { plugColorPickerState.h = Number(hueInput.value || 0); syncUi(); });
    submitButton.addEventListener('click', async () => {
      if (!plugColorPickerState.categoryName) return;
      const ok = await onUpdateCategoryColor?.(plugColorPickerState.categoryName, getPlugPickerHex());
      if (ok) { closePlugColorPicker(); renderPlugCategoryEditor(); }
    });
    plugColorPickerEl = { root, syncUi };
    return plugColorPickerEl;
  }

  function openPlugColorPicker(categoryName, currentColor, anchorEl) {
    const picker = ensurePlugColorPicker();
    if (!picker || !dom.plugCategoryPanel) return;
    const hsv = plugHexToHsv(currentColor);
    plugColorPickerState = { categoryName, h: hsv.h, s: hsv.s, v: hsv.v };
    picker.root.style.display = 'grid';
    picker.syncUi();
    // Position relative to the panel
    const panelRect = dom.plugCategoryPanel.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    let left = (anchorRect.right - panelRect.left) + 10;
    let top = anchorRect.top - panelRect.top - 4;
    const pw = picker.root.offsetWidth || 148;
    const ph = picker.root.offsetHeight || 180;
    const panelW = dom.plugCategoryPanel.clientWidth;
    const panelH = dom.plugCategoryPanel.clientHeight;
    if (left + pw > panelW - 8) left = (anchorRect.left - panelRect.left) - pw - 10;
    if (left < 8) left = 8;
    if (top + ph > panelH - 8) top = panelH - ph - 8;
    if (top < 8) top = 8;
    picker.root.style.left = `${Math.round(left)}px`;
    picker.root.style.top = `${Math.round(top)}px`;
  }

  function closePlugColorPicker() {
    if (!plugColorPickerEl) return;
    plugColorPickerEl.root.style.display = 'none';
    plugColorPickerState.categoryName = null;
  }

  function wirePlugCategoryEvents() {
    dom.plugCategoryDropdownToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dom.plugCategoryDropdown?.style.display === 'flex') {
        closePlugCategoryDropdown();
      } else {
        openPlugCategoryDropdown();
      }
    });

    dom.plugCategoryEditorToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      closePlugCategoryDropdown();
      if (dom.plugCategoryPanel?.style.display === 'none' || dom.plugCategoryPanel?.style.display === '') {
        openPlugCategoryPanel();
        dom.plugCategoryInput?.focus();
      } else {
        closePlugCategoryPanel();
      }
    });

    dom.plugCategoryDisplay?.addEventListener('click', (e) => {
      if (e.target.closest('.post-form-category-inline-btn')) return;
      if (dom.plugCategoryDropdown?.style.display === 'flex') {
        closePlugCategoryDropdown();
      } else {
        closePlugCategoryPanel();
        openPlugCategoryDropdown();
      }
    });

    dom.plugCategoryDisplay?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (dom.plugCategoryDropdown?.style.display === 'flex') {
        closePlugCategoryDropdown();
      } else {
        closePlugCategoryPanel();
        openPlugCategoryDropdown();
      }
    });

    dom.plugCategoryCreateBtn?.addEventListener('click', async () => {
      const name = String(dom.plugCategoryInput?.value || '').trim();
      if (!name) return;
      const ok = await onAddCategory?.(name);
      if (ok) {
        dom.plugCategoryInput.value = '';
        setPlugCategory(name);
        renderPlugCategoryEditor();
        renderPlugCategoryDropdown();
      }
    });

    dom.plugCategoryInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); dom.plugCategoryCreateBtn?.click(); }
    });

    dom.plugCategoryList?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const name = decodeURIComponent(btn.dataset.categoryName || '');
      if (action === 'recolor') {
        const records = getCategoryRecords?.() || [];
        const rec = records.find((r) => String(r?.name || '') === name) || null;
        const color = getCategoryColor?.(rec) || '#888';
        openPlugColorPicker(name, color, btn);
        return;
      }
      if (action === 'delete') {
        closePlugColorPicker();
        await onDeleteCategory?.(name);
        if (plugCategorySelected === name) setPlugCategory('');
        renderPlugCategoryEditor();
        renderPlugCategoryDropdown();
      }
    });

    dom.plugCategoryList?.addEventListener('dblclick', (e) => {
      const nameEl = e.target.closest('.post-form-category-name');
      if (!nameEl) return;
      const item = nameEl.closest('.post-form-category-item');
      const name = decodeURIComponent(item?.dataset.categoryName || '');
      if (!name) return;
      const records = getCategoryRecords?.() || [];
      const rec = records.find((r) => String(r?.name || '') === name) || null;
      if (!(canEditCategory?.(rec) ?? false)) return;
      plugCategoryEditingName = name;
      closePlugColorPicker();
      renderPlugCategoryEditor();
    });

    dom.plugCategoryList?.addEventListener('keydown', async (e) => {
      const input = e.target.closest('.post-form-category-edit-input');
      if (!input) return;
      const oldName = decodeURIComponent(input.dataset.categoryEditInput || '');
      if (e.key === 'Enter') {
        e.preventDefault();
        await onRenameCategory?.(oldName, input.value || '');
        plugCategoryEditingName = null;
        renderPlugCategoryEditor();
        renderPlugCategoryDropdown();
        if (plugCategorySelected === oldName) setPlugCategory(input.value || '');
      }
      if (e.key === 'Escape') {
        plugCategoryEditingName = null;
        renderPlugCategoryEditor();
      }
    });

    dom.plugCategoryPanel?.addEventListener('click', (e) => {
      if (!plugColorPickerEl?.root || plugColorPickerEl.root.style.display === 'none') return;
      if (!e.target.closest('.post-form-category-picker') && !e.target.closest('.post-form-category-color-swatch')) {
        closePlugColorPicker();
      }
    });

    document.addEventListener('click', (e) => {
      if (!dom.plugCategoryDropdown) return;
      if (!e.target.closest('#worldPlugCategoryCustom')) {
        closePlugCategoryDropdown();
      }
    });
  }
  // ─── End Plug Category Widget ─────────────────────────────────────────────

  // ─── Code World Category Widget ───────────────────────────────────────────
  let codeCategorySelected = '';
  let codeCategoryEditingName = null;

  function setCodeCategory(val) {
    codeCategorySelected = val || '';
    if (dom.codeCategoryHidden) dom.codeCategoryHidden.value = codeCategorySelected;
    if (dom.codeCategoryDisplayText) {
      dom.codeCategoryDisplayText.textContent = codeCategorySelected || 'select category';
      dom.codeCategoryDisplayText.classList.toggle('is-placeholder', !codeCategorySelected);
    }
  }

  function openCodeCategoryDropdown() {
    closeCodeCategoryPanel();
    if (dom.codeCategoryDropdown) dom.codeCategoryDropdown.style.display = 'flex';
    dom.codeCategoryDisplay?.classList.add('is-open');
    dom.codeCategoryDropdownToggle?.classList.add('is-open');
  }

  function closeCodeCategoryDropdown() {
    if (dom.codeCategoryDropdown) dom.codeCategoryDropdown.style.display = 'none';
    dom.codeCategoryDisplay?.classList.remove('is-open');
    dom.codeCategoryDropdownToggle?.classList.remove('is-open');
  }

  function openCodeCategoryPanel() {
    codeCategoryEditingName = null;
    closeCodeCategoryDropdown();
    renderCodeCategoryEditor();
    if (dom.codeCategoryPanel) {
      dom.codeCategoryPanel.style.display = 'flex';
      dom.codeCategoryPanel.classList.add('is-open');
    }
    dom.codeCategoryEditorToggle?.classList.add('is-open');
  }

  function closeCodeCategoryPanel() {
    codeCategoryEditingName = null;
    renderCodeCategoryEditor();
    if (dom.codeCategoryPanel) {
      dom.codeCategoryPanel.style.display = 'none';
      dom.codeCategoryPanel.classList.remove('is-open');
    }
    dom.codeCategoryEditorToggle?.classList.remove('is-open');
  }

  function renderCodeCategoryDropdown() {
    if (!dom.codeCategoryDropdown) return;
    const categories = getCategories?.() || [];
    dom.codeCategoryDropdown.innerHTML = '';
    const noneItem = document.createElement('div');
    noneItem.className = 'post-form-category-option';
    noneItem.dataset.value = '';
    noneItem.textContent = 'none';
    noneItem.addEventListener('click', () => { setCodeCategory(''); closeCodeCategoryDropdown(); });
    dom.codeCategoryDropdown.appendChild(noneItem);
    categories.forEach((cat) => {
      const item = document.createElement('div');
      item.className = 'post-form-category-option';
      item.dataset.value = cat.name;
      item.textContent = cat.name;
      item.addEventListener('click', () => { setCodeCategory(cat.name); closeCodeCategoryDropdown(); });
      dom.codeCategoryDropdown.appendChild(item);
    });
  }

  function renderCodeCategoryEditor() {
    if (!dom.codeCategoryList) return;
    const records = getCategoryRecords?.() || [];
    const editable = records.filter((cat) => canEditCategory?.(cat) ?? true);
    if (!editable.length) {
      dom.codeCategoryList.innerHTML = '<div class="post-form-category-empty">no editable categories yet</div>';
      return;
    }
    dom.codeCategoryList.innerHTML = editable.map((cat) => {
      const name = String(cat.name || '');
      const enc = encodeURIComponent(name);
      const isEditing = codeCategoryEditingName === name;
      if (isEditing) {
        return `<div class="post-form-category-item" data-category-name="${enc}"><input type="text" class="post-form-category-edit-input" value="${escapeHtml(name)}" data-category-edit-input="${enc}"><div class="post-form-category-actions"><button type="button" class="post-form-category-action delete" data-action="delete" data-category-name="${enc}">x</button></div></div>`;
      }
      return `<div class="post-form-category-item" data-category-name="${enc}"><span class="post-form-category-name">${escapeHtml(name)}</span><div class="post-form-category-actions"><button type="button" class="post-form-category-action delete" data-action="delete" data-category-name="${enc}">x</button></div></div>`;
    }).join('');
    if (codeCategoryEditingName) {
      const input = dom.codeCategoryList.querySelector('.post-form-category-edit-input');
      input?.focus();
      const pos = input?.value?.length || 0;
      input?.setSelectionRange(pos, pos);
    }
  }

  function wireCodeCategoryEvents() {
    dom.codeCategoryDropdownToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dom.codeCategoryDropdown?.style.display === 'flex') closeCodeCategoryDropdown();
      else openCodeCategoryDropdown();
    });

    dom.codeCategoryEditorToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeCodeCategoryDropdown();
      if (dom.codeCategoryPanel?.style.display === 'none' || dom.codeCategoryPanel?.style.display === '') {
        openCodeCategoryPanel();
        dom.codeCategoryInput?.focus();
      } else {
        closeCodeCategoryPanel();
      }
    });

    dom.codeCategoryDisplay?.addEventListener('click', (e) => {
      if (e.target.closest('.post-form-category-inline-btn')) return;
      if (dom.codeCategoryDropdown?.style.display === 'flex') closeCodeCategoryDropdown();
      else { closeCodeCategoryPanel(); openCodeCategoryDropdown(); }
    });

    dom.codeCategoryDisplay?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (dom.codeCategoryDropdown?.style.display === 'flex') closeCodeCategoryDropdown();
      else { closeCodeCategoryPanel(); openCodeCategoryDropdown(); }
    });

    dom.codeCategoryCreateBtn?.addEventListener('click', async () => {
      const name = String(dom.codeCategoryInput?.value || '').trim();
      if (!name) return;
      const ok = await onAddCategory?.(name);
      if (ok) {
        dom.codeCategoryInput.value = '';
        setCodeCategory(name);
        renderPlugCategoryEditor();
        renderPlugCategoryDropdown();
        renderCodeCategoryEditor();
        renderCodeCategoryDropdown();
      }
    });

    dom.codeCategoryInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); dom.codeCategoryCreateBtn?.click(); }
    });

    dom.codeCategoryList?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const name = decodeURIComponent(btn.dataset.categoryName || '');
      if (action === 'delete') {
        await onDeleteCategory?.(name);
        if (codeCategorySelected === name) setCodeCategory('');
        if (plugCategorySelected === name) setPlugCategory('');
        renderPlugCategoryEditor();
        renderPlugCategoryDropdown();
        renderCodeCategoryEditor();
        renderCodeCategoryDropdown();
      }
    });

    dom.codeCategoryList?.addEventListener('dblclick', (e) => {
      const nameEl = e.target.closest('.post-form-category-name');
      if (!nameEl) return;
      const item = nameEl.closest('.post-form-category-item');
      const name = decodeURIComponent(item?.dataset.categoryName || '');
      if (!name) return;
      const records = getCategoryRecords?.() || [];
      const rec = records.find((record) => String(record?.name || '') === name) || null;
      if (!(canEditCategory?.(rec) ?? false)) return;
      codeCategoryEditingName = name;
      renderCodeCategoryEditor();
    });

    dom.codeCategoryList?.addEventListener('keydown', async (e) => {
      const input = e.target.closest('.post-form-category-edit-input');
      if (!input) return;
      const oldName = decodeURIComponent(input.dataset.categoryEditInput || '');
      if (e.key === 'Enter') {
        e.preventDefault();
        await onRenameCategory?.(oldName, input.value || '');
        codeCategoryEditingName = null;
        renderPlugCategoryEditor();
        renderPlugCategoryDropdown();
        renderCodeCategoryEditor();
        renderCodeCategoryDropdown();
        if (codeCategorySelected === oldName) setCodeCategory(input.value || '');
        if (plugCategorySelected === oldName) setPlugCategory(input.value || '');
      }
      if (e.key === 'Escape') {
        codeCategoryEditingName = null;
        renderCodeCategoryEditor();
      }
    });

    document.addEventListener('click', (e) => {
      if (!dom.codeCategoryDropdown) return;
      if (!e.target.closest('#worldCodeCategoryCustom')) {
        closeCodeCategoryDropdown();
      }
    });
  }
  // ─── End Code World Category Widget ───────────────────────────────────────

  function captureMakerState() {
    return {
      plugName: String(dom.plugName?.value || '').trim(),
      plugFont: String(dom.plugFont?.value || ''),
      plugBackgroundColor: String(dom.plugBackgroundColor?.value || ''),
      plugFontColor: String(dom.plugFontColor?.value || ''),
      plugVisibility: String(dom.plugVisibility?.value || ''),
      plugEditing: String(dom.plugEditing?.value || ''),
      plugViewPassword: readPasswordInput(dom.plugViewPassword),
      plugViewPasswordConfirm: readPasswordInput(dom.plugViewPasswordConfirm),
      plugEditPassword: readPasswordInput(dom.plugEditPassword),
      plugEditPasswordConfirm: readPasswordInput(dom.plugEditPasswordConfirm),
      plugCoverSelected: Boolean(dom.plugCover?.files?.length),
      plugBackgroundSelected: Boolean(dom.plugBackground?.files?.length),
      codeName: String(dom.codeName?.value || '').trim(),
      codeCategory: String(dom.codeCategoryHidden?.value || '').trim(),
      codeFont: String(dom.codeFont?.value || ''),
      codeBackgroundColor: String(dom.codeBackgroundColor?.value || ''),
      codeFontColor: String(dom.codeFontColor?.value || ''),
      codeVisibility: String(dom.codeVisibility?.value || ''),
      codeEditing: String(dom.codeEditing?.value || ''),
      codeViewPassword: readPasswordInput(dom.codeViewPassword),
      codeViewPasswordConfirm: readPasswordInput(dom.codeViewPasswordConfirm),
      codeEditPassword: readPasswordInput(dom.codeEditPassword),
      codeEditPasswordConfirm: readPasswordInput(dom.codeEditPasswordConfirm),
      codeHtmlSelected: Boolean(dom.codeHtml?.files?.length),
      codeCssSelected: Boolean(dom.codeCss?.files?.length),
      codeAssetsSelected: Boolean(dom.codeAssets?.files?.length),
      codeCoverSelected: Boolean(dom.codeCover?.files?.length)
    };
  }

  function hasUnsavedMakerChanges() {
    if (!isMakerOpen() || !makerBaselineState) return false;
    const current = captureMakerState();
    const keys = Object.keys(makerBaselineState);
    return keys.some((key) => current[key] !== makerBaselineState[key]);
  }

  async function maybeCloseMaker(options = {}) {
    if (!isMakerOpen()) return true;

    const {
      title: customTitle = '',
      message: customMessage = ''
    } = options;

    if (hasUnsavedMakerChanges()) {
      let shouldClose = false;
      const title = customTitle || 'discard world maker changes?';
      const message = customMessage || 'You have unsaved world maker changes. Closing now will lose them.';

      if (typeof window.__prettyConfirm === 'function') {
        shouldClose = await window.__prettyConfirm({
          title,
          message,
          confirmLabel: 'discard',
          cancelLabel: 'keep editing',
          danger: true
        });
      } else {
        shouldClose = window.confirm('Unsaved changes will be lost. Close anyway?');
      }

      if (!shouldClose) return false;
    }

    closeMaker();
    return true;
  }

  function closeWorldDropdowns(exceptSelect = null) {
    worldDropdownControllers.forEach((controller, selectEl) => {
      if (exceptSelect && selectEl === exceptSelect) return;
      controller.close();
    });
  }

  function syncWorldDropdown(selectEl) {
    worldDropdownControllers.get(selectEl)?.sync();
  }

  function renderWorldDropdown(selectEl) {
    worldDropdownControllers.get(selectEl)?.render();
  }

  function syncWorldDropdowns() {
    worldDropdownControllers.forEach((controller) => controller.sync());
  }

  function setupWorldDropdown(selectEl, options = {}) {
    if (!selectEl) return null;
    const wrapper = selectEl.closest('[data-world-dropdown]');
    const display = wrapper?.querySelector('[data-world-dropdown-display]');
    const text = wrapper?.querySelector('[data-world-dropdown-text]');
    const list = wrapper?.querySelector('[data-world-dropdown-list]');
    if (!wrapper || !display || !text || !list) return null;

    const placeholder = options.placeholder || '';
    const useOptionFontFamily = Boolean(options.useOptionFontFamily);

    const sync = () => {
      const optionEls = Array.from(selectEl.options || []);
      const selected = optionEls.find((option) => option.value === selectEl.value) || optionEls[0] || null;
      text.textContent = selected?.textContent || placeholder;
      text.classList.toggle('is-placeholder', !(selected?.value ?? '').trim() && Boolean(placeholder));

      Array.from(list.children).forEach((item) => {
        item.classList.toggle('is-selected', item.dataset.value === selectEl.value);
        item.setAttribute('aria-selected', item.dataset.value === selectEl.value ? 'true' : 'false');
      });
    };

    const close = () => {
      list.style.display = 'none';
      display.classList.remove('is-open');
      display.setAttribute('aria-expanded', 'false');
    };

    const open = () => {
      closeWorldDropdowns(selectEl);
      list.style.display = 'flex';
      display.classList.add('is-open');
      display.setAttribute('aria-expanded', 'true');
    };

    const render = () => {
      list.innerHTML = '';
      Array.from(selectEl.options || []).forEach((option) => {
        const item = document.createElement('div');
        item.className = 'world-maker-dropdown-option ui-dropdown-option';
        item.dataset.value = option.value;
        item.setAttribute('role', 'option');
        item.textContent = option.textContent || option.value;
        if (useOptionFontFamily) item.style.fontFamily = option.value || 'inherit';
        item.addEventListener('click', (event) => {
          event.stopPropagation();
          if (selectEl.value !== option.value) {
            selectEl.value = option.value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            sync();
          }
          close();
        });
        list.appendChild(item);
      });
      sync();
    };

    display.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (list.style.display === 'flex') {
        close();
      } else {
        open();
      }
    });

    display.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (list.style.display === 'flex') close();
        else open();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });

    selectEl.addEventListener('change', sync);

    const controller = { sync, close, open, render };
    worldDropdownControllers.set(selectEl, controller);
    render();
    return controller;
  }

  function getMyWorldStorageKey(userId) {
    return `${MY_WORLDS_STORAGE_PREFIX}:${String(userId || 'guest')}`;
  }

  function dedupeWorldIds(ids = []) {
    const seen = new Set();
    const next = [];
    ids.forEach((id) => {
      const normalized = String(id || '').trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      next.push(normalized);
    });
    return next;
  }

  async function loadDirectChildWorlds(parentWorldId) {
    const normalizedParentId = String(parentWorldId || '').trim();
    if (!normalizedParentId) return [];

    const { data, error } = await supabase
      .from('worlds')
      .select('id, parent_world_id, user_id, name')
      .eq('parent_world_id', normalizedParentId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async function loadDescendantWorlds(rootWorldId) {
    const descendants = [];
    let frontier = [String(rootWorldId || '').trim()].filter(Boolean);

    while (frontier.length > 0) {
      const { data, error } = await supabase
        .from('worlds')
        .select('id, parent_world_id, user_id, name')
        .in('parent_world_id', frontier)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const rows = data || [];
      if (!rows.length) break;

      descendants.push(...rows);
      frontier = rows.map((row) => String(row.id || '').trim()).filter(Boolean);
    }

    return descendants;
  }

  async function chooseChildWorldDeleteMode(world, childWorlds = []) {
    if (!childWorlds.length) {
      return 'delete-children';
    }

    const title = String(world?.name || DEFAULT_WORLD_TITLE);
    const childCount = childWorlds.length;
    const message = `${title} contains ${childCount} nested world${childCount === 1 ? '' : 's'}.

Delete contained worlds to remove the full subtree, or move only the direct child worlds to main so they become top-level worlds.`;

    if (typeof window.__prettyChoice === 'function') {
      return window.__prettyChoice({
        title: 'nested worlds detected',
        message,
        cancelLabel: 'cancel',
        theme: 'post-delete',
        choices: [
          { value: 'delete-children', label: 'delete contained worlds', danger: true },
          { value: 'transfer-children', label: 'move child worlds to main' }
        ]
      });
    }

    const shouldDelete = window.confirm(`${message}\n\nPress OK to delete contained worlds, or Cancel to keep them at main.`);
    return shouldDelete ? 'delete-children' : 'transfer-children';
  }

  function readStoredMyWorldIds(userId) {
    if (!userId) return [];
    try {
      const raw = window.localStorage.getItem(getMyWorldStorageKey(userId));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return dedupeWorldIds(parsed).slice(0, MY_WORLDS_LIMIT);
    } catch {
      return [];
    }
  }

  function persistMyWorldIds(userId) {
    if (!userId) return;
    try {
      window.localStorage.setItem(getMyWorldStorageKey(userId), JSON.stringify(myWorldIds.slice(0, MY_WORLDS_LIMIT)));
    } catch {
      // Best-effort persistence only.
    }
  }

  function setWorldUrl(world) {
    const slug = getWorldPathSlug(world);
    if (!slug) return;
    const current = new URL(window.location.href);
    const currentSlug = normalizeWorldPathSegment(current.pathname);
    if (currentSlug === slug && !current.searchParams.has(WORLD_QUERY_PARAM)) return;

    const next = new URL(window.location.href);
    next.pathname = `/${encodeURIComponent(slug)}`;
    next.search = '';
    window.history.replaceState(window.history.state, '', `${next.pathname}${next.search}${next.hash}`);
  }

  function clearWorldUrl() {
    const current = new URL(window.location.href);
    const hasWorldQuery = current.searchParams.has(WORLD_QUERY_PARAM);
    const hasWorldPath = Boolean(normalizeWorldPathSegment(current.pathname));
    if (!hasWorldQuery && !hasWorldPath) return;

    const next = new URL(window.location.href);
    next.pathname = '/';
    next.search = '';
    window.history.replaceState(window.history.state, '', `${next.pathname}${next.hash}`);
  }

  async function loadWorldRowsByIds(worldIds = []) {
    const ids = dedupeWorldIds(worldIds);
    if (!ids.length) return [];

    const { data, error } = await supabase
      .from('worlds')
      .select('*')
      .in('id', ids);

    if (error) {
      console.warn('Failed to load remembered worlds:', error);
      return [];
    }

    return data || [];
  }

  async function ensureMyWorldRowsLoaded(worldIds = []) {
    const ids = dedupeWorldIds(worldIds);
    const missing = ids.filter((id) => !myWorldMap.has(id));
    if (!missing.length) return;

    const rows = await loadWorldRowsByIds(missing);
    rows.forEach((row) => {
      if (row?.id) myWorldMap.set(String(row.id), row);
    });
  }

  async function hydrateMyWorlds() {
    if (myWorldsHydrated) return;
    myWorldsHydrated = true;

    const currentUserId = getCurrentUser?.()?.id || null;
    if (!currentUserId) {
      myWorldIds = [];
      myWorldMap = new Map();
      return;
    }

    const storedIds = readStoredMyWorldIds(currentUserId);
    myWorldIds = dedupeWorldIds(storedIds).slice(0, MY_WORLDS_LIMIT);
    await ensureMyWorldRowsLoaded(myWorldIds);
    persistMyWorldIds(currentUserId);
  }

  async function rememberWorld(world) {
    if (!world?.id) return;
    const currentUserId = getCurrentUser?.()?.id || null;
    if (!currentUserId) return;

    const worldId = String(world.id);
    myWorldMap.set(worldId, world);
    myWorldIds = dedupeWorldIds([worldId, ...myWorldIds]).slice(0, MY_WORLDS_LIMIT);
    persistMyWorldIds(currentUserId);
  }

  function pruneRememberedWorld(worldId) {
    const normalized = String(worldId || '').trim();
    if (!normalized) return;
    myWorldMap.delete(normalized);
    myWorldIds = myWorldIds.filter((id) => id !== normalized);
    const currentUserId = getCurrentUser?.()?.id || null;
    persistMyWorldIds(currentUserId);
  }

  function updateWorldNavStack(world) {
    const worldId = String(world?.id || '').trim();
    if (!worldId) return;

    const existingIndex = worldNavStack.findIndex((entry) => String(entry?.id || '') === worldId);
    if (existingIndex >= 0) {
      worldNavStack = worldNavStack.slice(0, existingIndex + 1);
      worldNavStack[existingIndex] = world;
      return;
    }

    worldNavStack = [...worldNavStack, world];
  }

  async function ensureEditorModeClosed() {
    if (!getIsEditMode?.()) return true;

    if (typeof onRequestCloseEditorMode === 'function') {
      try {
        const closedViaCallback = await onRequestCloseEditorMode();
        if (!getIsEditMode?.()) return true;
        if (closedViaCallback === false) return false;
      } catch {
        // Fall back to legacy button click behavior.
      }
    }

    const editModeBtn = document.getElementById('editModeBtn');
    if (!editModeBtn) return false;

    const waitForEditorClose = async (maxFrames = 40) => {
      for (let i = 0; i < maxFrames; i += 1) {
        if (!getIsEditMode?.()) return true;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return !getIsEditMode?.();
    };

    editModeBtn.click();
    if (await waitForEditorClose()) return true;

    // Retry once in case another handler reopened edit mode in the same tick.
    editModeBtn.click();
    return waitForEditorClose(20);
  }

  function renderBreadcrumbBar(entries = []) {
    if (!dom.modeTabs) return;

    dom.modeTabs.innerHTML = '';

    entries.forEach((entry, index) => {
      if (index > 0) {
        const separator = document.createElement('span');
        separator.className = 'world-mode-breadcrumb-separator';
        separator.setAttribute('aria-hidden', 'true');
        separator.textContent = '>';
        dom.modeTabs.appendChild(separator);
      }

      const isCurrent = Boolean(entry?.current);
      const label = String(entry?.label || DEFAULT_WORLD_TITLE);
      const navTarget = String(entry?.navTarget || 'root');
      const isStatic = navTarget === 'static';
      const isMakerHome = navTarget === 'maker-home';
      const fontFamily = String(entry?.fontFamily || '').trim();

      if (isCurrent || (isStatic && !isMakerHome)) {
        const current = document.createElement('span');
        current.className = isCurrent
          ? 'world-mode-breadcrumb world-mode-breadcrumb-current'
          : 'world-mode-breadcrumb';
        if (isCurrent) {
          current.setAttribute('aria-current', 'page');
        }
        if (fontFamily) current.style.fontFamily = fontFamily;
        current.textContent = label;
        dom.modeTabs.appendChild(current);
        return;
      }

      const worldId = String(entry?.worldId || '').trim();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'world-mode-breadcrumb';
      button.dataset.worldNav = navTarget;
      button.dataset.worldId = worldId;
      if (fontFamily) button.style.fontFamily = fontFamily;
      button.textContent = label;
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const inEditMode = Boolean(getIsEditMode?.());

        if (navTarget === 'root') {
          const currentWorldId = String(activeWorld?.id || '').trim();
          if (isMusicPanelOpen?.()) {
            onCloseMusicPanel?.();
          }
          if (inEditMode) {
            const editorClosed = await ensureEditorModeClosed();
            if (!editorClosed && getIsEditMode?.()) {
              return;
            }
          }
          if (!currentWorldId) {
            await renderMainNavigationChrome();
            return;
          }
          const loaderShown = await showTransitionLoader({
            mode: 'loading',
            kicker: 'main',
            title: MAIN_WORLD_LABEL,
            meta: MAIN_WORLD_USERNAME,
            status: 'loading main...',
            backgroundUrl: getDefaultBackgroundUrl(baseUrl),
            coverUrl: getDefaultBackgroundUrl(baseUrl),
            showCover: false,
            progress: 8
          });
          if (!loaderShown) return;
          await exitWorldMode();
          return;
        }

        if (navTarget === 'maker-home') {
          showStep('mode');
          return;
        }

        if (navTarget === 'maker-return') {
          closeMaker();
          return;
        }

        if (navTarget === 'crumb' && worldId) {
          const currentWorldId = String(activeWorld?.id || '').trim();
          if (isMusicPanelOpen?.()) {
            onCloseMusicPanel?.();
            if (currentWorldId && currentWorldId === worldId) {
              return;
            }
          }
          if (inEditMode) {
            const editorClosed = await ensureEditorModeClosed();
            if (!editorClosed) {
              return;
            }
            if (currentWorldId && currentWorldId === worldId) {
              return;
            }
            await openWorldById(worldId);
            return;
          }
          if (isMakerOpen()) {
            const sourceWorldId = String(makerSourceWorldId || '').trim();
            const currentWorldId = String(activeWorld?.id || '').trim();
            if ((sourceWorldId && sourceWorldId === worldId) || (currentWorldId && currentWorldId === worldId)) {
              closeMaker();
              return;
            }
          }
          await openWorldById(worldId);
        }
      });
      dom.modeTabs.appendChild(button);
    });
  }

  function getMakerBreadcrumbEntries() {
    if (!isMakerOpen()) return [];

    const currentStep = String(dom.makerShell?.dataset?.step || 'mode');
    const entries = [
      {
        label: 'world maker',
        navTarget: 'maker-home',
        worldId: '',
        current: currentStep === 'mode'
      }
    ];

    if (currentStep === 'plug') {
      entries[0].current = false;
      entries.push({
        label: 'plug your world',
        navTarget: 'static',
        worldId: '',
        current: true
      });
    }

    if (currentStep === 'code') {
      entries[0].current = false;
      entries.push({
        label: 'code your world',
        navTarget: 'static',
        worldId: '',
        current: true
      });
    }

    return entries;
  }

  async function renderWorldNavigation(world) {
    clearWorldTabs();

    if (!world || !dom.modeTabs) return;

    const inEditMode = Boolean(getIsEditMode?.());

    parentTabAction = async () => {
      await exitWorldMode();
    };

    const breadcrumbEntries = [
      {
        label: MAIN_WORLD_LABEL,
        navTarget: 'root',
        worldId: '',
        current: false
      },
      ...worldNavStack.map((stackWorld, index) => ({
        label: stackWorld?.name || DEFAULT_WORLD_TITLE,
        navTarget: 'crumb',
        worldId: String(stackWorld?.id || ''),
        fontFamily: '',
        current: index === worldNavStack.length - 1
      }))
    ];

    const makerEntries = getMakerBreadcrumbEntries();
    if (breadcrumbEntries.length > 0) {
      breadcrumbEntries[breadcrumbEntries.length - 1].current = makerEntries.length === 0 && !inEditMode;
      if (makerEntries.length > 0 && breadcrumbEntries.length > 1) {
        const lastWorldCrumb = breadcrumbEntries[breadcrumbEntries.length - 1];
        if (String(lastWorldCrumb?.worldId || '').trim()) {
          lastWorldCrumb.navTarget = 'maker-return';
        }
      }
    }

    if (inEditMode) {
      breadcrumbEntries.push({
        label: 'editor',
        navTarget: 'static',
        worldId: '',
        current: true
      });
    }

    renderBreadcrumbBar([...breadcrumbEntries, ...makerEntries]);
  }

  function canUseCustomWorldFrame(world) {
    const customUrl = String(world?.custom_code_url || '').trim();
    if (!customUrl) return false;

    try {
      const parsed = new URL(customUrl, window.location.href);
      const path = decodeURIComponent(parsed.pathname || '').replace(/\\/g, '/');
      const isWorldHtml = /(?:^|\/)world\.html$/i.test(path);
      const isNativeStorageUrl = path.includes('/storage/v1/object/public/worlds/');
      const isApiStorageUrl = path.includes('/api/storage/public/worlds/');
      return isWorldHtml && (isNativeStorageUrl || isApiStorageUrl);
    } catch {
      return false;
    }
  }

  function getCustomWorldFrameSrc(world) {
    const customUrl = String(world?.custom_code_url || '').trim();
    if (!customUrl) return '';

    try {
      const parsed = new URL(customUrl, window.location.href);
      const worldId = String(world?.id || '').trim();
      if (worldId && !customWorldFrameVersionById.has(worldId)) {
        customWorldFrameVersionById.set(worldId, String(Date.now()));
      }
      const version = String(
        (worldId && customWorldFrameVersionById.get(worldId))
        || world?.updated_at
        || world?.created_at
        || world?.id
        || ''
      ).trim();
      if (version) parsed.searchParams.set('v', version);
      return parsed.href;
    } catch {
      return customUrl;
    }
  }

  function getCustomWorldCssUrl(customCodeUrl = '') {
    const rawUrl = String(customCodeUrl || '').trim();
    if (!rawUrl) return '';

    try {
      const parsed = new URL(rawUrl, window.location.href);
      parsed.pathname = parsed.pathname.replace(/(?:^|\/)world\.html$/i, (match) => match.replace(/world\.html$/i, 'world.css'));
      parsed.search = '';
      parsed.hash = '';
      return parsed.href;
    } catch {
      return rawUrl.replace(/world\.html(?:[?#].*)?$/i, 'world.css');
    }
  }

  function getCustomWorldBaseHref(customCodeUrl = '') {
    const rawUrl = String(customCodeUrl || '').trim();
    if (!rawUrl) return '';

    try {
      const parsed = new URL(rawUrl, window.location.href);
      parsed.pathname = parsed.pathname.replace(/(?:^|\/)world\.html$/i, '');
      if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
      parsed.search = '';
      parsed.hash = '';
      return parsed.href;
    } catch {
      return rawUrl.replace(/world\.html(?:[?#].*)?$/i, '');
    }
  }

  async function fetchCustomWorldText(url = '') {
    const rawUrl = String(url || '').trim();
    if (!rawUrl) return '';

    const parsed = new URL(rawUrl, window.location.href);
    parsed.searchParams.set('t', String(Date.now()));
    const response = await fetch(parsed.href, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Could not load existing custom world file (${response.status}).`);
    }
    return response.text();
  }

  function stripCustomWorldCssLinks(html = '') {
    return String(html || '').replace(
      /<link\b(?=[^>]*\brel=["']?stylesheet["']?)(?=[^>]*\bhref=["'][^"']*(?:^|\/)world\.css(?:[?#][^"']*)?["'])[^>]*>/gi,
      ''
    );
  }

  function injectCustomWorldBaseHref(html = '', baseHref = '') {
    const href = String(baseHref || '').trim();
    if (!href || /<base\b/i.test(html)) return html;

    const baseTag = `<base href="${escapeHtml(href)}">`;
    return /<head\b[^>]*>/i.test(html)
      ? html.replace(/<head\b[^>]*>/i, (match) => `${match}\n${baseTag}`)
      : `${baseTag}\n${html}`;
  }

  function buildCustomWorldHtmlText(html = '', css = '', options = {}) {
    const cleanedHtml = stripCustomWorldCssLinks(html || '<!doctype html><html><head></head><body></body></html>')
      .replace(/<!-- demo0-inline-world-css:start -->[\s\S]*?<!-- demo0-inline-world-css:end -->/gi, '');
    const cleanedCss = String(css || '').replace(/<\/style/gi, '<\\/style');
    const styleBlock = `<!-- demo0-inline-world-css:start -->\n<style data-demo0-world-css>\n${cleanedCss}\n</style>\n<!-- demo0-inline-world-css:end -->`;
    const htmlWithBase = injectCustomWorldBaseHref(cleanedHtml, options.baseHref || '');

    return /<\/head\s*>/i.test(htmlWithBase)
      ? htmlWithBase.replace(/<\/head\s*>/i, `${styleBlock}\n</head>`)
      : `${styleBlock}\n${htmlWithBase}`;
  }

  function buildCustomWorldHtmlFile(html = '', css = '') {
    const outputHtml = buildCustomWorldHtmlText(html, css);
    return new File([outputHtml], 'world.html', { type: 'text/html' });
  }

  function getCustomWorldAssetReferences(text = '') {
    const references = new Set();
    const source = String(text || '');
    const assetPattern = /(?:src|href)=["']\.\/assets\/([^"'#?]+)|url\(\s*["']?\.\/assets\/([^"')?#]+)["']?\s*\)/gi;
    let match = assetPattern.exec(source);
    while (match) {
      const fileName = normalizeStorageName(match[1] || match[2] || '');
      if (fileName && fileName !== 'asset') references.add(fileName.toLowerCase());
      match = assetPattern.exec(source);
    }
    return references;
  }

  function validateCustomWorldAssetReferences(html = '', css = '', files = [], options = {}) {
    const references = new Set([
      ...getCustomWorldAssetReferences(html),
      ...getCustomWorldAssetReferences(css)
    ]);
    if (!references.size) return;

    const uploadedNames = new Set(
      Array.from(files || [])
        .map((file) => getWorldUiAssetStorageName(file).toLowerCase())
        .filter(Boolean)
    );

    const missing = Array.from(references).filter((name) => !uploadedNames.has(name));
    if (missing.length > 0 && options.requireAll) {
      throw new Error(`Your code references missing UI assets: ${missing.join(', ')}. Choose those files in the UI assets picker too.`);
    }
  }

  function hideCustomWorldFrame() {
    customWorldFrameSrc = '';
    customWorldFrameLoadSeq += 1;
    document.body.classList.remove('custom-world-frame-active', 'custom-world-frame-loading');
    dom.modeFrame.style.display = 'none';
    dom.modeFrame.style.visibility = '';
    dom.modeFrame.removeAttribute('data-loading');
    dom.modeFrame.removeAttribute('srcdoc');
    dom.modeFrame.src = 'about:blank';
    resolveCustomWorldFrameReady?.(false);
    resolveCustomWorldFrameReady = null;
    customWorldFrameReadyPromise = Promise.resolve(false);
  }

  function revealCustomWorldFrame(loadSeq = customWorldFrameLoadSeq, expectedSrc = customWorldFrameSrc) {
    if (loadSeq !== customWorldFrameLoadSeq || expectedSrc !== customWorldFrameSrc) return;
    if (!dom.modeFrame || dom.modeFrame.style.display === 'none') return;
    dom.modeFrame.removeAttribute('data-loading');
    dom.modeFrame.style.visibility = '';
    document.body.classList.remove('custom-world-frame-loading');
    document.body.classList.add('custom-world-frame-active');
    resolveCustomWorldFrameReady?.(true);
    resolveCustomWorldFrameReady = null;
  }

  function beginCustomWorldFrameLoad() {
    resolveCustomWorldFrameReady?.(false);
    customWorldFrameReadyPromise = new Promise((resolve) => {
      resolveCustomWorldFrameReady = resolve;
    });
  }

  async function waitForCustomWorldFrameReady(timeoutMs = 2500) {
    const timeoutPromise = new Promise((resolve) => {
      window.setTimeout(() => resolve(false), Math.max(0, Number(timeoutMs) || 0));
    });
    return Promise.race([customWorldFrameReadyPromise, timeoutPromise]);
  }

  async function loadCustomWorldFrameDocument(world, nextSrc, loadSeq) {
    try {
      const htmlText = await fetchCustomWorldText(nextSrc);
      let cssText = '';
      try {
        cssText = await fetchCustomWorldText(getCustomWorldCssUrl(nextSrc));
      } catch {
        cssText = '';
      }

      if (loadSeq !== customWorldFrameLoadSeq || customWorldFrameSrc !== nextSrc) return;

      dom.modeFrame.removeAttribute('src');
      dom.modeFrame.srcdoc = buildCustomWorldHtmlText(htmlText, cssText, {
        baseHref: getCustomWorldBaseHref(nextSrc)
      });
      requestAnimationFrame(() => revealCustomWorldFrame(loadSeq, nextSrc));
    } catch (error) {
      console.warn('Custom world inline load failed, falling back to storage URL:', error?.message || error);
      if (loadSeq !== customWorldFrameLoadSeq || customWorldFrameSrc !== nextSrc) return;
      dom.modeFrame.removeAttribute('srcdoc');
      dom.modeFrame.src = nextSrc;
    }
  }

  function showCustomWorldFrame(world) {
    const nextSrc = getCustomWorldFrameSrc(world);
    if (!nextSrc) {
      hideCustomWorldFrame();
      return;
    }

    dom.modeFrame.style.display = 'block';
    document.body.classList.add('custom-world-frame-active');
    if (customWorldFrameSrc !== nextSrc) {
      customWorldFrameSrc = nextSrc;
      customWorldFrameLoadSeq += 1;
      beginCustomWorldFrameLoad();
      dom.modeFrame.dataset.loading = 'true';
      dom.modeFrame.style.visibility = 'hidden';
      document.body.classList.add('custom-world-frame-loading');
      dom.modeFrame.removeAttribute('srcdoc');
      dom.modeFrame.src = 'about:blank';
      void loadCustomWorldFrameDocument(world, nextSrc, customWorldFrameLoadSeq);
    } else if (dom.modeFrame.dataset.loading !== 'true') {
      dom.modeFrame.style.visibility = '';
    }
  }

  function fillCategorySelect(selectEl) {
    if (!selectEl) return;
    const categories = (getCategories?.() || []).map((item) => String(item?.name || '').trim()).filter(Boolean);
    selectEl.innerHTML = categories.length
      ? categories.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')
      : '<option value="">no categories</option>';
  }

  function syncCategories() {
    renderPlugCategoryDropdown();
    renderPlugCategoryEditor();
    renderCodeCategoryDropdown();
    renderCodeCategoryEditor();
  }

  function syncPlugAccessPasswordVisibility() {
    const viewIsPrivate = dom.plugVisibility?.value === 'false';
    const editIsPrivate = dom.plugEditing?.value === 'false';

    if (dom.plugViewModeRow) dom.plugViewModeRow.dataset.private = viewIsPrivate ? 'true' : 'false';
    if (dom.plugEditModeRow) dom.plugEditModeRow.dataset.private = editIsPrivate ? 'true' : 'false';

    if (dom.plugViewPassword) {
      dom.plugViewPassword.style.display = viewIsPrivate ? 'block' : 'none';
      if (!viewIsPrivate) writePasswordInput(dom.plugViewPassword, '');
    }

    if (dom.plugViewPasswordConfirm) {
      dom.plugViewPasswordConfirm.style.display = viewIsPrivate ? 'block' : 'none';
      if (!viewIsPrivate) writePasswordInput(dom.plugViewPasswordConfirm, '');
    }

    if (dom.plugEditPassword) {
      dom.plugEditPassword.style.display = editIsPrivate ? 'block' : 'none';
      if (!editIsPrivate) writePasswordInput(dom.plugEditPassword, '');
    }

    if (dom.plugEditPasswordConfirm) {
      dom.plugEditPasswordConfirm.style.display = editIsPrivate ? 'block' : 'none';
      if (!editIsPrivate) writePasswordInput(dom.plugEditPasswordConfirm, '');
    }
  }

  function syncCodeAccessPasswordVisibility() {
    const viewIsPrivate = dom.codeVisibility?.value === 'false';
    const editIsPrivate = dom.codeEditing?.value === 'false';

    if (dom.codeViewModeRow) dom.codeViewModeRow.dataset.private = viewIsPrivate ? 'true' : 'false';
    if (dom.codeEditModeRow) dom.codeEditModeRow.dataset.private = editIsPrivate ? 'true' : 'false';

    if (dom.codeViewPassword) {
      dom.codeViewPassword.style.display = viewIsPrivate ? 'block' : 'none';
      if (!viewIsPrivate) writePasswordInput(dom.codeViewPassword, '');
    }

    if (dom.codeViewPasswordConfirm) {
      dom.codeViewPasswordConfirm.style.display = viewIsPrivate ? 'block' : 'none';
      if (!viewIsPrivate) writePasswordInput(dom.codeViewPasswordConfirm, '');
    }

    if (dom.codeEditPassword) {
      dom.codeEditPassword.style.display = editIsPrivate ? 'block' : 'none';
      if (!editIsPrivate) writePasswordInput(dom.codeEditPassword, '');
    }

    if (dom.codeEditPasswordConfirm) {
      dom.codeEditPasswordConfirm.style.display = editIsPrivate ? 'block' : 'none';
      if (!editIsPrivate) writePasswordInput(dom.codeEditPasswordConfirm, '');
    }
  }

  function validatePasswordConfirmation(password, confirmation, label) {
    if (!password && !confirmation) return true;
    if (!password || !confirmation) {
      alert(`Confirm the ${label} password.`);
      return false;
    }
    if (password !== confirmation) {
      alert(`${label} passwords do not match.`);
      return false;
    }
    return true;
  }

  function resolvePlugWorldPassword() {
    const viewIsPrivate = dom.plugVisibility?.value === 'false';
    const editIsPrivate = dom.plugEditing?.value === 'false';
    const isEdit = makerMode === 'edit' && Boolean(makerEditingWorld?.id);

    if (!viewIsPrivate && !editIsPrivate) {
      return { viewPassword: '', editPassword: '', viewIsPublic: true, editIsPublic: true };
    }

    const viewPassword = readPasswordInput(dom.plugViewPassword);
    const editPassword = readPasswordInput(dom.plugEditPassword);
    const viewPasswordConfirm = readPasswordInput(dom.plugViewPasswordConfirm);
    const editPasswordConfirm = readPasswordInput(dom.plugEditPasswordConfirm);

    if (viewIsPrivate && !validatePasswordConfirmation(viewPassword, viewPasswordConfirm, 'view')) return null;
    if (editIsPrivate && !validatePasswordConfirmation(editPassword, editPasswordConfirm, 'edit')) return null;

    const requiredPasswords = [];
    if (viewIsPrivate) requiredPasswords.push(viewPassword);
    if (editIsPrivate) requiredPasswords.push(editPassword);

    if (!isEdit && requiredPasswords.some((value) => !value)) {
      alert('Enter a password for private mode.');
      return null;
    }

    if (isEdit) {
      if (viewIsPrivate && !viewPassword && !hasWorldPassword(makerEditingWorld, 'view')) {
        alert('Enter a viewing password for private view mode.');
        return null;
      }
      if (editIsPrivate && !editPassword && !hasWorldPassword(makerEditingWorld, 'edit')) {
        alert('Enter an editing password for private edit mode.');
        return null;
      }
    }

    return { viewPassword, editPassword, viewIsPublic: !viewIsPrivate, editIsPublic: !editIsPrivate };
  }

  function resolveCodeWorldPassword() {
    const viewIsPrivate = dom.codeVisibility?.value === 'false';
    const editIsPrivate = dom.codeEditing?.value === 'false';
    const isEdit = makerMode === 'edit' && Boolean(makerEditingWorld?.id);

    if (!viewIsPrivate && !editIsPrivate) {
      return { viewPassword: '', editPassword: '', viewIsPublic: true, editIsPublic: true };
    }

    const viewPassword = readPasswordInput(dom.codeViewPassword);
    const editPassword = readPasswordInput(dom.codeEditPassword);
    const viewPasswordConfirm = readPasswordInput(dom.codeViewPasswordConfirm);
    const editPasswordConfirm = readPasswordInput(dom.codeEditPasswordConfirm);

    if (viewIsPrivate && !validatePasswordConfirmation(viewPassword, viewPasswordConfirm, 'view')) return null;
    if (editIsPrivate && !validatePasswordConfirmation(editPassword, editPasswordConfirm, 'edit')) return null;

    const requiredPasswords = [];
    if (viewIsPrivate) requiredPasswords.push(viewPassword);
    if (editIsPrivate) requiredPasswords.push(editPassword);

    if (!isEdit && requiredPasswords.some((value) => !value)) {
      alert('Enter a password for private mode.');
      return null;
    }

    if (isEdit) {
      if (viewIsPrivate && !viewPassword && !hasWorldPassword(makerEditingWorld, 'view')) {
        alert('Enter a viewing password for private view mode.');
        return null;
      }
      if (editIsPrivate && !editPassword && !hasWorldPassword(makerEditingWorld, 'edit')) {
        alert('Enter an editing password for private edit mode.');
        return null;
      }
    }

    return { viewPassword, editPassword, viewIsPublic: !viewIsPrivate, editIsPublic: !editIsPrivate };
  }

  function showStep(step) {
    dom.makerShell.dataset.step = step;
    dom.makerShell.querySelectorAll('[data-step-panel]').forEach((panel) => {
      panel.classList.toggle('is-active', panel.getAttribute('data-step-panel') === step);
    });
    if (isMakerOpen()) {
      void syncNavigationChrome();
    }
  }

  function resetMaker() {
    makerMode = 'create';
    makerEditingWorld = null;
    makerEditingType = 'plug';
    dom.plugName.value = '';
    applyMakerStyleDefaults('plug', getMakerColorSource(false));

    dom.plugCover.value = '';
    dom.plugCoverLabel.textContent = 'use world background as cover';
    dom.plugBackground.value = '';
    dom.plugBackgroundLabel.textContent = 'use site background';
    dom.plugVisibility.value = 'true';
    dom.plugEditing.value = 'true';
    writePasswordInput(dom.plugViewPassword, '');
    writePasswordInput(dom.plugViewPasswordConfirm, '');
    writePasswordInput(dom.plugEditPassword, '');
    writePasswordInput(dom.plugEditPasswordConfirm, '');
    dom.codeHtml.value = '';
    dom.codeCss.value = '';
    dom.codeAssets.value = '';
    dom.codeCover.value = '';
    dom.codeHtmlLabel.textContent = 'choose html';
    dom.codeCssLabel.textContent = 'choose css';
    dom.codeAssetsLabel.textContent = 'choose ui assets';
    dom.codeCoverLabel.textContent = 'choose world card cover';
    dom.codeName.value = '';
    applyMakerStyleDefaults('code', getMakerColorSource(false));
    dom.codeVisibility.value = 'true';
    dom.codeEditing.value = 'true';
    writePasswordInput(dom.codeViewPassword, '');
    writePasswordInput(dom.codeViewPasswordConfirm, '');
    writePasswordInput(dom.codeEditPassword, '');
    writePasswordInput(dom.codeEditPasswordConfirm, '');
    dom.plugPublish.textContent = 'submit';
    dom.codePublish.textContent = 'submit';
    dom.makerDeleteButtons.forEach((button) => { button.style.display = 'none'; });
    setPlugCategory('');
    closePlugCategoryDropdown();
    closePlugCategoryPanel();
    setCodeCategory('');
    closeCodeCategoryDropdown();
    closeCodeCategoryPanel();
    syncCategories();
    syncWorldDropdowns();
    syncPlugAccessPasswordVisibility();
    syncCodeAccessPasswordVisibility();
    makerBaselineState = captureMakerState();
    showStep('mode');
  }

  async function openMaker() {
    if (!(await canCreateWorldInActiveContext())) return false;

    if (typeof onBeforeOpenMaker === 'function') {
      const canOpen = await onBeforeOpenMaker({ source: 'world-maker-open' });
      if (!canOpen) return false;
    }

    makerMode = 'create';
    makerEditingWorld = null;
    makerEditingType = 'plug';
    syncCategories();
    makerSourceWorldId = String(activeWorld?.id || '').trim();
    applyMakerOverlayTheme(getMakerColorSource(false));
    dom.makerOverlay.style.display = 'flex';
    document.body.classList.add('world-maker-open');
    dom.plugPublish.textContent = 'submit';
    dom.codePublish.textContent = 'submit';
    syncWorldDropdowns();
    showStep('mode');
    makerBaselineState = captureMakerState();
    return true;
  }

  async function canCreateWorldInActiveContext() {
    if (!activeWorld?.id) return true;

    return ensureWorldEditAccess(activeWorld, {
      promptPassword: null,
      deniedMessage: 'You need edit access to create a world here.'
    });
  }

  async function ensureWorldEditAccess(world, options = {}) {
    if (!world?.id) return true;

    const {
      promptPassword = null,
      deniedMessage = 'You need edit access here.'
    } = options;

    const currentUserId = String(getCurrentUser?.()?.id || '').trim();
    const ownerId = String(world.user_id || '').trim();
    if (currentUserId && ownerId && currentUserId === ownerId) return true;
    if (world.is_public_edit !== false) return true;

    const editPasswordUpdatedAt = getWorldPasswordUpdatedAt(world, 'edit');
    if (!hasWorldPassword(world, 'edit')) {
      alert(deniedMessage);
      return false;
    }

    if (currentUserId && await verifyWorldAccess(world.id, currentUserId, 'edit', editPasswordUpdatedAt)) return true;
    if (!currentUserId && hasGuestWorldAccess(world.id, 'edit', editPasswordUpdatedAt)) return true;

    let nextMessage = '';
    while (true) {
      const password = typeof promptPassword === 'function'
        ? await promptPassword({ world, message: nextMessage })
        : await showPasswordPrompt(world, activeWorldCreator, {
            message: nextMessage,
            submitLabel: 'unlock',
            cancelLabel: 'cancel'
          });

      if (!password) return false;

      try {
        const unlocked = currentUserId
          ? await unlockWorldAccess(world.id, password, 'edit')
          : await verifyWorldPassword(world.id, password, 'edit');

        if (unlocked) {
          if (!currentUserId) {
            rememberGuestWorldAccess(world.id, 'edit', editPasswordUpdatedAt, true);
          }
          return true;
        }

        nextMessage = 'Incorrect password.';
      } catch (error) {
        console.error('Failed to verify world edit password:', error);
        nextMessage = error?.message || 'Could not verify password.';
      }
    }
  }

  async function requireWorldOwnerPasswordForEdit(world, creator = null) {
    if (!world?.id || !hasAnyWorldPassword(world)) return true;

    const mode = hasWorldPassword(world, 'edit') ? 'edit' : 'view';
    let nextMessage = '';
    while (true) {
      const password = await showPasswordPrompt(world, creator || activeWorldCreator, {
        message: nextMessage,
        submitLabel: 'unlock',
        cancelLabel: 'cancel'
      });
      if (!password) return false;

      try {
        if (await verifyWorldPassword(world.id, password, mode)) return true;
        nextMessage = 'Incorrect password.';
      } catch (error) {
        console.error('Failed to verify owner world password:', error);
        nextMessage = error?.message || 'Could not verify password.';
      }
    }
  }

  async function openMakerForEdit(world) {
    if (!world?.id) return false;

    if (typeof onBeforeOpenMaker === 'function') {
      const canOpen = await onBeforeOpenMaker({ source: 'world-maker-edit' });
      if (!canOpen) return false;
    }

    if (!(await requireWorldOwnerPasswordForEdit(world))) return false;

    makerMode = 'edit';
    makerEditingWorld = world;
    makerEditingType = canUseCustomWorldFrame(world) ? 'code' : 'plug';

    syncCategories();

    dom.plugName.value = world.name || '';
    applyMakerStyleDefaults('plug', world);
    setPlugCategory(world.category || '');

    dom.plugCover.value = '';
    dom.plugCoverLabel.textContent = world.cover_url
      ? 'keep current world cover (choose file to replace)'
      : (world.background_url ? 'use world background as cover (choose file to replace)' : 'use site background as cover');
    dom.plugBackground.value = '';
    dom.plugBackgroundLabel.textContent = world.background_url ? 'keep current background (choose file to replace)' : 'use site background';
    dom.plugVisibility.value = world.is_public_view === false ? 'false' : 'true';
    dom.plugEditing.value = world.is_public_edit === false ? 'false' : 'true';
    writePasswordInput(dom.plugViewPassword, '');
    writePasswordInput(dom.plugViewPasswordConfirm, '');
    writePasswordInput(dom.plugEditPassword, '');
    writePasswordInput(dom.plugEditPasswordConfirm, '');

    dom.codeName.value = world.name || '';
    setCodeCategory(world.category || '');
    applyMakerStyleDefaults('code', world);
    dom.codeVisibility.value = world.is_public_view === false ? 'false' : 'true';
    dom.codeEditing.value = world.is_public_edit === false ? 'false' : 'true';
    writePasswordInput(dom.codeViewPassword, '');
    writePasswordInput(dom.codeViewPasswordConfirm, '');
    writePasswordInput(dom.codeEditPassword, '');
    writePasswordInput(dom.codeEditPasswordConfirm, '');
    dom.codeHtml.value = '';
    dom.codeCss.value = '';
    dom.codeAssets.value = '';
    dom.codeCover.value = '';
    dom.codeHtmlLabel.textContent = 'keep current html (choose file to replace)';
    dom.codeCssLabel.textContent = 'keep current css (choose file to replace)';
    dom.codeAssetsLabel.textContent = 'keep current ui assets (choose files to add/replace)';
    dom.codeCoverLabel.textContent = world.cover_url
      ? 'keep current world card cover (choose file to replace)'
      : 'choose world card cover';

    dom.plugPublish.textContent = 'submit';
    dom.codePublish.textContent = 'submit';
    dom.makerDeleteButtons.forEach((button) => { button.style.display = 'inline-flex'; });
    syncWorldDropdowns();
    syncPlugAccessPasswordVisibility();
    syncCodeAccessPasswordVisibility();

    makerSourceWorldId = String(activeWorld?.id || '').trim();
    applyMakerOverlayTheme(world);
    dom.makerOverlay.style.display = 'flex';
    document.body.classList.add('world-maker-open');
    showStep(makerEditingType);
    makerBaselineState = captureMakerState();
    return true;
  }

  function closeMaker() {
    const wasOpen = isMakerOpen();
    dom.makerOverlay.style.display = 'none';
    document.body.classList.remove('world-maker-open');
    makerSourceWorldId = '';
    makerBaselineState = null;
    clearMakerOverlayTheme();
    resetMaker();
    if (wasOpen) {
      void syncNavigationChrome();
    }
  }

  function isMakerOpen() {
    return dom.makerOverlay.style.display === 'flex';
  }

  function isInWorldMode() {
    return Boolean(activeWorld?.id);
  }

  function renderWorldModeChrome(world, creator) {
    const inEditMode = Boolean(getIsEditMode?.());
    const currentUserId = String(getCurrentUser?.()?.id || '').trim();
    const canEditWorld = Boolean(currentUserId) && currentUserId === String(world?.user_id || '').trim();
    const useCustomFrame = canUseCustomWorldFrame(world);

    if (dom.titleCard) {
      dom.titleCard.textContent = world.name || DEFAULT_WORLD_TITLE;
      dom.titleCard.style.display = '';
    }
    if (dom.modeNavBar) dom.modeNavBar.style.display = 'flex';
    const showLogout = inEditMode;
    const showCustomEditWorld = useCustomFrame && customWorldEditRevealWorldId === String(world?.id || '').trim();
    const showEditWorld = canEditWorld && (inEditMode || showCustomEditWorld);
    if (dom.modeNavActions) dom.modeNavActions.style.display = (showLogout || showEditWorld) ? 'inline-flex' : 'none';
    dom.modeTabs.style.display = 'inline-flex';
    if (dom.logoutBtn) dom.logoutBtn.style.display = showLogout ? 'inline-flex' : 'none';
    if (dom.modeEditBtn) dom.modeEditBtn.style.display = showEditWorld ? 'inline-flex' : 'none';
    dom.modeDelete.style.display = 'none';
    if (useCustomFrame) {
      showCustomWorldFrame(world);
    } else {
      hideCustomWorldFrame();
    }
  }

  async function renderMainNavigationChrome() {
    const inEditMode = Boolean(getIsEditMode?.());
    clearWorldTabs();

    dom.modeChrome.style.display = 'block';
    dom.modeChrome.style.removeProperty('--world-mode-font-family');
    dom.modeChrome.style.removeProperty('--world-mode-font-color');
    if (dom.modeNavBar) dom.modeNavBar.style.display = 'flex';
    if (dom.modeNavActions) dom.modeNavActions.style.display = inEditMode ? 'inline-flex' : 'none';
    if (dom.logoutBtn) dom.logoutBtn.style.display = inEditMode ? 'inline-flex' : 'none';
    if (dom.modeEditBtn) dom.modeEditBtn.style.display = 'none';
    dom.modeTabs.style.display = 'inline-flex';
    dom.modeDelete.style.display = 'none';
    hideCustomWorldFrame();
    if (dom.modeMyWorldsMenu) dom.modeMyWorldsMenu.style.display = 'none';

    if (dom.titleCard) dom.titleCard.style.display = 'none';

    const breadcrumbEntries = [
      {
        label: MAIN_WORLD_LABEL,
        navTarget: 'root',
        worldId: '',
        current: false
      },
    ];

    const makerEntries = getMakerBreadcrumbEntries();
    if (breadcrumbEntries.length > 0) {
      breadcrumbEntries[breadcrumbEntries.length - 1].current = makerEntries.length === 0 && !inEditMode;
    }

    if (inEditMode) {
      breadcrumbEntries.push({
        label: 'editor',
        navTarget: 'static',
        worldId: '',
        current: true
      });
    }

    renderBreadcrumbBar([...breadcrumbEntries, ...makerEntries]);
    parentTabAction = async () => {};
  }

  async function syncNavigationChrome() {
    if (activeWorld?.id) {
      await renderWorldNavigation(activeWorld);
      if (isInWorldMode()) {
        renderWorldModeChrome(activeWorld, activeWorldCreator);
      }
      return;
    }
    await renderMainNavigationChrome();
  }

  function clearWorldTabs() {
    if (!dom.modeTabs) return;
    dom.modeTabs.innerHTML = '';
  }

  function renderLoadingNavigationChrome(label = 'loading...') {
    if (dom.modeChrome) dom.modeChrome.style.display = 'block';
    if (dom.modeNavBar) dom.modeNavBar.style.display = 'flex';
    if (dom.modeTabs) {
      dom.modeTabs.style.display = 'inline-flex';
      if (!dom.modeTabs.children.length) {
        const current = document.createElement('span');
        current.className = 'world-mode-breadcrumb world-mode-breadcrumb-current';
        current.setAttribute('aria-current', 'page');
        current.textContent = label;
        dom.modeTabs.appendChild(current);
      }
    }
    if (dom.modeNavActions) dom.modeNavActions.style.display = 'none';
    if (dom.logoutBtn) dom.logoutBtn.style.display = 'none';
    if (dom.modeEditBtn) dom.modeEditBtn.style.display = 'none';
  }

  function setWorldLoaderVisible(visible) {
    if (!dom.loaderOverlay) return;
    if (visible) {
      renderLoadingNavigationChrome();
    }
    dom.loaderOverlay.style.display = visible ? 'block' : 'none';
    dom.loaderOverlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
    document.body.classList.toggle('world-loader-active', !!visible);

    if (!visible) {
      dom.loaderOverlay.dataset.mode = 'loading';
      if (dom.loaderOverlay) dom.loaderOverlay.style.setProperty('--world-loader-progress', '0%');
      writePasswordInput(dom.passwordInput, '');
      writePasswordInput(dom.editPasswordInput, '');
      if (dom.passwordError) dom.passwordError.textContent = '';
      void syncNavigationChrome();
    }
  }

  async function prepareWorldLoaderSurface() {
    const confirmTitle = 'are you sure you meant to exit?';
    const confirmMessage = 'You have unsaved changes. Closing now will lose them.';

    if (isMakerOpen()) {
      const closed = await maybeCloseMaker({
        title: confirmTitle,
        message: confirmMessage
      });
      if (!closed) return false;
    }

    if (typeof onBeforeShowLoader === 'function') {
      const canShow = await onBeforeShowLoader();
      if (canShow === false) return false;
    }

    return true;
  }

  function setWorldLoaderProgress(progress = 0) {
    if (!dom.loaderOverlay) return;
    const normalized = Math.max(0, Math.min(100, Number(progress) || 0));
    dom.loaderOverlay.style.setProperty('--world-loader-progress', `${normalized}%`);
  }

  function populateWorldLoader(world, _creator = null, options = {}) {
    const {
      mode = 'loading',
      kicker = 'world',
      status = 'loading world...',
      progress = 0,
      title,
      meta
    } = options;

    const nextTitle = title ?? world?.name ?? DEFAULT_WORLD_TITLE;
    const nextMeta = meta ?? (_creator?.username || (nextTitle === MAIN_WORLD_LABEL ? MAIN_WORLD_USERNAME : ''));
    if (dom.loaderOverlay) dom.loaderOverlay.dataset.mode = mode;
    if (dom.loaderOverlay) {
      dom.loaderOverlay.style.removeProperty('--world-loader-font-family');
      dom.loaderOverlay.style.removeProperty('--world-loader-font-color');
      dom.loaderOverlay.style.removeProperty('--world-loader-ui-color');
      dom.loaderOverlay.style.removeProperty('--world-loader-bg-color');
      dom.loaderOverlay.style.setProperty('--world-loader-system-bg-color', getSystemSettingsBackgroundColor());
      delete dom.loaderOverlay.dataset.loaderTintKey;
      if (world?.id) {
        const bgColor = String(world.background_color || world.ui_color || world.font_color || '').trim();
        const fontColor = String(world.font_color || world.ui_color || '').trim();
        const uiColor = String(world.ui_color || fontColor || '').trim();
        const fontFamily = String(world.font_family || '').trim();
        if (bgColor) dom.loaderOverlay.style.setProperty('--world-loader-bg-color', bgColor);
        if (fontColor) dom.loaderOverlay.style.setProperty('--world-loader-font-color', fontColor);
        if (uiColor) dom.loaderOverlay.style.setProperty('--world-loader-ui-color', uiColor);
        if (fontFamily) dom.loaderOverlay.style.setProperty('--world-loader-font-family', fontFamily);
      }
    }
    if (dom.loaderKicker) dom.loaderKicker.textContent = kicker;
    const pfpSrc = getPfpSrc(_creator, baseUrl);
    const useProfileIcon = isDefaultPfpSrc(pfpSrc);
    if (dom.loaderPfp) {
      dom.loaderPfp.src = useProfileIcon ? '' : pfpSrc;
      dom.loaderPfp.style.display = useProfileIcon ? 'none' : '';
      if (dom.loaderPfp.parentElement) {
        dom.loaderPfp.parentElement.style.display = pfpSrc ? '' : 'none';
      }
    }
    if (dom.loaderProfileIcon) {
      dom.loaderProfileIcon.style.display = useProfileIcon ? '' : 'none';
    }
    if (dom.loaderTitle) dom.loaderTitle.textContent = nextTitle;
    if (dom.loaderMeta) {
      dom.loaderMeta.textContent = nextMeta;
      dom.loaderMeta.style.display = nextMeta ? '' : 'none';
    }
    if (dom.loaderStatus) dom.loaderStatus.textContent = status;
    setWorldLoaderProgress(progress);
    if (dom.loaderCoverShell) {
      dom.loaderCoverShell.style.display = 'none';
    }
    if (dom.loaderBackdrop) {
      dom.loaderBackdrop.style.backgroundImage = 'none';
    }
    if (dom.loaderCover) {
      dom.loaderCover.removeAttribute('src');
      dom.loaderCover.alt = world?.name ? `${world.name} cover` : 'World cover';
    }
  }

  async function setPasswordPromptVisible(visible) {
    if (!dom.loaderOverlay) return;
    if (visible) {
      const canShow = await prepareWorldLoaderSurface();
      if (!canShow) return false;
      if (!dom.loaderOverlay.dataset.mode || dom.loaderOverlay.dataset.mode === 'loading') {
        dom.loaderOverlay.dataset.mode = 'password';
      }
      setWorldLoaderVisible(true);
      return true;
    }

    setWorldLoaderVisible(false);
    return true;
  }

  async function showTransitionLoader(options = {}) {
    const canShow = await prepareWorldLoaderSurface();
    if (!canShow) return false;
    populateWorldLoader(null, null, options);
    setWorldLoaderVisible(true);
    return true;
  }

  function hideTransitionLoader() {
    setWorldLoaderVisible(false);
  }

  async function showPasswordPrompt(world, creator = null, options = {}) {
    const {
      message = '',
      submitLabel = 'unlock',
      cancelLabel = 'cancel',
      allowEmpty = false,
      emptyError = 'Enter a password.',
      includeEdit = false
    } = options;

    return new Promise((resolve) => {
      passwordPromptState = {
        resolve,
        worldId: world?.id || null,
        allowEmpty: Boolean(allowEmpty),
        emptyError: String(emptyError || 'Enter a password.'),
        includeEdit: Boolean(includeEdit)
      };
      populateWorldLoader(world, creator, {
        mode: 'password',
        kicker: 'world access',
        status: 'waiting for password...',
        progress: 0
      });
      writePasswordInput(dom.passwordInput, '');
      writePasswordInput(dom.editPasswordInput, '');
      if (dom.editPasswordInput) dom.editPasswordInput.style.display = includeEdit ? 'block' : 'none';
      if (dom.passwordSubmit) dom.passwordSubmit.textContent = submitLabel;
      if (dom.passwordCancel) dom.passwordCancel.textContent = cancelLabel;
      if (dom.passwordError) dom.passwordError.textContent = message || '';
      void setPasswordPromptVisible(true).then((visible) => {
        if (!visible) {
          closePasswordPrompt(null);
          return;
        }
        dom.passwordInput?.focus();
        dom.passwordInput?.select();
      });
    });
  }

  function closePasswordPrompt(result = null) {
    const state = passwordPromptState;
    passwordPromptState = null;
    setPasswordPromptVisible(false);
    state?.resolve?.(result);
  }

  async function verifyWorldAccess(worldId, userId, mode = 'view', passwordUpdatedAt = '') {
    if (!worldId || !userId) return false;
    const normalizedMode = normalizeWorldPasswordMode(mode);
    const unlockColumn = normalizedMode === 'edit' ? 'edit_unlocked_at' : 'view_unlocked_at';

    const { data, error } = await supabase
      .from('world_access')
      .select(`id, unlocked_at, ${unlockColumn}`)
      .eq('world_id', worldId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Failed to load world access:', error);
      return false;
    }

    if (!data?.id) return false;
    const unlockedAt = String(data?.[unlockColumn] || data?.unlocked_at || '').trim();
    if (!passwordUpdatedAt) return Boolean(unlockedAt);
    if (!unlockedAt) return false;
    return new Date(unlockedAt).getTime() >= new Date(passwordUpdatedAt).getTime();
  }

  async function unlockWorldAccess(worldId, password, mode = 'view') {
    const { data, error } = await supabase.rpc('grant_world_access', {
      p_world_id: worldId,
      p_password: password,
      p_mode: normalizeWorldPasswordMode(mode)
    });

    if (error) throw error;
    return Boolean(data);
  }

  async function verifyWorldPassword(worldId, password, mode = 'view') {
    const { data, error } = await supabase.rpc('verify_world_password', {
      p_world_id: worldId,
      p_password: password,
      p_mode: normalizeWorldPasswordMode(mode)
    });

    if (error) throw error;
    return Boolean(data);
  }

  async function loadWorldById(worldId) {
    if (!worldId) return null;

    const { data, error } = await supabase
      .from('worlds')
      .select('*')
      .eq('id', worldId)
      .maybeSingle();

    if (error) {
      console.error('Failed to load world:', error);
      return null;
    }

    return data || null;
  }

  async function loadWorldByPathSegment(pathSegment) {
    const targetSlug = normalizeWorldPathSegment(pathSegment);
    if (!targetSlug) return null;

    const { data, error } = await supabase
      .from('worlds')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('Failed to load world path:', error);
      return null;
    }

    return (data || []).find((world) => getWorldPathSlug(world) === targetSlug) || null;
  }

  function getKnownWorldById(worldId) {
    const normalizedId = String(worldId || '').trim();
    if (!normalizedId) return null;

    const stackMatch = worldNavStack.find((entry) => String(entry?.id || '').trim() === normalizedId);
    if (stackMatch) return stackMatch;

    return myWorldMap.get(normalizedId) || null;
  }

  async function openWorldById(worldId, options = {}) {
    const targetWorldId = String(worldId || '').trim();
    if (!targetWorldId) return;

    const editorClosed = await ensureEditorModeClosed();
    if (!editorClosed && getIsEditMode?.()) return;

    const activeWorldId = String(activeWorld?.id || '').trim();
    if (activeWorldId && activeWorldId === targetWorldId) {
      return;
    }

    const loaderWorld = options?.world || getKnownWorldById(targetWorldId);
    if (loaderWorld) {
      const loaderShown = await showTransitionLoader({
        mode: 'loading',
        kicker: 'world',
        title: loaderWorld.name || DEFAULT_WORLD_TITLE,
        backgroundUrl: loaderWorld.background_url || getDefaultBackgroundUrl(baseUrl),
        coverUrl: getWorldCardCoverUrl(loaderWorld, baseUrl),
        showCover: true,
        status: 'loading world...',
        progress: 8
      });
      if (!loaderShown) return;
    }

    const nextWorld = await loadWorldById(targetWorldId);
    if (!nextWorld) {
      setWorldLoaderVisible(false);
      pruneRememberedWorld(targetWorldId);
      alert('Could not load that world.');
      return;
    }

    setWorldLoaderProgress(20);
    const nextCreator = await resolveWorldCreator(nextWorld);
    await openWorldMode(nextWorld, nextCreator);
  }

  async function openWorldByPathSegment(pathSegment) {
    const world = await loadWorldByPathSegment(pathSegment);
    if (!world?.id) {
      console.warn('No world found for path:', pathSegment);
      return;
    }

    await openWorldById(world.id, { world });
  }

  function clearWorldModeChrome() {
    dom.modeChrome.style.display = 'block';
    dom.modeChrome.style.removeProperty('--world-mode-font-family');
    dom.modeChrome.style.removeProperty('--world-mode-font-color');
    clearWorldTabs();
    renderLoadingNavigationChrome();
    dom.modeDelete.style.display = 'none';
    hideCustomWorldFrame();
    if (dom.titleCard) dom.titleCard.style.display = 'none';
    if (dom.modeMyWorldsMenu) dom.modeMyWorldsMenu.style.display = 'none';
  }

  async function loadWorlds(filters = {}) {
    const requestKey = JSON.stringify(filters || {});
    if (loadWorldsInFlightPromise && loadWorldsInFlightKey === requestKey) {
      console.warn('[feed reload skipped: already loading]');
      return loadWorldsInFlightPromise;
    }

    const runPromise = (async () => {
    Promise.resolve()
      .then(() => ensureLatestUpdateInfo())
      .catch(() => null);

    let query = supabase
      .from('worlds')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters.rootOnly) {
      query = query.is('parent_world_id', null);
    }

    if (Object.prototype.hasOwnProperty.call(filters, 'parentWorldId')) {
      if (filters.parentWorldId) {
        query = query.eq('parent_world_id', filters.parentWorldId);
      }
    }

    if (filters.userId) {
      query = query.eq('user_id', filters.userId);
    }

    if (Object.prototype.hasOwnProperty.call(filters, 'category') && filters.category) {
      query = query.eq('category', filters.category);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Failed to load worlds:', error);
      return [];
    }

    return data || [];
    })();

    loadWorldsInFlightKey = requestKey;
    loadWorldsInFlightPromise = runPromise;

    try {
      return await runPromise;
    } finally {
      if (loadWorldsInFlightPromise === runPromise) {
        loadWorldsInFlightPromise = null;
        loadWorldsInFlightKey = '';
      }
    }
  }

  async function ensureLatestUpdateInfo(force = false) {
    if (!force && localStorage.getItem(OPTIONAL_UPDATES_DISABLED_STORAGE_KEY) === '1') return null;
    if (latestUpdateInfo && !force) return latestUpdateInfo;
    if (!force && latestUpdateInfoPromise) return latestUpdateInfoPromise;
    if (!force && Date.now() < latestUpdateInfoRetryAt) return latestUpdateInfo;

    const requestPromise = (async () => {
      const { data, error } = await supabase
        .from('updates')
        .select('id, version, description, released_at')
        .order('released_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        const message = String(error?.message || error || '').toLowerCase();
        const missingTable = message.includes('unknown table') || message.includes('does not exist');
        if (!missingTable) {
          console.warn('Failed to load update metadata:', error);
        } else {
          localStorage.setItem(OPTIONAL_UPDATES_DISABLED_STORAGE_KEY, '1');
        }
        latestUpdateInfoRetryAt = missingTable ? Number.POSITIVE_INFINITY : Date.now() + 10000;
        latestUpdateInfo = null;
        return null;
      }

      latestUpdateInfoRetryAt = 0;
      latestUpdateInfo = data || null;
      return latestUpdateInfo;
    })();

    latestUpdateInfoPromise = requestPromise;

    try {
      return await requestPromise;
    } finally {
      if (latestUpdateInfoPromise === requestPromise) {
        latestUpdateInfoPromise = null;
      }
    }
  }

  function worldNeedsManualUpdate(world, currentUserId) {
    if (!world || !currentUserId) return false;
    if (String(world.user_id || '') !== String(currentUserId)) return false;
    if (String(world.update_mode || 'auto') !== 'manual') return false;
    if (!latestUpdateInfo?.released_at) return false;

    const worldUpdatedAt = world.last_updated_at ? new Date(world.last_updated_at).getTime() : 0;
    const latestReleasedAt = new Date(latestUpdateInfo.released_at).getTime();
    if (!Number.isFinite(latestReleasedAt) || latestReleasedAt <= 0) return false;

    return worldUpdatedAt < latestReleasedAt;
  }

  async function applyWorldUpdate(world) {
    const currentUserId = getCurrentUser?.()?.id || null;
    if (!currentUserId || !world?.id) return;

    const { error } = await supabase
      .from('worlds')
      .update({ last_updated_at: new Date().toISOString() })
      .eq('id', world.id)
      .eq('user_id', currentUserId);

    if (error) {
      alert(`Update apply failed: ${error.message}`);
      return;
    }

    await onWorldCreated?.({ ...world, last_updated_at: new Date().toISOString() });
  }

  async function resolveWorldCreator(world, preferredUser = null) {
    if (preferredUser?.id && String(preferredUser.username || '').trim()) return preferredUser;

    const { data, error } = await supabase
      .from('users')
      .select('id, username, pfp, pfp_url')
      .eq('id', world.user_id)
      .single();

    if (error) {
      console.error('Failed to load world creator:', error);
      return {};
    }

    return data || {};
  }

  async function openWorldMode(world, creator = null) {
    const targetWorldId = String(world?.id || '').trim();
    const activeWorldId = String(activeWorld?.id || '').trim();
    const editorClosed = await ensureEditorModeClosed();
    if (!editorClosed && getIsEditMode?.()) return;

    if (targetWorldId && activeWorldId && targetWorldId === activeWorldId && isInWorldMode()) {
      return;
    }

    populateWorldLoader(world, creator, {
      mode: 'loading',
      kicker: 'world',
      status: 'loading world...',
      progress: 24
    });
    if (!(await prepareWorldLoaderSurface())) return;
    setWorldLoaderVisible(true);

    const currentUserId = getCurrentUser?.()?.id || null;
    try {
      const resolvedCreator = await resolveWorldCreator(world, creator);
      populateWorldLoader(world, resolvedCreator, {
        mode: 'loading',
        kicker: 'world',
        status: 'loading world...',
        progress: 28
      });

      const isOwner = currentUserId && String(currentUserId) === String(world.user_id || '');
      const needsViewPassword = hasWorldPassword(world, 'view') && !isOwner;
      const needsEditPassword = hasWorldPassword(world, 'edit') && world.is_public_edit === false && !isOwner;
      const viewPasswordUpdatedAt = getWorldPasswordUpdatedAt(world, 'view');
      const editPasswordUpdatedAt = getWorldPasswordUpdatedAt(world, 'edit');

      if (world.is_public_view === false && !needsViewPassword && !isOwner) {
        alert('This world is private.');
        return;
      }

      if (needsViewPassword && currentUserId) {
        const hasAccess = await verifyWorldAccess(world.id, currentUserId, 'view', viewPasswordUpdatedAt);
        if (!hasAccess) {
          let nextMessage = '';

          while (true) {
            const password = await showPasswordPrompt(world, resolvedCreator, {
              message: nextMessage,
              submitLabel: 'unlock',
              cancelLabel: 'cancel',
              includeEdit: needsEditPassword
            });
            if (!password) return;
            const viewPassword = typeof password === 'object' ? password.viewPassword : password;
            const editPassword = typeof password === 'object' ? password.editPassword : '';

            try {
              const unlocked = await unlockWorldAccess(world.id, viewPassword, 'view');
              if (unlocked) {
                if (editPassword) {
                  await unlockWorldAccess(world.id, editPassword, 'edit').catch(() => false);
                }
                break;
              }
              nextMessage = 'Incorrect password.';
            } catch (error) {
              console.error('Failed to unlock world:', error);
              nextMessage = error?.message || 'Could not unlock world.';
            }
          }
        }
      }

      if (needsViewPassword && !currentUserId) {
        const hasGuestAccess = hasGuestWorldAccess(world.id, 'view', viewPasswordUpdatedAt);
        if (!hasGuestAccess) {
          let nextMessage = '';

          while (true) {
            const password = await showPasswordPrompt(world, resolvedCreator, {
              message: nextMessage,
              submitLabel: 'unlock',
              cancelLabel: 'cancel',
              includeEdit: needsEditPassword
            });
            if (!password) return;
            const viewPassword = typeof password === 'object' ? password.viewPassword : password;
            const editPassword = typeof password === 'object' ? password.editPassword : '';

            try {
              const unlocked = await verifyWorldPassword(world.id, viewPassword, 'view');
              if (unlocked) {
                rememberGuestWorldAccess(world.id, 'view', viewPasswordUpdatedAt, true);
                if (editPassword && await verifyWorldPassword(world.id, editPassword, 'edit').catch(() => false)) {
                  rememberGuestWorldAccess(world.id, 'edit', editPasswordUpdatedAt, true);
                }
                break;
              }
              nextMessage = 'Incorrect password.';
            } catch (error) {
              console.error('Failed to verify world password:', error);
              nextMessage = error?.message || 'Could not unlock world.';
            }
          }
        }
      }

      activeWorld = world;
      activeWorldCreator = resolvedCreator;
      customWorldEditRevealWorldId = '';
      worldNavLastRightClickAt = 0;
      updateWorldNavStack(world);
      renderWorldModeChrome(world, activeWorldCreator);
      dom.modeChrome.style.display = 'block';
      await renderWorldNavigation(world);

      await hydrateMyWorlds();
      await rememberWorld(world);
      setWorldUrl(world);

      populateWorldLoader(world, activeWorldCreator, {
        mode: 'loading',
        kicker: 'world',
        status: 'loading world...',
        progress: 32
      });

      await onEnterWorld?.({
        world,
        creator: activeWorldCreator,
        backgroundUrl: world.background_url || getDefaultBackgroundUrl(baseUrl),
        fontColor: world.font_color || '',
        uiColor: getWorldAccent(world)
      });
    } finally {
      if (activeWorld?.id && canUseCustomWorldFrame(activeWorld)) {
        await waitForCustomWorldFrameReady();
      }
      setWorldLoaderVisible(false);
    }
  }

  async function exitWorldMode() {
    if (!(await prepareWorldLoaderSurface())) return false;

    activeWorld = null;
    activeWorldCreator = null;
    customWorldEditRevealWorldId = '';
    worldNavLastRightClickAt = 0;
    worldNavStack = [];
    clearWorldUrl();
    parentTabAction = async () => {
      await exitWorldMode();
    };
    await renderMainNavigationChrome();
    const loaderShown = await showTransitionLoader({
      mode: 'loading',
      kicker: 'main',
      title: '4thworld',
      meta: MAIN_WORLD_USERNAME,
      status: 'loading main...',
      backgroundUrl: getDefaultBackgroundUrl(baseUrl),
      coverUrl: getDefaultBackgroundUrl(baseUrl),
      showCover: false,
      progress: 0
    });
    if (!loaderShown) return;
    await onExitWorld?.();
    await renderMainNavigationChrome();
    return true;
  }

  async function cleanupWorldAssets(worldId) {
    const [rootResult, assetsResult] = await Promise.all([
      supabase.storage.from(WORLD_BUCKET).list(worldId),
      supabase.storage.from(WORLD_BUCKET).list(`${worldId}/assets`)
    ]);

    if (rootResult.error) throw rootResult.error;
    if (assetsResult.error) throw assetsResult.error;

    const paths = [
      ...(rootResult.data || [])
        .filter((entry) => entry?.name && entry.name !== 'assets')
        .map((entry) => `${worldId}/${entry.name}`),
      ...(assetsResult.data || [])
        .filter((entry) => entry?.name)
        .map((entry) => `${worldId}/assets/${entry.name}`)
    ];
    if (paths.length === 0) return;
    const { error: removeError } = await supabase.storage.from(WORLD_BUCKET).remove(paths);
    if (removeError) throw removeError;
  }

  async function cleanupWorldPosts(worldIds) {
    const normalizedWorldIds = dedupeWorldIds(Array.isArray(worldIds) ? worldIds : [worldIds]);
    if (!normalizedWorldIds.length) return;

    const { error } = await supabase
      .from('posts')
      .delete()
      .in('world_id', normalizedWorldIds);

    if (error) throw error;
  }

  async function deleteWorld(world, options = {}) {
    const {
      includePosts = false,
      fromForm = false
    } = options;

    let descendantWorlds = [];
    let directChildWorlds = [];
    let childWorldAction = null;

    try {
      directChildWorlds = await loadDirectChildWorlds(world.id);
      if (directChildWorlds.length > 0) {
        descendantWorlds = await loadDescendantWorlds(world.id);
        childWorldAction = await chooseChildWorldDeleteMode(world, descendantWorlds);
        if (!childWorldAction) return;
      }
    } catch (error) {
      alert(`Delete failed: ${error.message}`);
      return;
    }

    const confirmed = typeof window.__prettyConfirm === 'function'
      ? await window.__prettyConfirm({
          title: 'delete world?',
          message: (() => {
            const nestedMessage = childWorldAction === 'transfer-children'
              ? 'Direct child worlds will be moved to main.'
              : (descendantWorlds.length > 0 ? 'Contained worlds will also be deleted.' : '');

            return includePosts
              ? `This deletes the world and all the posts inside it.  ${nestedMessage ? `${nestedMessage} ` : ''}Existing uploaded assets may remain in storage if bucket policies block cleanup.`.trim()
              : `This removes the world from the feed. ${nestedMessage} Existing uploaded assets may remain in storage if bucket policies block cleanup.`.trim();
          })(),
          confirmLabel: 'delete',
          cancelLabel: 'cancel',
          theme: 'delete',
          danger: true
        })
      : window.confirm('Delete this world?');

    if (!confirmed) return;

    if (fromForm && isMakerOpen()) {
      closeMaker();
    }

    const isActive = activeWorld?.id === world.id;
    if (isActive) {
      await exitWorldMode();
    }

    const descendantWorldIds = descendantWorlds.map((childWorld) => String(childWorld.id || '').trim()).filter(Boolean);
    const targetWorldIdsForPostDelete = includePosts
      ? dedupeWorldIds([world.id, ...descendantWorldIds])
      : (childWorldAction === 'delete-children' ? descendantWorldIds : []);

    try {
      if (targetWorldIdsForPostDelete.length > 0) {
        await cleanupWorldPosts(targetWorldIdsForPostDelete);
      }

      if (childWorldAction === 'delete-children' && descendantWorldIds.length > 0) {
        const { error: deleteDescendantsError } = await supabase
          .from('worlds')
          .delete()
          .in('id', descendantWorldIds);

        if (deleteDescendantsError) throw deleteDescendantsError;
      }
    } catch (error) {
      alert(`Delete failed: ${error.message}`);
      return;
    }

    const { error } = await supabase
      .from('worlds')
      .delete()
      .eq('id', world.id)
      .eq('user_id', getCurrentUser()?.id || '');

    if (error) {
      alert(`Delete failed: ${error.message}`);
      return;
    }

    try {
      await cleanupWorldAssets(world.id);
      if (childWorldAction === 'delete-children' && descendantWorldIds.length > 0) {
        await Promise.allSettled(descendantWorldIds.map((worldId) => cleanupWorldAssets(worldId)));
      }
    } catch (cleanupError) {
      console.warn('World asset cleanup skipped:', cleanupError?.message || cleanupError);
    }

    pruneRememberedWorld(world.id);

    if (!isActive) {
      if (activeWorld?.id) {
        await renderWorldNavigation(activeWorld);
      } else {
        await renderMainNavigationChrome();
      }
    }

    await onWorldDeleted?.(world);
  }

  async function uploadWorldFile(worldId, fileName, file) {
    const storagePath = `${worldId}/${fileName}`;
    const inferredType = String(file?.type || '').trim() || guessMimeFromFileName(fileName) || 'application/octet-stream';
    const uploadResult = await withRateLimitRetry(async () => {
      const { error: uploadError } = await supabase.storage
        .from(WORLD_BUCKET)
        .upload(storagePath, file, {
          upsert: true,
          contentType: inferredType
        });

      if (uploadError) throw uploadError;
      return true;
    }, {
      retries: 5,
      baseDelayMs: 650,
      maxDelayMs: 8000
    });

    if (!uploadResult) {
      throw new Error('Upload failed.');
    }

    const { data } = supabase.storage.from(WORLD_BUCKET).getPublicUrl(storagePath);
    return data.publicUrl;
  }

  function getWorldUiAssetKind(file) {
    const type = String(file?.type || '').toLowerCase();
    const ext = getFileExtension(file?.name || '');
    if (type === 'image/png' || ext === 'png') return 'png';
    if (type === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg') return 'jpeg';
    if (type === 'video/mp4' || ext === 'mp4') return 'video';
    if (type === 'video/webm' || ext === 'webm') return 'video';
    return '';
  }

  function getWorldUiAssetStorageName(file) {
    const rawName = normalizeStorageName(file?.name || 'asset');
    return rawName || 'asset';
  }

  function validateWorldUiAssetFiles(files = []) {
    const assetFiles = Array.from(files || []).filter(Boolean);
    let pngCount = 0;
    let jpegCount = 0;
    let videoCount = 0;
    let totalBytes = 0;
    const storageNames = new Set();

    for (const file of assetFiles) {
      const kind = getWorldUiAssetKind(file);
      if (!kind) {
        throw new Error('UI assets must be PNG, JPEG, MP4, or WebM files.');
      }

      const size = Number(file.size || 0);
      totalBytes += size;

      if (kind === 'png') {
        pngCount += 1;
        if (size > WORLD_UI_ASSET_MAX_PNG_BYTES) {
          throw new Error(`"${file.name}" is too large. PNG UI assets must be 2 MB or smaller.`);
        }
      }

      if (kind === 'jpeg') {
        jpegCount += 1;
        if (size > WORLD_UI_ASSET_MAX_JPEG_BYTES) {
          throw new Error(`"${file.name}" is too large. JPEG UI assets must be 4 MB or smaller.`);
        }
      }

      if (kind === 'video') {
        videoCount += 1;
        if (size > WORLD_UI_ASSET_MAX_VIDEO_BYTES) {
          throw new Error(`"${file.name}" is too large. Video UI assets must be 80 MB or smaller.`);
        }
      }

      const storageName = getWorldUiAssetStorageName(file);
      if (!storageName || storageName === 'asset') {
        throw new Error('UI asset filenames must contain letters or numbers.');
      }

      if (storageNames.has(storageName.toLowerCase())) {
        throw new Error(`Duplicate UI asset filename after cleanup: ${storageName}`);
      }
      storageNames.add(storageName.toLowerCase());
    }

    if (pngCount > WORLD_UI_ASSET_MAX_PNGS) {
      throw new Error(`Choose ${WORLD_UI_ASSET_MAX_PNGS} PNG UI assets or fewer.`);
    }

    if (jpegCount > WORLD_UI_ASSET_MAX_JPEGS) {
      throw new Error(`Choose ${WORLD_UI_ASSET_MAX_JPEGS} JPEG UI assets or fewer.`);
    }

    if (videoCount > WORLD_UI_ASSET_MAX_VIDEOS) {
      throw new Error(`Choose ${WORLD_UI_ASSET_MAX_VIDEOS} video UI assets or fewer.`);
    }

    if (totalBytes > WORLD_UI_ASSET_MAX_TOTAL_BYTES) {
      throw new Error('UI assets are too large together. Keep the total at 180 MB or less.');
    }

    return assetFiles;
  }

  async function uploadWorldUiAssets(worldId, files = [], options = {}) {
    const assetFiles = validateWorldUiAssetFiles(files);
    const uploaded = [];

    for (let index = 0; index < assetFiles.length; index += 1) {
      const file = assetFiles[index];
      const storageName = getWorldUiAssetStorageName(file);
      options.onUploadStart?.({ file, storageName, index, total: assetFiles.length });
      const url = await uploadWorldFile(worldId, `assets/${storageName}`, file);
      uploaded.push({
        name: storageName,
        originalName: file.name || storageName,
        url,
        path: `./assets/${storageName}`,
        type: getWorldUiAssetKind(file),
        size: Number(file.size || 0)
      });
    }

    if (uploaded.length > 0) {
      options.onManifestStart?.();
      const manifestFile = new File([
        JSON.stringify({ assets: uploaded }, null, 2)
      ], 'manifest.json', { type: 'application/json' });
      await uploadWorldFile(worldId, 'assets/manifest.json', manifestFile);
    }

    return uploaded;
  }

  async function updateWorldCoverAsset(worldId, userId, coverUrl) {
    const payloadCandidates = [
      { cover_url: coverUrl },
      { background_url: coverUrl }
    ];

    let lastError = null;

    for (let i = 0; i < payloadCandidates.length; i += 1) {
      const payload = payloadCandidates[i];
      let query = supabase
        .from('worlds')
        .update(payload)
        .eq('id', worldId);

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data: updated, error } = await withRateLimitRetry(async () => {
        return query
          .select('*')
          .single();
      }, {
        retries: 4,
        baseDelayMs: 500,
        maxDelayMs: 6000
      });

      if (!error) {
        return updated;
      }

      lastError = error;
      const missingCoverColumn = i === 0 && /cover_url|schema cache|column/i.test(`${error?.code || ''} ${error?.message || ''}`);
      if (missingCoverColumn) {
        continue;
      }

      throw error;
    }

    throw lastError || new Error('Failed to save world cover.');
  }

  async function setWorldPassword(worldId, passwordOptions = {}) {
    const viewPassword = String(passwordOptions?.viewPassword || '').trim();
    const editPassword = String(passwordOptions?.editPassword || '').trim();
    const viewIsPublic = Boolean(passwordOptions?.viewIsPublic);
    const editIsPublic = Boolean(passwordOptions?.editIsPublic);

    const payloadCandidates = [
      {
        p_world_id: worldId,
        p_view_password: viewPassword,
        p_edit_password: editPassword,
        p_view_public: viewIsPublic,
        p_edit_public: editIsPublic
      },
      {
        world_id: worldId,
        view_password: viewPassword,
        edit_password: editPassword,
        view_public: viewIsPublic,
        edit_public: editIsPublic
      }
    ];

    let lastError = null;

    for (const payload of payloadCandidates) {
      const { data, error } = await supabase.rpc('set_world_password', payload);
      if (!error) {
        return;
      }

      lastError = error;

      // PGRST202 = function signature not found in schema cache.
      // Try the next payload shape before surfacing the error.
      if (error.code === 'PGRST202') {
        continue;
      }

      throw error;
    }

    throw lastError || new Error('Failed to update world password.');
  }

  function shouldUpdateWorldPassword(passwordOptions = {}, world = null) {
    if (!passwordOptions) return false;

    const viewIsPublic = passwordOptions.viewIsPublic !== false;
    const editIsPublic = passwordOptions.editIsPublic !== false;
    const viewPassword = String(passwordOptions.viewPassword || '').trim();
    const editPassword = String(passwordOptions.editPassword || '').trim();

    if (!viewIsPublic && viewPassword) return true;
    if (!editIsPublic && editPassword) return true;
    if (viewIsPublic && hasWorldPassword(world, 'view')) return true;
    if (editIsPublic && hasWorldPassword(world, 'edit')) return true;

    return false;
  }

  function readBridgeBoolean(value, fallback = true) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === 'public' || normalized === '1') return true;
      if (normalized === 'false' || normalized === 'private' || normalized === '0') return false;
    }
    return fallback;
  }

  async function createCustomWorldForBridge(params = {}) {
    if (!activeWorld?.id || !canUseCustomWorldFrame(activeWorld)) {
      throw new Error('No active custom world.');
    }

    const canCreate = await canCreateWorldInActiveContext();
    if (!canCreate) return null;

    const currentUser = getCurrentUser?.();
    if (!currentUser?.id) throw new Error('You must be signed in to create a world.');

    const name = String(params?.name || '').trim().slice(0, 80);
    if (!name) throw new Error('World name is required.');

    const html = String(params?.html || '').trim();
    const css = String(params?.css || '').trim();
    const type = String(params?.type || (html ? 'code' : 'plug')).trim().toLowerCase();
    const isCodeWorld = type === 'code' || Boolean(html);

    if (isCodeWorld && !html) {
      throw new Error('Custom code worlds need an html string.');
    }

    const visibility = params?.visibility ?? params?.is_public_view;
    const editing = params?.editing ?? params?.is_public_edit;
    const viewIsPublic = readBridgeBoolean(visibility, true);
    const editIsPublic = readBridgeBoolean(editing, true);
    const viewPassword = String(params?.viewPassword || params?.view_password || '').trim();
    const editPassword = String(params?.editPassword || params?.edit_password || '').trim();

    if (!viewIsPublic && !viewPassword) throw new Error('Private view mode needs a password.');
    if (!editIsPublic && !editPassword) throw new Error('Private edit mode needs a password.');

    const fallbackStyle = getMakerColorSource(false);
    const fontFamily = String(params?.font_family || fallbackStyle.font_family || WORLD_FONTS[0]?.value || '').trim() || null;
    const fontColor = normalizeColorInputValue(params?.font_color || params?.ui_color || fallbackStyle.font_color, DEFAULT_UI_COLOR);
    const backgroundColor = normalizeColorInputValue(params?.background_color || fallbackStyle.background_color || fallbackStyle.ui_color, '#05070b');
    const category = String(params?.category || '').trim() || null;

    const { data: inserted, error: insertError } = await supabase
      .from('worlds')
      .insert([{
        name,
        category,
        font_family: fontFamily,
        font_color: fontColor,
        ui_color: fontColor,
        background_color: backgroundColor,
        is_public_view: viewIsPublic,
        is_public_edit: editIsPublic,
        update_mode: 'auto',
        user_id: currentUser.id,
        parent_world_id: activeWorld.id,
        background_url: null,
        custom_code_url: null
      }])
      .select('*')
      .single();

    if (insertError) throw insertError;
    let nextWorld = inserted;

    if (isCodeWorld) {
      const htmlFile = buildCustomWorldHtmlFile(html, css || '');
      const cssFile = new File([css || ''], 'world.css', { type: 'text/css' });
      const customCodeUrl = await uploadWorldFile(nextWorld.id, 'world.html', htmlFile);
      await uploadWorldFile(nextWorld.id, 'world.css', cssFile);

      const assetFiles = validateWorldUiAssetFiles(params?.assets || []);
      if (assetFiles.length > 0) {
        await uploadWorldUiAssets(nextWorld.id, assetFiles);
      }

      if (params?.cover) {
        const coverFile = params.cover;
        const optimizedCoverFile = await optimizeWorldCoverImage(coverFile);
        const coverUrl = await uploadWorldFile(
          nextWorld.id,
          `cover-${Date.now()}-${normalizeStorageName(optimizedCoverFile?.name || coverFile.name || 'world-cover')}`,
          optimizedCoverFile || coverFile
        );

        nextWorld = await updateWorldCoverAsset(nextWorld.id, currentUser.id, coverUrl);
      }

      const { data: updatedCode, error: updateCodeError } = await supabase
        .from('worlds')
        .update({ custom_code_url: customCodeUrl })
        .eq('id', nextWorld.id)
        .select('*')
        .single();

      if (updateCodeError) throw updateCodeError;
      nextWorld = updatedCode;
    }

    if (!viewIsPublic || !editIsPublic) {
      await setWorldPassword(nextWorld.id, {
        viewPassword,
        editPassword,
        viewIsPublic,
        editIsPublic
      });
      nextWorld = await loadWorldById(nextWorld.id) || nextWorld;
    }

    await onWorldCreated?.(nextWorld, {
      startPlacement: false
    });

    return safeBridgeWorld(nextWorld);
  }

  async function publishPlugWorld() {
    if (publishInFlight) return;

    const name = dom.plugName.value.trim();
    if (!name) {
      alert('World name is required.');
      return;
    }

    const currentUser = getCurrentUser?.();
    if (!currentUser?.id) return;
    const isEdit = makerMode === 'edit' && Boolean(makerEditingWorld?.id);
    const editingWorldId = makerEditingWorld?.id || null;
    const resolvedPassword = resolvePlugWorldPassword();
    if (resolvedPassword === null) {
      return;
    }

    publishInFlight = true;
    dom.plugPublish.disabled = true;
    dom.plugPublish.textContent = isEdit ? 'updating...' : 'publishing...';

    try {
      const styleDraft = readMakerStyle('plug');
      const draft = {
        name,
        category: String(dom.plugCategoryHidden?.value || '').trim() || null,
        ...styleDraft,
        is_public_view: dom.plugVisibility.value !== 'false',
        is_public_edit: dom.plugEditing.value !== 'false',
        update_mode: 'auto'
      };

      let nextWorld = null;

      if (isEdit) {
        const { data: updated, error: updateError } = await supabase
          .from('worlds')
          .update(draft)
          .eq('id', editingWorldId)
          .eq('user_id', currentUser.id)
          .select('*')
          .single();

        if (updateError) throw updateError;
        nextWorld = updated;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('worlds')
          .insert([{
            ...draft,
            user_id: currentUser.id,
            parent_world_id: activeWorld?.id || null,
            background_url: null,
            custom_code_url: null
          }])
          .select('*')
          .single();

        if (insertError) throw insertError;
        nextWorld = inserted;
      }
      const bgFile = dom.plugBackground.files?.[0] || null;
      const coverFile = dom.plugCover.files?.[0] || null;
      if (bgFile) {
        dom.plugPublish.textContent = 'uploading background...';
        const optimizedBgFile = await optimizeWorldBackgroundImage(bgFile);
        const backgroundUrl = await uploadWorldFile(
          nextWorld.id,
          `background-${Date.now()}-${normalizeStorageName(optimizedBgFile?.name || bgFile.name)}`,
          optimizedBgFile || bgFile
        );

        const { data: updated, error: updateError } = await supabase
          .from('worlds')
          .update({ background_url: backgroundUrl })
          .eq('id', nextWorld.id)
          .select('*')
          .single();

        if (updateError) throw updateError;
        nextWorld = updated;
      }

      if (coverFile) {
        dom.plugPublish.textContent = 'uploading cover...';
        const optimizedCoverFile = await optimizeWorldCoverImage(coverFile);
        const coverUrl = await uploadWorldFile(
          nextWorld.id,
          `cover-${Date.now()}-${normalizeStorageName(optimizedCoverFile?.name || coverFile.name)}`,
          optimizedCoverFile || coverFile
        );

        nextWorld = await updateWorldCoverAsset(nextWorld.id, currentUser.id, coverUrl);
      }

      if (shouldUpdateWorldPassword(resolvedPassword, isEdit ? makerEditingWorld : null)) {
        dom.plugPublish.textContent = 'saving access...';
        await setWorldPassword(nextWorld.id, resolvedPassword);
        nextWorld = await loadWorldById(nextWorld.id) || nextWorld;
      }

      if (activeWorld?.id === nextWorld.id) {
        activeWorld = nextWorld;
      }

      closeMaker();
      await onWorldCreated?.(nextWorld, {
        startPlacement: !isEdit
      });
    } catch (error) {
      alert(`World save failed: ${getErrorMessage(error)}`);
    } finally {
      publishInFlight = false;
      dom.plugPublish.disabled = false;
      dom.plugPublish.textContent = 'submit';
    }
  }

  async function publishCodeWorld() {
    if (publishInFlight) return;

    const name = dom.codeName.value.trim();
    const htmlFile = dom.codeHtml.files?.[0] || null;
    const cssFile = dom.codeCss.files?.[0] || null;
    const coverFile = dom.codeCover.files?.[0] || null;
    const isEdit = makerMode === 'edit' && Boolean(makerEditingWorld?.id);
    const editingWorldId = makerEditingWorld?.id || null;
    const resolvedPassword = resolveCodeWorldPassword();
    if (resolvedPassword === null) {
      return;
    }

    if (!name || (!isEdit && (!htmlFile || !cssFile))) {
      alert('Upload world.html and world.css, then fill in name.');
      return;
    }

    const currentUser = getCurrentUser?.();
    if (!currentUser?.id) return;

    publishInFlight = true;
    dom.codePublish.disabled = true;
    dom.codePublish.textContent = isEdit ? 'updating...' : 'publishing...';

    try {
      dom.codePublish.textContent = isEdit ? 'saving world...' : 'creating world...';
      const assetFiles = validateWorldUiAssetFiles(dom.codeAssets?.files || []);
      const htmlTextForValidation = htmlFile ? await htmlFile.text() : '';
      const cssTextForValidation = cssFile ? await cssFile.text() : '';
      validateCustomWorldAssetReferences(htmlTextForValidation, cssTextForValidation, assetFiles, {
        requireAll: !isEdit
      });
      const styleDraft = readMakerStyle('code');
      const draft = {
        name,
        category: String(dom.codeCategoryHidden?.value || '').trim() || null,
        ...styleDraft,
        is_public_view: dom.codeVisibility.value !== 'false',
        is_public_edit: dom.codeEditing.value !== 'false'
      };

      let nextWorld = null;

      if (isEdit) {
        const { data: updatedBase, error: updateBaseError } = await supabase
          .from('worlds')
          .update(draft)
          .eq('id', editingWorldId)
          .eq('user_id', currentUser.id)
          .select('*')
          .single();

        if (updateBaseError) throw updateBaseError;
        nextWorld = updatedBase;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('worlds')
          .insert([{
            ...draft,
            user_id: currentUser.id,
            parent_world_id: activeWorld?.id || null,
            background_url: null,
            custom_code_url: null,
            update_mode: 'auto'
          }])
          .select('*')
          .single();

        if (insertError) throw insertError;
        nextWorld = inserted;
      }

      let customCodeUrl = nextWorld.custom_code_url || null;
      const codeFilesChanged = Boolean(htmlFile || cssFile);

      if (codeFilesChanged) {
        const htmlText = htmlFile
          ? htmlTextForValidation
          : await fetchCustomWorldText(customCodeUrl);
        let cssText = cssFile ? cssTextForValidation : '';
        if (!cssFile) {
          try {
            cssText = await fetchCustomWorldText(getCustomWorldCssUrl(customCodeUrl));
          } catch {
            cssText = '';
          }
        }

        if (cssFile) {
          dom.codePublish.textContent = 'uploading css...';
          await uploadWorldFile(nextWorld.id, 'world.css', cssFile);
        }

        dom.codePublish.textContent = 'uploading html...';
        customCodeUrl = await uploadWorldFile(
          nextWorld.id,
          'world.html',
          buildCustomWorldHtmlFile(htmlText, cssText)
        );
        customWorldFrameVersionById.set(String(nextWorld.id), String(Date.now()));
      }

      if (assetFiles.length > 0) {
        await uploadWorldUiAssets(nextWorld.id, assetFiles, {
          onUploadStart: ({ file, index, total }) => {
            const fileName = String(file?.name || 'asset').trim() || 'asset';
            dom.codePublish.textContent = `uploading ${index + 1}/${total}: ${fileName}`;
          },
          onManifestStart: () => {
            dom.codePublish.textContent = 'saving asset list...';
          }
        });
      }

      if (coverFile) {
        dom.codePublish.textContent = 'uploading cover...';
        const optimizedCoverFile = await optimizeWorldCoverImage(coverFile);
        const coverUrl = await uploadWorldFile(
          nextWorld.id,
          `cover-${Date.now()}-${normalizeStorageName(optimizedCoverFile?.name || coverFile.name)}`,
          optimizedCoverFile || coverFile
        );

        nextWorld = await updateWorldCoverAsset(nextWorld.id, currentUser.id, coverUrl);
      }

      if (codeFilesChanged || customCodeUrl !== nextWorld.custom_code_url) {
        dom.codePublish.textContent = 'saving code link...';
        const { data: updatedCode, error: updateCodeError } = await supabase
          .from('worlds')
          .update({ custom_code_url: customCodeUrl })
          .eq('id', nextWorld.id)
          .select('*')
          .single();

        if (updateCodeError) throw updateCodeError;
        nextWorld = updatedCode;
      }

      if (shouldUpdateWorldPassword(resolvedPassword, isEdit ? makerEditingWorld : null)) {
        dom.codePublish.textContent = 'saving access...';
        await setWorldPassword(nextWorld.id, resolvedPassword);
        nextWorld = await loadWorldById(nextWorld.id) || nextWorld;
      }

      if (activeWorld?.id === nextWorld.id) {
        activeWorld = nextWorld;
      }

      closeMaker();
      await onWorldCreated?.(nextWorld, {
        startPlacement: !isEdit
      });
    } catch (error) {
      alert(`World save failed: ${getErrorMessage(error)}`);
    } finally {
      publishInFlight = false;
      dom.codePublish.disabled = false;
      dom.codePublish.textContent = 'submit';
    }
  }

  async function optimizeExistingWorldBackgrounds(options = {}) {
    const {
      dryRun = false,
      onlyWorldId = null
    } = options;

    const currentUser = getCurrentUser?.();
    if (!currentUser?.id) {
      throw new Error('You must be signed in to optimize world backgrounds.');
    }

    let query = supabase
      .from('worlds')
      .select('id, user_id, name, background_url')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (onlyWorldId) {
      query = query.eq('id', onlyWorldId);
    }

    const { data: worlds, error } = await query;
    if (error) throw error;

    const candidates = (worlds || []).filter((world) => {
      const bgUrl = String(world?.background_url || '').trim();
      return Boolean(bgUrl);
    });

    const report = {
      totalWorlds: candidates.length,
      optimized: 0,
      skipped: 0,
      failed: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      details: []
    };

    for (const world of candidates) {
      const worldId = String(world.id || '').trim();
      const bgUrl = String(world.background_url || '').trim();
      if (!worldId || !bgUrl) {
        report.skipped += 1;
        continue;
      }

      try {
        const response = await withRateLimitRetry(async () => {
          const nextResponse = await fetch(bgUrl, { cache: 'no-store' });
          if (nextResponse.status === 429) {
            const rateErr = new Error('Too many requests, please try again later.');
            rateErr.status = 429;
            throw rateErr;
          }
          if (!nextResponse.ok) {
            throw new Error(`download failed (${nextResponse.status})`);
          }
          return nextResponse;
        }, {
          retries: 5,
          baseDelayMs: 700,
          maxDelayMs: 9000
        });

        const originalBlob = await response.blob();
        const inputFileName = getFileNameFromUrl(bgUrl, `background-${worldId}`);
        const blobMime = String(originalBlob.type || '').toLowerCase();
        const fallbackMime = guessMimeFromFileName(inputFileName);
        const inputType = blobMime.startsWith('image/')
          ? blobMime
          : (fallbackMime || 'image/jpeg');
        const inputFile = new File([originalBlob], inputFileName, { type: inputType });

        const optimizedFile = await optimizeWorldBackgroundImage(inputFile);
        if (!optimizedFile) {
          report.skipped += 1;
          report.details.push({ worldId, name: world.name || DEFAULT_WORLD_TITLE, reason: 'optimizer returned no file' });
          continue;
        }

        report.bytesBefore += originalBlob.size || 0;
        report.bytesAfter += optimizedFile.size || 0;

        if (!dryRun) {
          const optimizedName = `background-${Date.now()}-${normalizeStorageName(optimizedFile.name || inputFile.name)}`;
          const nextBackgroundUrl = await uploadWorldFile(worldId, optimizedName, optimizedFile);

          const { data: updated, error: updateError } = await withRateLimitRetry(async () => {
            return supabase
              .from('worlds')
              .update({ background_url: nextBackgroundUrl })
              .eq('id', worldId)
              .eq('user_id', currentUser.id)
              .select('*')
              .single();
          }, {
            retries: 4,
            baseDelayMs: 500,
            maxDelayMs: 6000
          });

          if (updateError) throw updateError;

          if (activeWorld?.id === worldId) {
            activeWorld = updated;
          }
        }

        report.optimized += 1;
      } catch (err) {
        report.failed += 1;
        report.details.push({
          worldId,
          name: world.name || DEFAULT_WORLD_TITLE,
          reason: getErrorMessage(err)
        });
      }
    }

    return report;
  }

  async function downloadTemplateZip() {
    const blob = await buildTemplateZip();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'world-template.zip';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function buildWorldCard(world, creator = {}, options = {}) {
    const card = document.createElement('div');
    card.className = 'post-card world-card';
    card.dataset.worldId = world.id;
    card.dataset.scaleKey = `world:${world.id}`;
    card.dataset.lod = 'near';

    const idx = options.index || 0;
    const fallbackX = 60 + (idx % 4) * 390;
    const fallbackY = 60 + Math.floor(idx / 4) * 360;
    card.style.left = `${options.x ?? fallbackX}px`;
    card.style.top = `${options.y ?? fallbackY}px`;
    card.style.setProperty('--world-ui-color', getWorldAccent(world));
    const containerFontColor = String(options?.containerFontColor || '').trim();
    // Color: always use the containing world's color; only fall back to card's own color
    // when there is no container context at all (e.g. old call-sites that never pass the option)
    const hasContainerContext = Object.prototype.hasOwnProperty.call(options || {}, 'containerFontColor');
    const effectiveColor = containerFontColor || (!hasContainerContext ? String(world?.font_color || '').trim() : '');
    if (effectiveColor) {
      card.style.color = effectiveColor;
    } else {
      card.style.removeProperty('color');
    }
    // Font family: always use the card world's own font
    // (removed — world cards now use system default font)

    const coverUrl = getOptimizedWorldCardCoverUrl(getWorldCardCoverUrl(world, baseUrl));
    const currentUserId = getCurrentUser?.()?.id || null;
    const canEdit = typeof options.canEditWorld === 'function'
      ? Boolean(options.canEditWorld(world))
      : Boolean(currentUserId && currentUserId === world.user_id);
    const showMoveControl = Boolean(options.editMode && canEdit);
    card.innerHTML = `
      <div class="post-card-content world-card-content">
        <div class="world-card-orb-wrap">
          <div class="world-card-screen">
            <img class="world-card-cover" src="${escapeHtml(coverUrl)}" alt="" loading="lazy" decoding="async">
          </div>
        </div>
      </div>
      ${showMoveControl ? `
        <div class="post-edit-chrome world-edit-chrome" aria-hidden="false">
          <div class="post-edit-top-actions" aria-label="world edit actions">
            <button class="post-edit-button post-edit-button-move world-card-move" type="button" title="move" aria-label="move world">𖦏</button>
          </div>
        </div>
      ` : ''}
    `;

    if (showMoveControl) {
      ['nw', 'ne', 'sw', 'se'].forEach((corner) => {
        const resizeTab = document.createElement('button');
        resizeTab.type = 'button';
        resizeTab.className = `post-resize-tab post-resize-tab-${corner}`;
        resizeTab.title = 'drag to resize';
        resizeTab.dataset.corner = corner;
        resizeTab.addEventListener('mousedown', (e) => {
          options.onBeginResize?.(e, card, world.id, corner);
        });
        card.appendChild(resizeTab);
      });
    }

    const coverScreen = card.querySelector('.world-card-screen');
    const coverImage = card.querySelector('.world-card-cover');

    if (coverScreen && coverImage) {
      coverScreen.classList.add('is-loading');

      const markReady = () => {
        coverScreen.classList.remove('is-loading');
        coverImage.removeEventListener('load', markReady);
        coverImage.removeEventListener('error', markReady);
      };

      if (coverImage.complete && coverImage.naturalWidth > 0) {
        markReady();
      } else {
        coverImage.addEventListener('load', markReady, { once: true });
        coverImage.addEventListener('error', markReady, { once: true });
      }
    }

    card.querySelector('.world-card-move')?.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      options.onBeginMove?.(world, card, event);
    });

    card.querySelector('.world-card-move')?.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
    });

    card.querySelector('.world-card-move')?.addEventListener('click', (event) => {
      if (event.detail !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      const syntheticEvent = window.__lastMouseEventForPlacement || { clientX: 200, clientY: 200 };
      options.onBeginMove?.(world, card, syntheticEvent);
    });

    card.addEventListener('click', async () => {
      if (options.editMode) return;
      if (options.isPlacementActive?.()) return;
      await openWorldMode(world, creator);
    });

    return card;
  }

  async function closeActiveUi() {
    if (isMakerOpen()) {
      await maybeCloseMaker();
      return true;
    }
    return false;
  }

  window.addEventListener('message', (event) => {
    void handleCustomWorldBridgeMessage(event);
  });
  dom.modeFrame?.addEventListener('load', () => {
    const hasInlineDocument = dom.modeFrame.hasAttribute('srcdoc');
    const isBlankNavigation = dom.modeFrame.src === 'about:blank' && !hasInlineDocument;
    if (!isBlankNavigation) {
      revealCustomWorldFrame();
    }
    void postCustomWorldBridgeReady();
  });
  dom.modePlugBtn.addEventListener('click', () => showStep('plug'));
  dom.modeCodeBtn.addEventListener('click', () => showStep('code'));
  dom.makerClose.addEventListener('click', () => { void maybeCloseMaker(); });
  dom.plugBack.addEventListener('click', () => { void maybeCloseMaker(); });
  dom.codeBack.addEventListener('click', () => { void maybeCloseMaker(); });
  dom.plugPublish.addEventListener('click', publishPlugWorld);
  dom.codePublish.addEventListener('click', publishCodeWorld);
  dom.codeDownload.addEventListener('click', downloadTemplateZip);
  wirePlugCategoryEvents();
  wireCodeCategoryEvents();
  dom.logoutBtn?.addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      alert(`Logout failed: ${error.message}`);
      return;
    }
    window.location.replace('/login');
  });
  dom.modeEditBtn?.addEventListener('click', async () => {
    if (!activeWorld?.id) return;
    const currentUserId = String(getCurrentUser?.()?.id || '').trim();
    const ownerId = String(activeWorld?.user_id || '').trim();
    if (!currentUserId || !ownerId || currentUserId !== ownerId) return;
    const latestWorld = await loadWorldById(activeWorld.id);
    customWorldEditRevealWorldId = '';
    renderWorldModeChrome(activeWorld, activeWorldCreator);
    await openMakerForEdit(latestWorld || activeWorld);
  });
  dom.modeNavBar?.addEventListener('contextmenu', (event) => {
    if (!activeWorld?.id || !canUseCustomWorldFrame(activeWorld)) return;

    const currentUserId = String(getCurrentUser?.()?.id || '').trim();
    const ownerId = String(activeWorld?.user_id || '').trim();
    if (!currentUserId || !ownerId || currentUserId !== ownerId) return;

    event.preventDefault();
    const now = Date.now();
    const isDoubleRightClick = now - worldNavLastRightClickAt <= 400;
    worldNavLastRightClickAt = now;
    if (!isDoubleRightClick) return;

    worldNavLastRightClickAt = 0;
    const activeWorldId = String(activeWorld.id);
    customWorldEditRevealWorldId = customWorldEditRevealWorldId === activeWorldId ? '' : activeWorldId;
    renderWorldModeChrome(activeWorld, activeWorldCreator);
  });
  dom.modeDelete.addEventListener('click', async () => {
    if (activeWorld) {
      await deleteWorld(activeWorld);
    }
  });
  const handleMakerDeleteClick = async () => {
    if (!makerEditingWorld?.id) return;
    await deleteWorld(makerEditingWorld, {
      includePosts: true,
      fromForm: true
    });
  };
  dom.makerDeleteButtons.forEach((button) => {
    button.addEventListener('click', handleMakerDeleteClick);
  });

  dom.passwordCancel?.addEventListener('click', () => {
    closePasswordPrompt(null);
  });

  dom.passwordSubmit?.addEventListener('click', () => {
    if (!passwordPromptState?.worldId) {
      closePasswordPrompt(null);
      return;
    }

    if (!dom.passwordInput) {
      closePasswordPrompt(null);
      return;
    }

    const nextPassword = readPasswordInput(dom.passwordInput);
    const nextEditPassword = readPasswordInput(dom.editPasswordInput);
    if (!nextPassword && !passwordPromptState?.allowEmpty) {
      if (dom.passwordError) {
        dom.passwordError.textContent = passwordPromptState?.emptyError || 'Enter a password.';
      }
      return;
    }

    if (passwordPromptState?.includeEdit) {
      closePasswordPrompt({ viewPassword: nextPassword, editPassword: nextEditPassword });
      return;
    }

    closePasswordPrompt(nextPassword);
  });

  [dom.passwordInput, dom.editPasswordInput].forEach((input) => input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      dom.passwordSubmit?.click();
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closePasswordPrompt(null);
    }
  }));

  dom.passwordOverlay?.addEventListener('click', (event) => {
    const isBackdropTarget = event.target === dom.passwordOverlay
      || event.target === dom.loaderBackdrop
      || event.target === dom.loaderWash;
    if (isBackdropTarget && dom.passwordOverlay?.dataset.mode === 'password') {
      closePasswordPrompt(null);
    }
  });

  dom.makerOverlay.addEventListener('click', (event) => {
    if (event.target === dom.makerOverlay) {
      void maybeCloseMaker();
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-world-dropdown]')) {
      closeWorldDropdowns();
    }
  });

  dom.plugCover.addEventListener('change', () => {
    dom.plugCoverLabel.textContent = dom.plugCover.files?.[0]?.name || 'use world background as cover';
  });
  dom.plugBackground.addEventListener('change', () => {
    dom.plugBackgroundLabel.textContent = dom.plugBackground.files?.[0]?.name || 'use site background';
  });
  dom.plugVisibility.addEventListener('change', syncPlugAccessPasswordVisibility);
  dom.plugEditing.addEventListener('change', syncPlugAccessPasswordVisibility);
  dom.codeVisibility.addEventListener('change', syncCodeAccessPasswordVisibility);
  dom.codeEditing.addEventListener('change', syncCodeAccessPasswordVisibility);
  dom.codeHtml.addEventListener('change', () => {
    dom.codeHtmlLabel.textContent = dom.codeHtml.files?.[0]?.name || 'choose html';
  });
  dom.codeCss.addEventListener('change', () => {
    dom.codeCssLabel.textContent = dom.codeCss.files?.[0]?.name || 'choose css';
  });
  dom.codeCover.addEventListener('change', () => {
    dom.codeCoverLabel.textContent = dom.codeCover.files?.[0]?.name || 'choose world card cover';
  });
  dom.codeAssets.addEventListener('change', () => {
    const files = Array.from(dom.codeAssets.files || []);
    if (!files.length) {
      dom.codeAssetsLabel.textContent = 'choose ui assets';
      return;
    }
    const pngCount = files.filter((file) => getWorldUiAssetKind(file) === 'png').length;
    const jpegCount = files.filter((file) => getWorldUiAssetKind(file) === 'jpeg').length;
    const videoCount = files.filter((file) => getWorldUiAssetKind(file) === 'video').length;
    dom.codeAssetsLabel.textContent = `${pngCount} png / ${jpegCount} jpg / ${videoCount} video ui assets`;
  });

  setupWorldDropdown(dom.plugVisibility);
  setupWorldDropdown(dom.plugEditing);
  setupWorldDropdown(dom.plugFont, { useOptionFontFamily: true });
  setupWorldDropdown(dom.codeVisibility);
  setupWorldDropdown(dom.codeEditing);
  setupWorldDropdown(dom.codeFont, { useOptionFontFamily: true });

  syncCategories();
  syncCodeAccessPasswordVisibility();
  hydrateMyWorlds().catch((error) => {
    console.warn('Failed to hydrate My Worlds:', error);
  });
  renderMainNavigationChrome().catch((error) => {
    console.warn('Failed to render main navigation chrome:', error);
  });

  return {
    loadWorlds,
    buildWorldCard,
    showTransitionLoader,
    hideTransitionLoader,
    setWorldLoaderProgress,
    syncCategories,
    openWorldMaker: openMaker,
    maybeCloseMaker,
    closeActiveUi,
    isMakerOpen,
    isInWorldMode,
    openWorldById,
    openWorldByPathSegment,
    ensureWorldEditAccess,
    optimizeExistingWorldBackgrounds,
    refreshActiveWorldChrome: async (nextWorld = null) => {
      if (nextWorld && activeWorld && nextWorld.id === activeWorld.id) {
        activeWorld = nextWorld;
      }
      if (activeWorld && activeWorldCreator && isInWorldMode()) {
        await renderWorldNavigation(activeWorld);
        renderWorldModeChrome(activeWorld, activeWorldCreator);
      } else {
        await renderMainNavigationChrome();
      }
    }
  };
}
