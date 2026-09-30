// ============================================
// MUSIC.JS FILE MAP
// 0. IMPORTS
// 1. STATE
// 2. AUDIO INSTANCE
// 3. DOM REFERENCES
// 4. HELPERS
// 5. LOAD TRACKS
// 6. RENDER PLAYLIST
// 7. EDIT MODE HELPERS
// 8. PLAYBACK
// 9. BAR POSITION
// 10. UPLOAD
// 11. DELETE
// 12. DOWNLOAD PLAYLIST
// 13. PUBLIC INIT
// ============================================

// ============================================
// 0. IMPORTS
// ============================================
import { supabase } from './supabase-config.js';

// ============================================
// 1. STATE
// ============================================
let tracks       = [];
let currentIndex = -1;
let isPlaying    = false;
let currentUser     = null;
let currentUserData = null;
let barPosition  = localStorage.getItem('musicBarPosition') || 'bottom';
let isShuffled = false;
const LOOP_MODE_OFF = 'off';
const LOOP_MODE_TRACK = 'track';
const LOOP_MODE_PLAYLIST = 'playlist';
let loopMode = LOOP_MODE_PLAYLIST;
let isMusicEditMode = false;
let isMusicInitialized = false;
let scWidget = null;
let scWidgetIframe = null;
let scWidgetReady = false;
let scWidgetReadyPromise = null;
let scWidgetReadyResolver = null;
let scApiLoaded = false;
let scPendingAutoPlay = false;
let scLoadInProgress = null;
let scIframeFallback = null;
let scUsingIframeFallback = false;
let scWidgetLoadFailed = false;
let isUsingSoundCloudWidget = false;
let suppressAudioEnded = false;
let scCurrentDurationMs = 0;
let currentVolume = Number(localStorage.getItem('musicVolume') || '0.8');
let lastNonZeroVolume = 0.8;
let activeWorldId = null;
let activeWorldName = '';
let activeWorldTheme = null;
let canModifyCurrentPlaylist = true;
let supportsWorldScopedPlaylists = true;
let supportsPlaylistOrder = true;
let isTracksLoading = false;
let draggedTrackId = null;
let lastMusicPanelRightClickAt = 0;
let crossfadeInProgress = false;
let nativeOverlapMonitorId = null;
let soundCloudOverlapMonitorId = null;
let crossfadeIntervalId = null;
let crossfadePrimedTrackId = '';
let preloadedNativeTrackId = '';
let autoplayRetryArmed = false;

const MUSIC_DEFAULT_VOLUME = 0.8;
const MUSIC_CROSSFADE_MS = 2200;
const MUSIC_CROSSFADE_OVERLAP_MS = 4200;
const MUSIC_PRELOAD_OVERLAP_MS = 10000;
const MUSIC_OVERLAP_MONITOR_MS = 140;

// ============================================
// 2. AUDIO INSTANCE
// ============================================
const audioPrimary = new Audio();
const audioSecondary = new Audio();
audioPrimary.preload = 'metadata';
audioSecondary.preload = 'metadata';
let activeAudio = audioPrimary;

function getActiveAudio() {
  return activeAudio;
}

function getInactiveAudio() {
  return activeAudio === audioPrimary ? audioSecondary : audioPrimary;
}

// ============================================
// 3. DOM REFERENCES
// ============================================
let musicBar, musicBarPfp, musicBarUsername, musicBarTitle, musicBarArtist, musicBarSep;
let musicPrev, musicPlayPause, musicNext, musicOpenPanel;
let musicPanelOverlay, musicTrackList;
let musicPanelTopControls, musicDownloadPlaylist;
let musicAddTrackBtn, musicSearchBtn;
let musicShuffle, musicLoop;
let musicVolumeWrap, musicVolumeBtn, musicVolumeSlider;
let musicAddInput;

// ============================================
// 4. HELPERS
// ============================================
function getPlaylistTitle() {
  const month = new Date().toLocaleString('default', { month: 'long' }).toLowerCase();
  if (activeWorldName) {
    return `${activeWorldName} ${month} music`;
  }
  return `monkey ${month} music`;
}

function getActivePlaylistScopeLabel() {
  return activeWorldName || 'main';
}

function userCanModifyWorldPlaylist(world) {
  if (!world?.id) return true;
  if (!currentUser?.id) return false;
  if (world.is_public_edit === false) {
    return String(currentUser.id) === String(world.user_id || '');
  }
  return true;
}

function updatePlaylistAccessUi() {
  if (musicAddTrackBtn) {
    musicAddTrackBtn.disabled = !canModifyCurrentPlaylist;
    musicAddTrackBtn.title = canModifyCurrentPlaylist
      ? `add track to ${getActivePlaylistScopeLabel()}`
      : 'you cannot add tracks in this world';
  }

  if (musicSearchBtn) {
    musicSearchBtn.disabled = !canModifyCurrentPlaylist;
    musicSearchBtn.title = canModifyCurrentPlaylist
      ? 'search soundcloud'
      : 'you cannot add tracks in this world';
  }

  if (musicAddInput) {
    musicAddInput.disabled = !canModifyCurrentPlaylist;
    musicAddInput.placeholder = canModifyCurrentPlaylist
      ? 'paste soundcloud link + enter'
      : 'you do not have posting access in this world';
  }
}

function applyMusicWorldTheme() {
  const targets = [
    document.querySelector('.music-panel'),
    document.getElementById('musicPanelOverlay')
  ];

  targets.forEach((el) => {
    if (!el) return;
    el.style.removeProperty('--music-panel-bg');
    el.style.removeProperty('--music-panel-fg');
    el.style.removeProperty('--music-panel-font');
  });

  if (!activeWorldId || !activeWorldTheme) return;

  const bg = String(activeWorldTheme.background_color || activeWorldTheme.ui_color || activeWorldTheme.font_color || '').trim();
  const fg = String(activeWorldTheme.font_color || activeWorldTheme.ui_color || '').trim();
  const font = String(activeWorldTheme.font_family || '').trim();

  targets.forEach((el) => {
    if (!el) return;
    if (bg) el.style.setProperty('--music-panel-bg', bg);
    if (fg) el.style.setProperty('--music-panel-fg', fg);
    if (font) el.style.setProperty('--music-panel-font', font);
  });
}

function setMusicEditMode(enabled) {
  if (enabled && !canModifyCurrentPlaylist) return;
  isMusicEditMode = Boolean(enabled);
  const musicPanel = document.querySelector('.music-panel');
  if (musicPanel) musicPanel.classList.toggle('edit-mode', isMusicEditMode);
  renderTrackList();
  updateBarDisplay();
}

function toggleMusicEditMode() {
  setMusicEditMode(!isMusicEditMode);
}

function handleMusicPanelContextMenu(event) {
  const musicPanel = event.currentTarget;
  if (!musicPanel || event.target?.closest?.('button, input, a, textarea, select')) return;

  event.preventDefault();
  if (!canModifyCurrentPlaylist) return;

  const now = Date.now();
  if (now - lastMusicPanelRightClickAt <= 450) {
    lastMusicPanelRightClickAt = 0;
    toggleMusicEditMode();
    return;
  }
  lastMusicPanelRightClickAt = now;
}

