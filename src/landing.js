// ============================================
// LANDING.JS FILE MAP
// 0. PROFILE PICTURE GRID SETUP
// 1. DOM REFERENCES
// 2. UI STATE
// 3. VIEW TOGGLE (LOGIN/SIGNUP)
// 4. PFP SELECTION AND UPLOAD
// 5. FORM VALIDATION
// 6. LOGIN FLOW
// 7. SIGNUP FLOW
// 8. KEYBOARD SUBMISSION
// 9. APP BOOTSTRAP
// ============================================

import { api } from './api.js';
import { supabase } from './supabase-config.js';
import { installPrettyAlerts } from './ui-alerts.js';
import { attachFakePasswordInput, getFakePasswordValue } from './password-mask.js';

// ============================================
// 0. PROFILE PICTURE GRID SETUP
// ============================================

const PFP_BASE_NAMES = Array.from({ length: 41 }, (_, index) => `pfp${index + 1}`);
const PFP_EXTENSIONS = ['gif', 'webp', 'png', 'jpg', 'jpeg'];

const MAX_PFP_UPLOAD_BYTES = 2 * 1024 * 1024;
const ALLOWED_PFP_MIME_TYPES = new Set([
  'image/webp',
  'image/gif',
  'image/png',
  'image/jpeg'
]);

function getLandingWorldId() {
  try {
    return new URLSearchParams(window.location.search).get('world');
  } catch {
    return null;
  }
}

// Returns the safe post-auth destination from ?next=, or '/' as default.
// Rules: same-origin only, path-only (no nested next chains), never /login.
function getPostAuthRedirectTarget() {
  try {
    const raw = new URLSearchParams(window.location.search).get('next') || '';
    if (!raw || raw.length > 256) return '/';

    // Decode once — reject anything that still contains 'next=' after decode
    // (catches doubly-encoded nested next= values).
    let decoded;
    try { decoded = decodeURIComponent(raw); } catch { return '/'; }
    if (/[?&]next=/i.test(decoded)) return '/';

    const parsed = new URL(decoded, window.location.origin);
    if (parsed.origin !== window.location.origin) return '/';

    const path = parsed.pathname || '/';
    // Never send back to /login or legacy html names.
    if (
      path === '/login' ||
      path === '/login.html' ||
      path === '/index.html' ||
      path === '/index'
    ) return '/';

    return path.startsWith('/') ? path : '/';
  } catch {
    return '/';
  }
}

function getPfpValidationError(file) {
  if (!file) return null;

  if (!ALLOWED_PFP_MIME_TYPES.has(file.type)) {
    return 'Profile picture must be webp, gif, png, or jpeg.';
  }

  if (file.size > MAX_PFP_UPLOAD_BYTES) {
    return 'Profile picture must be 2 MB or smaller.';
  }

  return null;
}

function drawImageSafely(ctx, img) {
  try {
    ctx.drawImage(img, 0, 0, 200, 200);
  } catch (e) {
    console.warn('Unable to draw profile picture frame', e);
  }
}

function freezeContainerFrame(container) {
  const img = container.querySelector('img');
  const cvs = container.querySelector('canvas');
  if (img && cvs && img.naturalWidth > 0) {
    const ctx = cvs.getContext('2d');
    if (ctx) drawImageSafely(ctx, img);
    img.classList.remove('pfp-playing');
  }
}

function deselectPFPContainers() {
  pfpContainers.forEach(container => {
    if (container.classList.contains('selected')) {
      freezeContainerFrame(container);
    }
    container.classList.remove('selected');
  });
}

function loadImageProbe(src) {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onload = () => resolve(src);
    probe.onerror = () => reject(new Error(`Image failed to load: ${src}`));
    probe.src = src;
  });
}

async function resolveBuiltInPfpName(baseName) {
  for (const extension of PFP_EXTENSIONS) {
    const candidate = `${baseName}.${extension}`;
    const src = `${import.meta.env.BASE_URL}images/pfps/${candidate}`;

    try {
      await loadImageProbe(src);
      return candidate;
    } catch {
      // Keep trying alternate extensions until one exists.
    }
  }

  return null;
}

async function loadPFPGrid() {
  const pfpGrid = document.getElementById('pfpGrid');
  const resolvedPfpNames = (await Promise.all(
    PFP_BASE_NAMES.map(resolveBuiltInPfpName)
  )).filter(Boolean);

  resolvedPfpNames.forEach(pfpName => {
    const container = document.createElement('div');
    container.className = 'pfp-container';
    container.dataset.pfp = pfpName;

    const src = `${import.meta.env.BASE_URL}images/pfps/${pfpName}`;

    const cvs = document.createElement('canvas');
    cvs.width  = 200;
    cvs.height = 200;
    const ctx  = cvs.getContext('2d');

    const img = document.createElement('img');
    img.src = src;
    img.alt = pfpName;

    const drawFrame = () => {
      drawImageSafely(ctx, img);
    };

    if (img.complete && img.naturalWidth > 0) drawFrame();
    else img.addEventListener('load', drawFrame, { once: true });

    container.addEventListener('mouseenter', () => {
      img.classList.add('pfp-playing');
    });

    container.addEventListener('mouseleave', () => {
      if (!container.classList.contains('selected')) {
        drawFrame();
        img.classList.remove('pfp-playing');
      }
    });

    container.appendChild(cvs);
    container.appendChild(img);
    pfpGrid.appendChild(container);
  });

  if (resolvedPfpNames.length === 0) {
    console.warn('No built-in profile pictures were found in /images/pfps.');
  }

  // Add upload tile at the end of the grid
  const uploadContainer = document.createElement('div');
  uploadContainer.className = 'upload-pfp-container';
  uploadContainer.id = 'uploadPFPButton';
  uploadContainer.innerHTML = '<span>+</span>';
  pfpGrid.appendChild(uploadContainer);
}