function syncMusicBreadcrumb(isOpen) {
  const crumbs = document.getElementById('worldModeTabs');
  if (!crumbs) return;

  crumbs.querySelectorAll('[data-music-crumb="1"]').forEach((node) => node.remove());
  crumbs.querySelectorAll('[data-music-current-close="1"]').forEach((node) => {
    node.removeEventListener('click', handleCurrentWorldMusicClose);
    node.removeEventListener('keydown', handleCurrentWorldMusicCloseKeydown);
    node.classList.remove('world-mode-breadcrumb-current-music-close');
    node.removeAttribute('data-music-current-close');
    if (node.tagName !== 'BUTTON') {
      node.removeAttribute('role');
      node.removeAttribute('tabindex');
    }
  });

  if (!isOpen) return;

  const currentWorldCrumb = crumbs.querySelector('.world-mode-breadcrumb-current');
  if (currentWorldCrumb) {
    currentWorldCrumb.setAttribute('data-music-current-close', '1');
    currentWorldCrumb.classList.add('world-mode-breadcrumb-current-music-close');
    if (currentWorldCrumb.tagName !== 'BUTTON') {
      currentWorldCrumb.setAttribute('role', 'button');
      currentWorldCrumb.setAttribute('tabindex', '0');
    }
    currentWorldCrumb.addEventListener('click', handleCurrentWorldMusicClose);
    currentWorldCrumb.addEventListener('keydown', handleCurrentWorldMusicCloseKeydown);
  }

  const label = document.createElement('span');
  label.className = 'world-mode-breadcrumb world-mode-breadcrumb-music';
  label.setAttribute('aria-current', 'page');
  label.setAttribute('data-music-crumb', '1');
  label.textContent = 'music';

  crumbs.appendChild(document.createTextNode(' '));
  crumbs.appendChild(label);
}

function handleCurrentWorldMusicClose(event) {
  event.preventDefault();
  event.stopPropagation();
  closeMusicPanel();
}

function handleCurrentWorldMusicCloseKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  handleCurrentWorldMusicClose(event);
}

function setMusicPanelOpen(isOpen) {
  musicPanelOverlay.classList.toggle('open', isOpen);
  musicOpenPanel?.classList.toggle('active', isOpen);
  document.body.classList.toggle('music-panel-open', isOpen);
  if (isOpen) {
    window.dispatchEvent(new CustomEvent('music-panel-open'));
  }
  syncMusicBreadcrumb(isOpen);

  if (!isOpen && isMusicEditMode) {
    void exitMusicEditMode();
  }
}

export function isMusicPanelOpen() {
  return Boolean(musicPanelOverlay?.classList.contains('open'));
}

export function closeMusicPanel() {
  if (!isMusicPanelOpen()) return false;
  setMusicPanelOpen(false);
  return true;
}

function pfpSrcFor(userRow) {
  const fallback = './images/pfps/default.png';
  if (!userRow) return fallback;
  return userRow.pfp_url || (userRow.pfp ? `./images/pfps/${userRow.pfp}` : fallback);
}

function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeSoundCloudUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return String(rawUrl || '').trim();
  }
}

function clampVolume(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return MUSIC_DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, numeric));
}

function getTrackAudioUrl(track) {
  return track?.stream_url || track?.file_url || '';
}

function normalizeTrackMetadata(rawTitle, rawArtist) {
  let title = String(rawTitle || '').trim() || 'Untitled';
  let artist = String(rawArtist || '').trim();

  // oEmbed titles are often "Song by Artist"; split this so UI doesn't duplicate artist.
  const byMatch = title.match(/^(.*)\s+by\s+(.+)$/i);
  if (byMatch) {
    const splitTitle = byMatch[1].trim();
    const splitArtist = byMatch[2].trim();
    const normalizedArtist = artist.toLowerCase();

    if (!artist) {
      title = splitTitle || title;
      artist = splitArtist;
    } else if (normalizedArtist === splitArtist.toLowerCase()) {
      title = splitTitle || title;
    }
  }

  return { title, artist };
}

function getTrackDisplayMeta(track) {
  return normalizeTrackMetadata(track?.title, track?.artist);
}

function getRandomTrackIndexExcept(excludedIndex) {
  if (tracks.length === 0) return -1;
  if (tracks.length === 1) return 0;

  let next = excludedIndex;
  while (next === excludedIndex) {
    next = Math.floor(Math.random() * tracks.length);
  }
  return next;
}

function getNextTrackIndex() {
  if (tracks.length === 0) return -1;

  if (isShuffled) {
    return getRandomTrackIndexExcept(currentIndex);
  }

  const baseIndex = currentIndex < 0 ? 0 : currentIndex + 1;
  if (baseIndex < tracks.length) return baseIndex;

  return loopMode === LOOP_MODE_PLAYLIST ? 0 : -1;
}

function getPreviousTrackIndex() {
  if (tracks.length === 0) return -1;

  if (isShuffled) {
    return getRandomTrackIndexExcept(currentIndex);
  }

  if (currentIndex > 0) return currentIndex - 1;
  return loopMode === LOOP_MODE_PLAYLIST ? tracks.length - 1 : -1;
}

function isCurrentAudioTrackLoaded(track) {
  const trackUrl = getTrackAudioUrl(track);
  if (!trackUrl) return false;

  const player = getActiveAudio();
  const currentSrc = player.currentSrc || player.src || '';
  return currentSrc === trackUrl || currentSrc.includes(trackUrl);
}

function updateVolumeUi() {
  if (musicVolumeSlider) {
    musicVolumeSlider.value = String(Math.round(currentVolume * 100));
  }

  if (musicVolumeBtn) {
    musicVolumeBtn.classList.toggle('active', currentVolume > 0);
  }
}

function setPlaybackVolume(volume, { persist = true } = {}) {
  currentVolume = clampVolume(volume);
  audioPrimary.volume = currentVolume;
  audioSecondary.volume = currentVolume;

  if (currentVolume > 0) {
    lastNonZeroVolume = currentVolume;
  }

  if (scWidget) {
    scWidget.setVolume(Math.round(currentVolume * 100));
  }

  if (persist) {
    localStorage.setItem('musicVolume', String(currentVolume));
  }

  updateVolumeUi();
}

function syncCurrentVolumeToPlayers() {
  audioPrimary.volume = currentVolume;
  audioSecondary.volume = currentVolume;
  if (scWidget) {
    scWidget.setVolume(Math.round(currentVolume * 100));
  }
}

function clearOverlapMonitors() {
  if (nativeOverlapMonitorId) {
    window.clearInterval(nativeOverlapMonitorId);
    nativeOverlapMonitorId = null;
  }
  if (soundCloudOverlapMonitorId) {
    window.clearInterval(soundCloudOverlapMonitorId);
    soundCloudOverlapMonitorId = null;
  }
  crossfadePrimedTrackId = '';
}

function clearPreloadedNativeTrack() {
  preloadedNativeTrackId = '';
  const standby = getInactiveAudio();
  if (!standby || standby === getActiveAudio()) return;
  standby.pause();
  standby.currentTime = 0;
  standby.src = '';
}

function clearSoundCloudIframeFallback() {
  if (scIframeFallback) {
    scIframeFallback.remove();
    scIframeFallback = null;
  }
  scUsingIframeFallback = false;
}

function clearCrossfadeInterval() {
  if (crossfadeIntervalId) {
    window.clearInterval(crossfadeIntervalId);
    crossfadeIntervalId = null;
  }
}

function armAutoplayRetry() {
  if (autoplayRetryArmed) return;
  autoplayRetryArmed = true;

  const resume = async () => {
    if (!autoplayRetryArmed) return;
    if (scLoadInProgress) return;
    autoplayRetryArmed = false;
    if (tracks.length === 0 || currentIndex < 0 || isPlaying) return;
    try {
      await playTrack(currentIndex);
    } catch {
      // Ignore; another user interaction can still trigger play manually.
    }
  };

  const opts = { once: true, passive: true };
  window.addEventListener('pointerdown', resume, opts);
  window.addEventListener('keydown', resume, opts);
  window.addEventListener('touchstart', resume, opts);
}

function getUpcomingTrackIndex() {
  if (tracks.length === 0) return -1;
  const next = getNextTrackIndex();
  return next;
}

function maybePrimeNextNativeTrack() {
  if (isUsingSoundCloudWidget || currentIndex < 0) return;
  if (loopMode === LOOP_MODE_TRACK) return;

  const nextIndex = getUpcomingTrackIndex();
  if (nextIndex < 0 || nextIndex >= tracks.length) return;

  const nextTrack = tracks[nextIndex];
  if (!nextTrack || nextTrack.soundcloud_url) {
    preloadedNativeTrackId = '';
    return;
  }

  const nextTrackId = String(nextTrack.id || nextIndex);
  const nextUrl = getTrackAudioUrl(nextTrack);
  if (!nextUrl) return;

  const standby = getInactiveAudio();
  if (preloadedNativeTrackId === nextTrackId && standby.src && standby.src.includes(nextUrl)) {
    return;
  }

  standby.pause();
  standby.currentTime = 0;
  standby.src = nextUrl;
  standby.preload = 'auto';
  standby.load();
  preloadedNativeTrackId = nextTrackId;
}

function startNativeOverlapMonitor() {
  clearOverlapMonitors();

  if (isUsingSoundCloudWidget || loopMode === LOOP_MODE_TRACK || currentIndex < 0) return;

  nativeOverlapMonitorId = window.setInterval(() => {
    if (isUsingSoundCloudWidget || crossfadeInProgress || !isPlaying) return;
    if (loopMode === LOOP_MODE_TRACK) return;

    const currentTrack = tracks[currentIndex];
    if (!currentTrack || currentTrack.soundcloud_url) return;

    const activePlayer = getActiveAudio();
    if (!activePlayer || activePlayer.paused) return;

    const durationSec = Number(activePlayer.duration || 0);
    const currentSec = Number(activePlayer.currentTime || 0);
    if (!Number.isFinite(durationSec) || durationSec <= 0) return;

    const remainingMs = (durationSec - currentSec) * 1000;
    if (remainingMs <= MUSIC_PRELOAD_OVERLAP_MS && remainingMs > MUSIC_CROSSFADE_OVERLAP_MS) {
      maybePrimeNextNativeTrack();
      return;
    }

    if (remainingMs <= MUSIC_CROSSFADE_OVERLAP_MS && remainingMs > 150) {
      const currentTrackId = String(currentTrack.id || currentIndex);
      if (crossfadePrimedTrackId === currentTrackId) return;
      crossfadePrimedTrackId = currentTrackId;
      void advanceToNextTrack({ fromEnded: false, preferCrossfade: true });
    }
  }, MUSIC_OVERLAP_MONITOR_MS);
}

function startSoundCloudOverlapMonitor() {
  if (!scWidget) return;

  clearOverlapMonitors();

  if (!isUsingSoundCloudWidget || loopMode === LOOP_MODE_TRACK || currentIndex < 0) return;

  soundCloudOverlapMonitorId = window.setInterval(() => {
    if (!isUsingSoundCloudWidget || crossfadeInProgress || !isPlaying) return;
    if (loopMode === LOOP_MODE_TRACK) return;
    if (!scCurrentDurationMs || scCurrentDurationMs <= 0) return;

    const currentTrack = tracks[currentIndex];
    if (!currentTrack || !currentTrack.soundcloud_url) return;

    scWidget.getPosition((positionMs) => {
      const remainingMs = scCurrentDurationMs - (Number(positionMs) || 0);
      if (remainingMs <= MUSIC_CROSSFADE_OVERLAP_MS && remainingMs > 150) {
        const currentTrackId = String(currentTrack.id || currentIndex);
        if (crossfadePrimedTrackId === currentTrackId) return;
        crossfadePrimedTrackId = currentTrackId;
        void advanceToNextTrack({ fromEnded: false, preferCrossfade: false });
      }
    });
  }, Math.max(450, MUSIC_OVERLAP_MONITOR_MS * 2));
}

async function crossfadeToNativeTrack(nextIndex) {
  const currentTrack = tracks[currentIndex];
  const nextTrack = tracks[nextIndex];
  if (!currentTrack || !nextTrack) return false;
  if (currentTrack.soundcloud_url || nextTrack.soundcloud_url) return false;

  const outgoing = getActiveAudio();
  const incoming = getInactiveAudio();
  const nextUrl = getTrackAudioUrl(nextTrack);
  const nextTrackId = String(nextTrack.id || nextIndex);
  if (!nextUrl) return false;

  clearOverlapMonitors();
  clearCrossfadeInterval();

  crossfadeInProgress = true;
  suppressAudioEnded = true;

  try {
    incoming.pause();
    if (!(preloadedNativeTrackId === nextTrackId && incoming.src && incoming.src.includes(nextUrl))) {
      incoming.src = nextUrl;
      incoming.preload = 'auto';
      incoming.load();
    }
    incoming.currentTime = 0;
    incoming.volume = 0;
    await incoming.play();

    const startOut = Math.max(0, Number(outgoing.volume) || currentVolume);
    const startedAt = Date.now();

    await new Promise((resolve) => {
      crossfadeIntervalId = window.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const progress = Math.min(1, elapsed / MUSIC_CROSSFADE_MS);
        const eased = progress * progress * (3 - (2 * progress));

        outgoing.volume = Math.max(0, startOut * (1 - eased));
        incoming.volume = Math.min(currentVolume, currentVolume * eased);

        if (progress >= 1) {
          clearCrossfadeInterval();
          resolve();
        }
      }, 50);
    });

    outgoing.pause();
    outgoing.currentTime = 0;
    outgoing.src = '';

    incoming.volume = currentVolume;
    activeAudio = incoming;
    preloadedNativeTrackId = '';
    currentIndex = nextIndex;
    isUsingSoundCloudWidget = false;
    isPlaying = true;

    updateBarDisplay();
    renderTrackList();
    startNativeOverlapMonitor();
    return true;
  } catch (err) {
    console.error('Crossfade failed, falling back to direct play:', err);
    return false;
  } finally {
    crossfadeInProgress = false;
    suppressAudioEnded = false;
    syncCurrentVolumeToPlayers();
  }
}

function restartCurrentTrack() {
  if (currentIndex < 0 || currentIndex >= tracks.length) return;

  const track = tracks[currentIndex];
  const isCurrentTrackSoundCloud = !!track?.soundcloud_url;

  if (isCurrentTrackSoundCloud && scWidget && isUsingSoundCloudWidget) {
    scWidget.seekTo(0);
    scWidget.play();
    isPlaying = true;
    updateBarDisplay();
    return;
  }

  if (!isCurrentAudioTrackLoaded(track)) {
    playTrack(currentIndex);
    return;
  }

  const player = getActiveAudio();
  player.currentTime = 0;
  player.play()
    .then(() => {
      isPlaying = true;
      updateBarDisplay();
    })
    .catch((err) => {
      console.error('Repeat-one restart failed, reloading track:', err);
      playTrack(currentIndex);
    });
}