// ============================================
// 1. DOM REFERENCES
// ============================================

const loginToggle    = document.getElementById('loginToggle');
const signupToggle   = document.getElementById('signupToggle');
const loginInputs    = document.getElementById('loginInputs');
const signupInputs   = document.getElementById('signupInputs');
const pfpSelection   = document.getElementById('pfpSelection');
const pfpUpload      = document.getElementById('pfpUpload');
const loginUsername  = document.getElementById('loginUsername');
const loginPassword  = document.getElementById('loginPassword');
const signupUsername = document.getElementById('signupUsername');
const signupPassword = document.getElementById('signupPassword');

let pfpContainers  = null;
let uploadPFPButton = null;

// ============================================
// 2. UI STATE
// ============================================

let selectedPFP     = null;
let uploadedPFPFile = null;
let signupInFlight  = false;

// ============================================
// 3. VIEW TOGGLE (LOGIN/SIGNUP)
// ============================================

function setActiveView(view) {
  if (view === 'login') {
    loginToggle.classList.add('active');
    signupToggle.classList.remove('active');
    loginInputs.style.display  = 'flex';
    signupInputs.style.display = 'none';
    pfpSelection.style.display = 'none';
  } else {
    signupToggle.classList.add('active');
    loginToggle.classList.remove('active');
    loginInputs.style.display  = 'none';
    signupInputs.style.display = 'flex';
    pfpSelection.style.display = 'flex';
  }
}

function initializeViews() {
  loginToggle.addEventListener('click',  () => setActiveView('login'));
  signupToggle.addEventListener('click', () => setActiveView('signup'));
  setActiveView('login');
}

// ============================================
// 4. PFP SELECTION AND UPLOAD
// ============================================

function initializePFPSelection() {
  pfpContainers   = document.querySelectorAll('.pfp-container');
  uploadPFPButton = document.getElementById('uploadPFPButton');

  pfpContainers.forEach(container => {
    container.addEventListener('click', function () {
      // Deselect all and freeze the previously selected animated frame
      deselectPFPContainers();
      uploadPFPButton.classList.remove('selected');

      this.classList.add('selected');
      this.querySelector('img')?.classList.add('pfp-playing'); // keep playing when selected
      selectedPFP     = this.dataset.pfp;
      uploadedPFPFile = null;
    });
  });
}

function initializePFPUpload() {
  uploadPFPButton = document.getElementById('uploadPFPButton');

  uploadPFPButton.addEventListener('click', () => pfpUpload.click());

  pfpUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const pfpError = getPfpValidationError(file);
    if (pfpError) {
      alert(pfpError);
      pfpUpload.value = '';
      return;
    }

    // Deselect grid items
    deselectPFPContainers();

    uploadPFPButton.classList.add('selected');
    uploadPFPButton.innerHTML = '<span>✓</span>';
    selectedPFP     = null;
    uploadedPFPFile = file;
  });
}

// ============================================
// 5. FORM VALIDATION
// ============================================

function validateLoginForm() {
  if (!loginUsername.value.trim()) { alert('Please enter a codename'); return false; }
  if (!getFakePasswordValue(loginPassword)) { alert('Please enter a password'); return false; }
  return true;
}

function validateSignupForm() {
  const u = signupUsername.value.trim();
  const password = getFakePasswordValue(signupPassword);
  if (!u || u.length > 12)    { alert('Codename must be 1–12 characters'); return false; }
  if (!password)  { alert('Please enter a password'); return false; }
  if (password.length < 6) { alert('Password must be at least 6 characters'); return false; }
  if (!selectedPFP && !uploadedPFPFile) { alert('Please select or upload a profile picture'); return false; }
  if (uploadedPFPFile) {
    const pfpError = getPfpValidationError(uploadedPFPFile);
    if (pfpError) { alert(pfpError); return false; }
  }
  return true;
}

// ============================================
// 6. LOGIN FLOW
// ============================================

async function handleLogin() {
  if (!validateLoginForm()) return;
  const username = loginUsername.value.trim();
  const password = getFakePasswordValue(loginPassword);

  try {
    const { data, error } = await api.auth.signIn({ username, password });
    if (error) throw new Error(String(error));

    window.location.replace(getPostAuthRedirectTarget());
  } catch (error) {
    console.error('Login error:', error.message);
    alert(`Login failed: ${error.message}`);
  }
}