async function advanceToNextTrack({ fromEnded = false, preferCrossfade = false } = {}) {
  if (tracks.length === 0) {
    clearOverlapMonitors();
    clearCrossfadeInterval();
    isPlaying = false;
    currentIndex = -1;
    updateBarDisplay();
    return;
  }

  if (fromEnded && loopMode === LOOP_MODE_TRACK && currentIndex >= 0) {
    restartCurrentTrack();
    return;
  }

  const next = getNextTrackIndex();
  if (next === -1) {
    clearOverlapMonitors();
    isPlaying = false;
    currentIndex = -1;
    updateBarDisplay();
    return;
  }

  if (!fromEnded && preferCrossfade) {
    const didCrossfade = await crossfadeToNativeTrack(next);
    if (didCrossfade) return;
  }

  await playTrack(next);
}

function updatePlaybackModeButtons() {
  if (musicShuffle) {
    // Two modes: shuffle or in-order repeat.
    // isShuffled = shuffle mode; otherwise = in-order with playlist repeat
    musicShuffle.title = isShuffled ? 'mode: shuffle' : 'mode: in order (repeat)';
    musicShuffle.setAttribute('aria-label', musicShuffle.title);
    musicShuffle.textContent = isShuffled ? '⇄' : '↺';
    // active state only when shuffled so the icon alone conveys mode
    musicShuffle.classList.toggle('active', isShuffled);
  }
  // musicLoop is hidden — kept in DOM for JS compat only
}

function waitForSoundCloudWidgetReady(timeoutMs = 10000) {
  if (scWidgetReady) return Promise.resolve();
  if (!scWidget) return Promise.reject(new Error('SoundCloud widget instance is unavailable'));

  if (!scWidgetReadyPromise) {
    scWidgetReadyPromise = new Promise((resolve) => {
      scWidgetReadyResolver = resolve;
    });
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('Timed out waiting for SoundCloud widget to become ready'));
    }, timeoutMs);

    scWidgetReadyPromise
      .then(() => {
        window.clearTimeout(timeoutId);
        resolve();
      })
      .catch((err) => {
        window.clearTimeout(timeoutId);
        reject(err);
      });
  });
}

function loadSoundCloudApi() {
  if (scApiLoaded && window.SC?.Widget) return Promise.resolve();
  if (scLoadInProgress) return scLoadInProgress;

  scLoadInProgress = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-soundcloud-widget="1"]');
    if (existing) {
      if (window.SC?.Widget) {
        scApiLoaded = true;
        scLoadInProgress = null;
        resolve();
        return;
      }

      // Always replace stale script nodes when SC.Widget is still missing.
      existing.remove();
    }

    const script = document.createElement('script');
    script.src = `https://w.soundcloud.com/player/api.js?cb=${Date.now()}`;
    script.async = true;
    script.dataset.soundcloudWidget = '1';
    const timeoutId = window.setTimeout(() => {
      script.remove();
      reject(new Error('Timed out while loading SoundCloud Widget API'));
    }, 12000);
    script.onload = () => {
      window.clearTimeout(timeoutId);
      if (window.SC?.Widget) {
        scApiLoaded = true;
        scLoadInProgress = null;
        resolve();
        return;
      }
      scLoadInProgress = null;
      reject(new Error('SoundCloud Widget API loaded but SC.Widget is unavailable'));
    };
    script.onerror = () => {
      window.clearTimeout(timeoutId);
      scLoadInProgress = null;
      reject(new Error('Failed to load SoundCloud Widget API'));
    };
    document.head.appendChild(script);
  });

  return scLoadInProgress;
}

async function ensureSoundCloudWidget() {
  if (scWidget && scWidgetReady) return;

  await loadSoundCloudApi();

  if (!window.SC?.Widget) {
    throw new Error('SoundCloud Widget API unavailable (possibly blocked by browser privacy settings or an extension)');
  }

  if (!scWidgetIframe) {
    const bootstrapTrack = 'https://soundcloud.com/forss/flickermood';
    scWidgetIframe = document.createElement('iframe');
    scWidgetIframe.id = 'musicSoundCloudWidget';
    scWidgetIframe.title = 'SoundCloud widget';
    scWidgetIframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(bootstrapTrack)}`;
    scWidgetIframe.width = '1';
    scWidgetIframe.height = '1';
    scWidgetIframe.allow = 'autoplay; encrypted-media';
    scWidgetIframe.style.position = 'fixed';
    scWidgetIframe.style.left = '-9999px';
    scWidgetIframe.style.top = '-9999px';
    scWidgetIframe.style.border = '0';
    document.body.appendChild(scWidgetIframe);
  }

  if (!scWidget) {
    scWidget = window.SC.Widget(scWidgetIframe);
    scWidgetReady = false;
    scWidgetReadyPromise = new Promise((resolve) => {
      scWidgetReadyResolver = resolve;
    });
    scWidget.bind(window.SC.Widget.Events.READY, () => {
      scWidgetReady = true;
      if (scWidgetReadyResolver) {
        scWidgetReadyResolver();
        scWidgetReadyResolver = null;
      }
      setPlaybackVolume(currentVolume, { persist: false });
      if (scPendingAutoPlay) {
        scPendingAutoPlay = false;
        scWidget.play();
      }
    });
    scWidget.bind(window.SC.Widget.Events.PLAY, () => {
      // SoundCloud can reset widget volume when a new track loads.
      syncCurrentVolumeToPlayers();
      isPlaying = true;
      isUsingSoundCloudWidget = true;
      scWidget.getDuration((ms) => {
        scCurrentDurationMs = Number(ms) || 0;
      });
      startSoundCloudOverlapMonitor();
      updateBarDisplay();
    });
    scWidget.bind(window.SC.Widget.Events.PAUSE, () => {
      clearOverlapMonitors();
      isPlaying = false;
      updateBarDisplay();
    });
    scWidget.bind(window.SC.Widget.Events.FINISH, () => {
      // Many licensed tracks are preview-only on SoundCloud embeds.
      if (scCurrentDurationMs > 0 && scCurrentDurationMs < 30000) {
        alert('This SoundCloud track appears to be preview-only in embeds. Try another link.');
      }
      void advanceToNextTrack({ fromEnded: true });
    });
    scWidget.bind(window.SC.Widget.Events.ERROR, () => {
      isPlaying = false;
      updateBarDisplay();
      alert('SoundCloud could not play this track. Try another link.');
    });
  }

  await waitForSoundCloudWidgetReady();
}

async function playSoundCloudIframeFallback(soundcloudUrl) {
  clearSoundCloudIframeFallback();

  const normalizedUrl = normalizeSoundCloudUrl(soundcloudUrl);
  if (!normalizedUrl) {
    throw new Error('SoundCloud URL is empty after normalization');
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'musicSoundCloudFallbackWidget';
  iframe.title = 'SoundCloud fallback player';
  iframe.width = '1';
  iframe.height = '1';
  iframe.allow = 'autoplay; encrypted-media';
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '-9999px';
  iframe.style.border = '0';
  iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(normalizedUrl)}&auto_play=true&buying=false&sharing=false&download=false&show_artwork=false&show_comments=false&show_playcount=false&show_user=false&visual=false`;
  document.body.appendChild(iframe);

  scIframeFallback = iframe;
  scUsingIframeFallback = true;
}

async function playSoundCloudTrack(soundcloudUrl) {
  if (!soundcloudUrl) throw new Error('Missing SoundCloud URL');
  const normalizedUrl = normalizeSoundCloudUrl(soundcloudUrl);
  if (!normalizedUrl) {
    throw new Error('SoundCloud URL is empty after normalization');
  }

  try {
    const parsed = new URL(normalizedUrl);
    const host = parsed.hostname.toLowerCase();
    const isSoundCloudHost = host === 'soundcloud.com'
      || host.endsWith('.soundcloud.com')
      || host === 'snd.sc';
    if (!isSoundCloudHost) {
      throw new Error('Only SoundCloud links are supported in this playlist');
    }
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('Invalid SoundCloud URL');
  }

  scCurrentDurationMs = 0;

  try {
    await ensureSoundCloudWidget();
    clearSoundCloudIframeFallback();
    scUsingIframeFallback = false;
    scWidgetLoadFailed = false;

    await new Promise((resolve, reject) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve();
      };
      const fail = (err) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(err instanceof Error ? err : new Error(String(err || 'SoundCloud widget load failed')));
      };

      const timeoutId = window.setTimeout(() => {
        fail(new Error('Timed out while loading SoundCloud track in widget'));
      }, 12000);

      try {
        scWidget.load(normalizedUrl, {
          auto_play: true,
          buying: false,
          sharing: false,
          download: false,
          show_artwork: false,
          show_comments: false,
          show_playcount: false,
          show_user: false,
          visual: false,
          callback: done
        });
      } catch (err) {
        fail(err);
      }
    });

    setPlaybackVolume(currentVolume, { persist: false });
    scPendingAutoPlay = false;
    scWidget.play();
    isUsingSoundCloudWidget = true;
    return;
  } catch (err) {
    console.warn('SoundCloud widget path failed, falling back to iframe player:', err);
    scWidgetLoadFailed = true;
    scUsingIframeFallback = true;
    await playSoundCloudIframeFallback(normalizedUrl);
  }
}

function stopAllPlayback() {
  clearOverlapMonitors();
  clearCrossfadeInterval();
  preloadedNativeTrackId = '';
  clearSoundCloudIframeFallback();

  if (isUsingSoundCloudWidget && scWidget) {
    scWidget.pause();
  }
  if (!audioPrimary.paused) {
    audioPrimary.pause();
  }
  if (!audioSecondary.paused) {
    audioSecondary.pause();
  }
}

// ============================================
// 5. LOAD TRACKS
// ============================================
export async function loadTracks(options = {}) {
  const {
    autoplay = false,
    forceRestart = false
  } = options;

  const previousTrackId = tracks[currentIndex]?.id || null;

  isTracksLoading = true;
  renderTrackList();
  updateBarDisplay();

  try {
    let query = supabase
      .from('music_tracks')
      .select('*')
      .eq('group_id', 'group0');

    if (supportsPlaylistOrder) {
      query = query.order('playlist_order', { ascending: true });
    }
    query = query.order('created_at', { ascending: true });

    if (supportsWorldScopedPlaylists) {
      if (activeWorldId) {
        query = query.eq('world_id', activeWorldId);
      } else {
        query = query.is('world_id', null);
      }
    }

    const { data, error } = await query;

    if (error && /playlist_order|column/i.test(String(error.message || ''))) {
      supportsPlaylistOrder = false;
      return loadTracks(options);
    }

    if (error && /world_id|column/i.test(String(error.message || ''))) {
      // Backward-compat: fallback to legacy global playlist if migration is not applied yet.
      supportsWorldScopedPlaylists = false;
      let fallback = supabase
        .from('music_tracks')
        .select('*')
        .eq('group_id', 'group0');

      if (supportsPlaylistOrder) {
        fallback = fallback.order('playlist_order', { ascending: true });
      }
      fallback = await fallback.order('created_at', { ascending: true });

      if (fallback.error && /playlist_order|column/i.test(String(fallback.error.message || ''))) {
        supportsPlaylistOrder = false;
        return loadTracks(options);
      }

      if (fallback.error) {
        console.error('Failed to load tracks:', fallback.error);
        return;
      }

      return loadTracksFromRows(fallback.data || [], {
        autoplay,
        forceRestart,
        previousTrackId
      });
    }

    if (error) {
      console.error('Failed to load tracks:', error);
      return;
    }

    await loadTracksFromRows(data || [], {
      autoplay,
      forceRestart,
      previousTrackId
    });
  } finally {
    isTracksLoading = false;
    renderTrackList();
    updateBarDisplay();
  }
}

async function loadTracksFromRows(rows, options = {}) {
  const {
    autoplay = false,
    forceRestart = false,
    previousTrackId = null
  } = options;

  const userIds = [...new Set((rows || []).map(t => t.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, username, pfp, pfp_url')
      .in('id', userIds);
    (users || []).forEach(u => { userMap[u.id] = u; });
  }

  tracks = (rows || []).map(t => ({ ...t, users: userMap[t.user_id] || null }));

  const previousIndexInNextList = previousTrackId
    ? tracks.findIndex((t) => String(t.id || '') === String(previousTrackId))
    : -1;

  if (tracks.length === 0) {
    stopAllPlayback();
    audioPrimary.src = '';
    audioSecondary.src = '';
    isUsingSoundCloudWidget = false;
    isPlaying = false;
    currentIndex = -1;
  } else if (previousIndexInNextList >= 0) {
    currentIndex = previousIndexInNextList;
  } else if (currentIndex < 0 || currentIndex >= tracks.length) {
    currentIndex = 0;
  }

  if (autoplay && tracks.length > 0 && currentIndex >= 0) {
    const nextTrackId = tracks[currentIndex]?.id || null;
    const shouldStart = forceRestart || !isPlaying || String(previousTrackId || '') !== String(nextTrackId || '');
    if (shouldStart) {
      try {
        await playTrack(currentIndex);
      } catch {
        armAutoplayRetry();
      }
    }
  }

  updatePlaylistAccessUi();
  renderTrackList();
  updateBarDisplay();
}

// ============================================
// 6. RENDER PLAYLIST
// ============================================
function renderTrackList() {
  if (!musicTrackList) return;
  musicTrackList.innerHTML = '';

  if (isTracksLoading) {
    return;
  }

  const visibleTracks = tracks;

  if (visibleTracks.length === 0) {
    musicTrackList.innerHTML = `<div class="music-empty">${
      isMusicEditMode
        ? (canModifyCurrentPlaylist ? 'no tracks to edit' : 'you cannot edit this world playlist')
        : 'no tracks yet - add a soundcloud link above'
    }</div>`;
    return;
  }

  visibleTracks.forEach((track) => {
    const idx      = tracks.indexOf(track);
    const isActive = idx === currentIndex;
    const displayMeta = getTrackDisplayMeta(track);
    const posterName = track.users?.username || '—';
    const songLabel = displayMeta.artist
      ? `${escAttr(displayMeta.title)} / ${escAttr(displayMeta.artist)}`
      : escAttr(displayMeta.title);

    const row = document.createElement('div');
    row.className   = `music-track-row${isActive ? ' active' : ''}${isMusicEditMode ? ' edit-mode' : ''}`;
    row.dataset.idx     = idx;
    row.dataset.trackId = track.id;

    if (isMusicEditMode) {
      const canDeleteTrack = String(track.user_id || '') === String(currentUser?.id || '');
      row.draggable = canModifyCurrentPlaylist;
      row.innerHTML = `
        <div class="music-track-meta-left">
          <span class="music-track-drag-handle" aria-hidden="true">↕</span>
          <span class="music-track-song" style="opacity:0.7;">${songLabel}</span>
        </div>
        <div class="music-track-right">
          ${canDeleteTrack ? '<button class="music-track-btn music-delete-btn" aria-label="delete track">x</button>' : ''}
        </div>
      `;

      row.addEventListener('dragstart', handleTrackDragStart);
      row.addEventListener('dragover', handleTrackDragOver);
      row.addEventListener('dragleave', handleTrackDragLeave);
      row.addEventListener('drop', handleTrackDrop);
      row.addEventListener('dragend', handleTrackDragEnd);

      row.querySelector('.music-delete-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTrack(track.id, idx);
      });

      // Row click in edit mode does nothing
      row.addEventListener('click', e => e.stopPropagation());

    } else {
      // ── Normal row: pfp + title/artist, click to play ──
      row.innerHTML = `
        <div class="music-track-meta-left">
          <span class="music-track-song" style="opacity:0.7;">${songLabel}</span>
        </div>
        <div class="music-track-right">
          <img class="music-track-pfp" src="${pfpSrcFor(track.users)}" alt="">
          <span class="music-track-poster" style="opacity:0.7;">${escAttr(posterName)}</span>
        </div>
      `;

      row.addEventListener('click', () => playTrack(idx));
    }

    musicTrackList.appendChild(row);
  });
}

function getTrackIndexById(trackId) {
  return tracks.findIndex((track) => String(track.id || '') === String(trackId || ''));
}

function getDropIndexFromRow(row, clientY) {
  const targetIndex = Number(row?.dataset?.idx);
  if (!Number.isInteger(targetIndex)) return -1;
  const rect = row.getBoundingClientRect();
  return clientY > rect.top + rect.height / 2 ? targetIndex + 1 : targetIndex;
}

function clearTrackDropClasses() {
  musicTrackList?.querySelectorAll('.music-track-row.dragging, .music-track-row.drop-before, .music-track-row.drop-after').forEach((row) => {
    row.classList.remove('dragging', 'drop-before', 'drop-after');
  });
}

function handleTrackDragStart(event) {
  if (!isMusicEditMode || !canModifyCurrentPlaylist) return;
  draggedTrackId = event.currentTarget?.dataset?.trackId || null;
  if (!draggedTrackId) return;
  event.currentTarget.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggedTrackId);
}