// ============================================
// 7. SIGNUP FLOW
// ============================================

async function handleSignup() {
  if (signupInFlight) return;
  if (!validateSignupForm()) return;

  signupInFlight = true;
  const username = signupUsername.value.trim();
  const password = getFakePasswordValue(signupPassword);

  // Track created resources so we can roll back partial work on failure.
  let createdUserId = null;
  let insertedUserRow = false;

  const setSignupUIBusy = (busy) => {
    signupToggle.disabled = busy;
    loginToggle.disabled = busy;
    signupUsername.disabled = busy;
    signupPassword.disabled = busy;
    if (pfpUpload) pfpUpload.disabled = busy;
    if (uploadPFPButton) uploadPFPButton.style.pointerEvents = busy ? 'none' : '';
    if (pfpContainers) {
      pfpContainers.forEach(container => {
        container.style.pointerEvents = busy ? 'none' : '';
      });
    }
  };

  const rollbackSignupArtifacts = async () => {
    if (insertedUserRow && createdUserId) {
      // Best-effort: nothing client-side can clean up server rows without an
      // authenticated delete endpoint — log for manual cleanup if needed.
      console.warn('Rollback warning: partial signup for user id', createdUserId);
    }
  };

  try {
    setSignupUIBusy(true);

    // Quick pre-check for a friendlier message (DB unique index is still authoritative).
    const { data: existing, error: lookupErr } = await api.users.getByUsername(username);
    if (lookupErr) {
      // Non-fatal: signup endpoint also validates uniqueness server-side.
      console.warn('Username pre-check unavailable, continuing with signup:', lookupErr);
    }
    if (existing) { alert('Username already taken'); return; }

    // Step 1: create the account first so we have a userId for the pfp filename.
    const { data: signUpData, error: signUpErrMsg } = await api.auth.signUp({
      username,
      password,
      pfp: selectedPFP || null,
    });
    if (signUpErrMsg) {
      const normalizedMessage = String(signUpErrMsg).toLowerCase();
      if (normalizedMessage.includes('already')) {
        throw new Error('Username already taken');
      }
      throw new Error(String(signUpErrMsg));
    }
    if (!signUpData?.user?.id) {
      throw new Error('Signup failed: user account was not created.');
    }

    const userId = signUpData.user.id;
    createdUserId = userId;
    insertedUserRow = true;

    // Step 2: upload custom pfp if provided, then update profile with pfp_url.
    let pfpURL = null;
    if (uploadedPFPFile) {
      const { data: uploadData, error: upErr } = await api.auth.uploadPfp(uploadedPFPFile);
      if (upErr) {
        // Non-fatal: continue signup without the uploaded pfp.
        console.warn('PFP upload failed, continuing without it:', upErr);
      } else {
        pfpURL = uploadData?.url || null;
      }
    }

    // If pfp was uploaded, patch the stored user record with the pfp_url so the
    // rest of the app picks it up immediately after redirect.
    if (pfpURL) {
      const storedUser = JSON.parse(localStorage.getItem('auth_user') || '{}');
      storedUser.pfp_url = pfpURL;
      localStorage.setItem('auth_user', JSON.stringify(storedUser));
    }

    window.location.replace(getPostAuthRedirectTarget());
  } catch (error) {
    await rollbackSignupArtifacts();
    const errorText = error instanceof Error
      ? (error.message || String(error))
      : String(error);
    console.error('Signup error details:', {
      message: errorText,
      raw: error,
    });
    alert(`Signup failed: ${errorText}`);
  } finally {
    setSignupUIBusy(false);
    signupInFlight = false;
  }
}

// ============================================
// 8. KEYBOARD SUBMISSION
// ============================================

function handleEnterKey(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (loginToggle.classList.contains('active')) handleLogin();
  else handleSignup();
}

function initializeFormSubmission() {
  document.querySelectorAll('input').forEach(input => {
    input.addEventListener('keydown', handleEnterKey);
  });
}

function initializePasswordMasking() {
  attachFakePasswordInput(loginPassword);
  attachFakePasswordInput(signupPassword);
}

// ============================================
// 9. APP BOOTSTRAP
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  installPrettyAlerts({ baseUrl: import.meta.env.BASE_URL });

  document.documentElement.style.setProperty(
    '--bg-url',
    `url(${import.meta.env.BASE_URL}images/background.jpg)`
  );

  await loadPFPGrid();
  initializeViews();
  initializePFPSelection();
  initializePFPUpload();
  initializePasswordMasking();
  initializeFormSubmission();

  // If already authenticated, skip the login page entirely.
  supabase.auth.getSession()
    .then(({ data: { session } }) => {
      if (session) {
        window.location.replace(getPostAuthRedirectTarget());
      }
    })
    .catch(() => {
      // Ignore — just show the login form.
    });

});