function handleTrackDragOver(event) {
  if (!draggedTrackId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';

  const row = event.currentTarget;
  const rect = row.getBoundingClientRect();
  const isAfter = event.clientY > rect.top + rect.height / 2;
  row.classList.toggle('drop-before', !isAfter);
  row.classList.toggle('drop-after', isAfter);
}

function handleTrackDragLeave(event) {
  event.currentTarget.classList.remove('drop-before', 'drop-after');
}

async function handleTrackDrop(event) {
  if (!draggedTrackId) return;
  event.preventDefault();

  const sourceIndex = getTrackIndexById(draggedTrackId);
  let targetIndex = getDropIndexFromRow(event.currentTarget, event.clientY);
  clearTrackDropClasses();

  if (sourceIndex < 0 || targetIndex < 0) return;
  if (targetIndex > sourceIndex) targetIndex -= 1;
  if (targetIndex === sourceIndex) return;

  await reorderTrack(sourceIndex, targetIndex);
}

function handleTrackDragEnd() {
  draggedTrackId = null;
  clearTrackDropClasses();
}

async function reorderTrack(sourceIndex, targetIndex) {
  if (!canModifyCurrentPlaylist) return;
  if (sourceIndex < 0 || sourceIndex >= tracks.length) return;
  const clampedTarget = Math.max(0, Math.min(targetIndex, tracks.length - 1));
  if (sourceIndex === clampedTarget) return;

  const activeTrackId = tracks[currentIndex]?.id || null;
  const [movedTrack] = tracks.splice(sourceIndex, 1);
  tracks.splice(clampedTarget, 0, movedTrack);
  currentIndex = activeTrackId ? getTrackIndexById(activeTrackId) : currentIndex;
  renderTrackList();
  updateBarDisplay();

  const persistError = await persistPlaylistOrder();
  if (persistError) {
    alert(`Reorder failed: ${persistError}`);
    await loadTracks();
  }
}

async function persistPlaylistOrder() {
  if (!supportsPlaylistOrder) {
    return 'playlist_order column is missing. Run the latest music_tracks migration first.';
  }

  for (let idx = 0; idx < tracks.length; idx += 1) {
    const track = tracks[idx];
    const { error } = await supabase
      .from('music_tracks')
      .update({ playlist_order: idx })
      .eq('id', track.id);

    if (error) {
      if (/playlist_order|column/i.test(String(error.message || ''))) {
        supportsPlaylistOrder = false;
      }
      return error.message || String(error);
    }
  }

  return null;
}

// ============================================
// 7. EDIT MODE HELPERS
// ============================================
// Exit edit mode - no longer renames tracks (delete only)
async function exitMusicEditMode() {
  setMusicEditMode(false);
}

// ============================================
// 8. PLAYBACK
// ============================================
async function playTrack(idx) {
  if (idx < 0 || idx >= tracks.length) return;
  currentIndex = idx;
  const track = tracks[idx];
  clearPreloadedNativeTrack();
  suppressAudioEnded = true;
  stopAllPlayback();
  suppressAudioEnded = false;

  if (track.soundcloud_url) {
    try {
      audioPrimary.pause();
      audioSecondary.pause();
      audioPrimary.src = '';
      audioSecondary.src = '';
      await playSoundCloudTrack(track.soundcloud_url);
      isUsingSoundCloudWidget = false;
      isPlaying = true;
      startSoundCloudOverlapMonitor();
    } catch (err) {
      console.error('SoundCloud playback error:', err);
      isUsingSoundCloudWidget = false;
      isPlaying = false;
      armAutoplayRetry();
      const details = err instanceof Error ? err.message : String(err || 'unknown error');
      alert(`Could not start SoundCloud playback.\n${details}`);
    }
  } else if (track.stream_url || track.file_url) {
    isUsingSoundCloudWidget = false;
    scWidgetLoadFailed = false;
    activeAudio = getActiveAudio() || audioPrimary;
    const player = getActiveAudio();
    const standby = getInactiveAudio();
    standby.pause();
    standby.currentTime = 0;
    standby.src = '';

    player.src = getTrackAudioUrl(track);
    player.preload = 'auto';
    setPlaybackVolume(currentVolume, { persist: false });
    try {
      await player.play();
      isPlaying = true;
      startNativeOverlapMonitor();
    } catch (err) {
      console.error(err);
      isPlaying = false;
      armAutoplayRetry();
      updateBarDisplay();
    }
  } else {
    isPlaying = false;
  }

  updateBarDisplay();
  renderTrackList();
}

function updateBarDisplay() {
  if (!musicBarTitle) return;

  if (isTracksLoading) {
    musicBarTitle.textContent = '';
    musicBarArtist.textContent = '';
    musicBarSep.style.display = 'none';
    musicBarUsername.textContent = '';
    musicPlayPause.dataset.state = isPlaying ? 'pause' : 'play';
    return;
  }

  const track = tracks[currentIndex];

  if (track) {
    const displayMeta = getTrackDisplayMeta(track);
    musicBarTitle.textContent    = displayMeta.title;
    musicBarArtist.textContent   = displayMeta.artist;
    musicBarSep.style.display    = 'inline';
    musicBarPfp.src              = pfpSrcFor(track.users);
    musicBarUsername.textContent = track.users?.username || '—';
    musicBarUsername.dataset.userId = track.user_id || '';
  } else {
    musicBarTitle.textContent    = '';
    musicBarArtist.textContent   = '';
    musicBarSep.style.display    = 'none';
    musicBarPfp.src              = './images/pfps/default.png';
    musicBarUsername.textContent = '';
  }

  musicPlayPause.dataset.state = isPlaying ? 'pause' : 'play';
}

// ============================================
// 9. BAR POSITION
// ============================================
function applyBarPosition() {
  const BAR_H = '44px';
  if (barPosition === 'top') {
    musicBar.style.top           = '0';
    musicBar.style.bottom        = 'auto';
    document.body.style.paddingTop    = BAR_H;
    document.body.style.paddingBottom = '';
  } else {
    musicBar.style.bottom        = '0';
    musicBar.style.top           = 'auto';
    document.body.style.paddingBottom = BAR_H;
    document.body.style.paddingTop    = '';
  }
}

// ============================================
// 10. SOUNDCLOUD URL HANDLER
// ============================================
async function addSoundCloudTrack(soundcloudUrl) {
  if (!canModifyCurrentPlaylist) {
    alert('You do not have permission to add tracks in this world.');
    return;
  }

  const url = soundcloudUrl.trim();
  if (!url) { alert('Please enter a SoundCloud URL'); return; }
  const normalizedUrl = normalizeSoundCloudUrl(url);

  const btn = document.getElementById('musicDownloadPlaylist');
  btn.disabled = true;

  try {
    // Fetch metadata from SoundCloud oEmbed (no API key required)
    const oembed = new URL('https://soundcloud.com/oembed');
    oembed.searchParams.set('format', 'json');
    oembed.searchParams.set('url', normalizedUrl);

    const oembedResp = await fetch(oembed.toString());
    if (!oembedResp.ok) throw new Error(`oEmbed failed: ${oembedResp.status}`);
    const oembedData = await oembedResp.json();

    const parsed = normalizeTrackMetadata(oembedData.title, oembedData.author_name || 'Unknown Artist');
    const title = parsed.title;
    const artist = parsed.artist;
    const thumbnail = oembedData.thumbnail_url || '';

    // Insert into Supabase (no stream_url - SoundCloud opens in new window)
    const baseInsertPayload = {
      group_id: 'group0',
      user_id: currentUser.id,
      title,
      artist,
      soundcloud_url: normalizedUrl,
      thumbnail_url: thumbnail
    };

    let insertPayload = { ...baseInsertPayload };

    if (supportsWorldScopedPlaylists) {
      insertPayload.world_id = activeWorldId;
    }
    if (supportsPlaylistOrder) {
      insertPayload.playlist_order = tracks.length;
    }

    let { error: dbErr } = await supabase
      .from('music_tracks')
      .insert([insertPayload]);

    if (dbErr && /playlist_order|column/i.test(String(dbErr.message || ''))) {
      supportsPlaylistOrder = false;
      const fallbackOrder = { ...insertPayload };
      delete fallbackOrder.playlist_order;
      ({ error: dbErr } = await supabase.from('music_tracks').insert([fallbackOrder]));
    }

    if (dbErr && /world_id|column/i.test(String(dbErr.message || ''))) {
      supportsWorldScopedPlaylists = false;
      const fallbackWorld = { ...insertPayload };
      delete fallbackWorld.world_id;
      delete fallbackWorld.playlist_order;
      ({ error: dbErr } = await supabase.from('music_tracks').insert([fallbackWorld]));
    }

    if (dbErr) throw dbErr;

    const urlInput = document.querySelector('input[placeholder="paste soundcloud link + enter"]');
    if (urlInput) urlInput.value = '';
    await loadTracks();
  } catch (error) {
    console.error('SoundCloud add error:', error);
    alert(`Failed to add track: ${error.message || error}`);
  } finally {
    btn.disabled = false;
  }
}



// ============================================
// 11. DELETE
// ============================================
async function deleteTrack(trackId, idx) {
  if (!canModifyCurrentPlaylist) {
    alert('You do not have permission to edit this world playlist.');
    return;
  }

  const { error } = await supabase
    .from('music_tracks')
    .delete()
    .eq('id', trackId)
    .eq('user_id', currentUser.id);

  if (error) { alert(`Delete failed: ${error.message}`); return; }

  if (idx === currentIndex) {
    stopAllPlayback();
    audioPrimary.src = '';
    audioSecondary.src = '';
    isPlaying    = false;
    isUsingSoundCloudWidget = false;
    currentIndex = -1;
    updateBarDisplay();
  } else if (idx < currentIndex) {
    currentIndex--;
  }

  await loadTracks();
}

// ============================================
// 12. DOWNLOAD PLAYLIST AS CSV
// ============================================
async function downloadPlaylistAsCSV() {
  if (tracks.length === 0) { alert('No tracks to download'); return; }

  const btn = document.getElementById('musicDownloadPlaylist');
  const title = getPlaylistTitle();

  try {
    btn.textContent = '… exporting';
    btn.disabled = true;

    // Build CSV with BOM for Excel compatibility
    const BOM = '\uFEFF';
    const headers = ['title', 'artist', 'soundcloud_url', 'thumbnail'];
    let csv = BOM + headers.join(',') + '\n';

    for (const track of tracks) {
      const row = [
        `"${(track.title || '').replace(/"/g, '""')}"`,
        `"${(track.artist || '').replace(/"/g, '""')}"`,
        `"${(track.soundcloud_url || '').replace(/"/g, '""')}"`,
        `"${(track.thumbnail_url || '').replace(/"/g, '""')}"`
      ].join(',');
      csv += row + '\n';
    }

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);

    alert(`Playlist exported: ${tracks.length} tracks.`);
  } catch (err) {
    console.error('CSV export error:', err);
    alert(`Export failed: ${err.message || err}`);
  } finally {
    btn.textContent = 'download csv';
    btn.disabled = false;
  }
}

// ============================================
// 13. PUBLIC INIT
// ============================================
export async function initMusic(user, userData, options = {}) {
  const {
    autoplay = true
  } = options;

  currentUser     = user;
  currentUserData = userData;

  if (isMusicInitialized) {
    await loadTracks({ autoplay, forceRestart: false });
    return;
  }

  musicBar              = document.getElementById('musicBar');
  musicBarPfp           = document.getElementById('musicBarPfp');
  musicBarUsername      = document.getElementById('musicBarUsername');
  musicBarTitle         = document.getElementById('musicBarTitle');
  musicBarArtist        = document.getElementById('musicBarArtist');
  musicBarSep           = document.getElementById('musicBarSep');
  musicPrev             = document.getElementById('musicPrev');
  musicPlayPause        = document.getElementById('musicPlayPause');
  musicNext             = document.getElementById('musicNext');
  musicOpenPanel        = document.getElementById('musicOpenPanel');
  musicPanelOverlay     = document.getElementById('musicPanelOverlay');
  musicPanelTopControls = document.getElementById('musicPanelTopControls');
  musicTrackList        = document.getElementById('musicTrackList');
  musicAddTrackBtn      = document.getElementById('musicAddTrackBtn');
  musicDownloadPlaylist = document.getElementById('musicDownloadPlaylist');
  musicSearchBtn        = document.getElementById('musicSearchBtn');
  musicShuffle = document.getElementById('musicShuffle');
  musicLoop    = document.getElementById('musicLoop');
  const musicPanel = document.querySelector('.music-panel');

  const requiredNodes = [
    musicBar,
    musicBarPfp,
    musicBarUsername,
    musicBarTitle,
    musicBarArtist,
    musicBarSep,
    musicPrev,
    musicPlayPause,
    musicNext,
    musicOpenPanel,
    musicPanelOverlay,
    musicPanelTopControls,
    musicTrackList,
    musicAddTrackBtn,
    musicDownloadPlaylist,
    musicSearchBtn,
    musicShuffle,
    musicLoop,
    musicPanel
  ];

  if (requiredNodes.some((node) => !node)) {
    console.error('Music UI initialization failed: missing required DOM elements.');
    return;
  }

  isMusicInitialized = true;
  applyBarPosition();

  currentVolume = clampVolume(currentVolume);
  if (currentVolume > 0) {
    lastNonZeroVolume = currentVolume;
  }
  setPlaybackVolume(currentVolume, { persist: false });

  musicVolumeWrap = document.createElement('div');
  musicVolumeWrap.className = 'music-volume-wrap';

  musicVolumeBtn = document.createElement('button');
  musicVolumeBtn.className = 'music-ctrl-btn music-volume-btn';
  musicVolumeBtn.type = 'button';
  musicVolumeBtn.innerHTML = '<span class="ui-icon icon-music-mode" aria-hidden="true"></span>';

  musicVolumeSlider = document.createElement('input');
  musicVolumeSlider.className = 'music-volume-slider';
  musicVolumeSlider.type = 'range';
  musicVolumeSlider.min = '0';
  musicVolumeSlider.max = '100';
  musicVolumeSlider.step = '1';

  musicVolumeWrap.appendChild(musicVolumeBtn);
  musicVolumeWrap.appendChild(musicVolumeSlider);
  const musicBarRightZone = musicBar.querySelector('.music-bar-zone-right');
  (musicBarRightZone || musicBar).insertBefore(musicVolumeWrap, musicLoop || null);

  updateVolumeUi();
  updatePlaybackModeButtons();

  musicVolumeSlider.addEventListener('input', (e) => {
    const nextVolume = Number(e.target.value) / 100;
    setPlaybackVolume(nextVolume);
  });

  musicVolumeBtn.addEventListener('click', () => {
    if (currentVolume === 0) {
      setPlaybackVolume(lastNonZeroVolume || MUSIC_DEFAULT_VOLUME);
    } else {
      setPlaybackVolume(0);
    }
  });

  // ── Audio events ──
  [audioPrimary, audioSecondary].forEach((player) => {
    player.addEventListener('ended', () => {
      if (suppressAudioEnded || crossfadeInProgress) return;
      if (isUsingSoundCloudWidget) return;
      if (player !== getActiveAudio()) return;
      void advanceToNextTrack({ fromEnded: true });
    });

    player.addEventListener('play', () => {
      if (player !== getActiveAudio()) return;
      syncCurrentVolumeToPlayers();
      isPlaying = true;
      updateBarDisplay();
      if (!isUsingSoundCloudWidget) {
        startNativeOverlapMonitor();
      }
    });

    player.addEventListener('pause', () => {
      if (player !== getActiveAudio()) return;
      if (crossfadeInProgress) return;
      isPlaying = false;
      clearOverlapMonitors();
      updateBarDisplay();
    });
  });

  // ── Controls ──
  musicPrev.addEventListener('click', () => {
    const prev = getPreviousTrackIndex();
    if (prev !== -1) playTrack(prev);
  });
  musicNext.addEventListener('click', () => {
    const next = getNextTrackIndex();
    if (next !== -1) playTrack(next);
  });
  musicPlayPause.addEventListener('click', () => {
    if (tracks.length === 0) return;
    if (currentIndex === -1) {
      playTrack(0);
      return;
    }

    const currentTrack = tracks[currentIndex];
    const isCurrentTrackSoundCloud = !!currentTrack?.soundcloud_url;

    if (isPlaying) {
      if (isCurrentTrackSoundCloud && scUsingIframeFallback) {
        clearSoundCloudIframeFallback();
        clearOverlapMonitors();
        isPlaying = false;
        updateBarDisplay();
      } else if (isCurrentTrackSoundCloud && scWidget) {
        scWidget.pause();
      } else {
        getActiveAudio().pause();
      }
      return;
    }

    if (isCurrentTrackSoundCloud) {
      playTrack(currentIndex);
      return;
    }

    if (!isCurrentAudioTrackLoaded(currentTrack)) {
      playTrack(currentIndex);
      return;
    }

    getActiveAudio().play().catch((err) => {
      console.error(err);
      isPlaying = false;
      updateBarDisplay();
    });
  });

  musicOpenPanel.addEventListener('click', () => {
    if (musicPanelOverlay.classList.contains('open')) {
      setMusicPanelOpen(false);
    } else {
      setMusicPanelOpen(true);
    }
  });
  musicPanelOverlay.addEventListener('click', (e) => {
    if (e.target === musicPanelOverlay) {
      setMusicPanelOpen(false);
    }
  });
  musicPanel.addEventListener('contextmenu', handleMusicPanelContextMenu);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && musicPanelOverlay.classList.contains('open')) {
      setMusicPanelOpen(false);
    }
  });

  musicDownloadPlaylist.addEventListener('click', downloadPlaylistAsCSV);

  // ── SoundCloud quick controls ──
  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'music-link-inline-input';
  addInput.placeholder = 'paste soundcloud link + enter';
  musicAddInput = addInput;
  musicPanelTopControls.insertBefore(addInput, musicSearchBtn);

  function showAddInput() {
    if (!canModifyCurrentPlaylist) return;
    musicPanelTopControls.classList.add('is-adding');
    addInput.focus();
  }

  function hideAddInput() {
    addInput.value = '';
    musicPanelTopControls.classList.remove('is-adding');
  }

  musicAddTrackBtn.addEventListener('click', () => {
    showAddInput();
  });

  addInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = addInput.value.trim();
      if (!value) return;
      await addSoundCloudTrack(value);
      hideAddInput();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      hideAddInput();
    }
  });

  addInput.addEventListener('blur', () => {
    if (!addInput.value.trim()) {
      hideAddInput();
    }
  });

  musicSearchBtn.addEventListener('click', () => {
    if (!canModifyCurrentPlaylist) return;
    const query = musicPanelTopControls.classList.contains('is-adding')
      ? (addInput.value.trim() || 'music')
      : 'music';
    window.open(`https://soundcloud.com/search?q=${encodeURIComponent(query)}`, '_blank');
  });

  musicShuffle.addEventListener('click', () => {
    // Toggle between in-order-repeat and shuffle
    isShuffled = !isShuffled;
    // In-order mode always repeats the playlist; shuffle mode also loops
    loopMode = LOOP_MODE_PLAYLIST;
    updatePlaybackModeButtons();
  });

  // musicLoop click retained for compat but does nothing visible
  musicLoop.addEventListener('click', () => {});

  updatePlaylistAccessUi();
  await loadTracks({ autoplay, forceRestart: true });
}

export async function setMusicWorldContext(world = null, options = {}) {
  const {
    autoplay = true,
    forceRestart = true
  } = options;

  const nextWorldId = world?.id ? String(world.id) : null;
  const nextWorldName = world?.name ? String(world.name).trim() : '';
  const nextCanModify = userCanModifyWorldPlaylist(world);

  const hasScopeChanged = String(activeWorldId || '') !== String(nextWorldId || '');
  const hasNameChanged = activeWorldName !== nextWorldName;
  const hasPermissionChanged = canModifyCurrentPlaylist !== nextCanModify;

  activeWorldId = nextWorldId;
  activeWorldName = nextWorldName;
  activeWorldTheme = world || null;
  canModifyCurrentPlaylist = nextCanModify;
  applyMusicWorldTheme();

  if (!isMusicInitialized) {
    return;
  }

  if (!hasScopeChanged && !hasNameChanged && !hasPermissionChanged) {
    return;
  }

  await loadTracks({
    autoplay: autoplay && hasScopeChanged,
    forceRestart
  });
}

