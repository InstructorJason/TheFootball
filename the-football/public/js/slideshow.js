/* ============================================================
   Slideshow / Kiosk mode
   ============================================================ */

let items = [];
let currentIndex = 0;
let isPlaying = true;
let timerInterval = null;
let timerStart = null;
let timerDuration = 5000;
let videoPlaybackLimit = 0;
let rafId = null;
let elapsed = 0;

const RING_CIRCUMFERENCE = 2 * Math.PI * 19; // r=19

// DOM refs (set after DOMContentLoaded)
let app, mediaContainer, loadingMsg, slideCounter, slideSiteName;
let prevBtn, nextBtn, playPauseBtn, playPauseIcon;
let ringFg, speedSelect, fullscreenBtn;

// ============================================================
// Init
// ============================================================
async function initSlideshow() {
  app = document.getElementById('app');
  mediaContainer = document.getElementById('mediaContainer');
  loadingMsg = document.getElementById('loadingMsg');
  slideCounter = document.getElementById('slideCounter');
  slideSiteName = document.getElementById('slideSiteName');
  prevBtn = document.getElementById('prevBtn');
  nextBtn = document.getElementById('nextBtn');
  playPauseBtn = document.getElementById('playPauseBtn');
  playPauseIcon = document.getElementById('playPauseIcon');
  ringFg = document.getElementById('ringFg');
  speedSelect = document.getElementById('speedSelect');
  fullscreenBtn = document.getElementById('fullscreenBtn');

  // Load settings
  try {
    const settings = await api('/api/gallery/settings/public');
    videoPlaybackLimit = parseInt(settings.video_playback_limit) || 0;
    timerDuration = parseInt(settings.slideshow_interval) || 5000;
    if (settings.site_name) slideSiteName.textContent = settings.site_name;

    // Set speed select
    const closest = [...speedSelect.options].reduce((prev, opt) => {
      return Math.abs(parseInt(opt.value) - timerDuration) < Math.abs(parseInt(prev.value) - timerDuration)
        ? opt : prev;
    });
    closest.selected = true;
    timerDuration = parseInt(speedSelect.value);
  } catch { /* use defaults */ }

  // Load media
  try {
    const data = await api('/api/gallery?limit=500');
    items = data.items || [];
  } catch (err) {
    mediaContainer.innerHTML = `<div id="loadingMsg" style="color:rgba(255,255,255,0.4)">Failed to load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  if (items.length === 0) {
    mediaContainer.innerHTML = `<div id="loadingMsg" style="color:rgba(255,255,255,0.4);text-align:center">
      <div style="font-size:3rem;margin-bottom:12px">📷</div>
      No approved media yet.
    </div>`;
    return;
  }

  // Wire up controls
  prevBtn.addEventListener('click', () => navigate(-1, true));
  nextBtn.addEventListener('click', () => navigate(1, true));
  playPauseBtn.addEventListener('click', togglePlayPause);
  speedSelect.addEventListener('change', () => {
    timerDuration = parseInt(speedSelect.value);
    if (isPlaying) restartTimer();
  });
  fullscreenBtn.addEventListener('click', toggleFullscreen);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') navigate(-1, true);
    if (e.key === 'ArrowRight') navigate(1, true);
    if (e.key === ' ') { e.preventDefault(); togglePlayPause(); }
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  });

  // Touch swipe
  let touchX = 0;
  app.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  app.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 60) navigate(dx < 0 ? 1 : -1, true);
  }, { passive: true });

  // Show controls briefly on load
  app.classList.add('show-controls');
  setTimeout(() => app.classList.remove('show-controls'), 3000);

  showSlide(0);
  startTimer();
}

// ============================================================
// Navigation
// ============================================================
function navigate(dir, manual = false) {
  const newIndex = (currentIndex + dir + items.length) % items.length;
  goToSlide(newIndex, manual);
}

function goToSlide(index, manual = false) {
  // Stop current video if any
  stopCurrentMedia();

  currentIndex = index;

  if (manual && isPlaying) restartTimer();

  showSlide(currentIndex);
}

function showSlide(index) {
  const item = items[index];
  const total = items.length;

  slideCounter.textContent = `${index + 1} / ${total}`;
  prevBtn.classList.toggle('disabled', total <= 1);
  nextBtn.classList.toggle('disabled', total <= 1);

  // Fade transition
  mediaContainer.style.opacity = '0';
  mediaContainer.style.transition = 'opacity 0.3s ease';

  setTimeout(() => {
    renderMedia(item);
    mediaContainer.style.opacity = '1';
  }, 150);
}

function renderMedia(item) {
  if (isVideo(item.mimetype)) {
    const vid = document.createElement('video');
    vid.src = `/api/gallery/${item.id}/file`;
    vid.autoplay = true;
    vid.controls = false;
    vid.playsInline = true;
    vid.muted = false;
    vid.style.maxWidth = '100%';
    vid.style.maxHeight = '100%';
    vid.style.objectFit = 'contain';

    // When video ends, advance
    vid.addEventListener('ended', () => {
      if (isPlaying) navigate(1);
    });

    // Apply playback limit
    if (videoPlaybackLimit > 0) {
      vid.addEventListener('timeupdate', () => {
        if (vid.currentTime >= videoPlaybackLimit) {
          vid.pause();
          if (isPlaying) navigate(1);
        }
      });
    }

    // Pause auto-advance timer while video is playing
    if (isPlaying) pauseTimer();
    vid.addEventListener('play', () => { if (isPlaying) pauseTimer(); });
    vid.addEventListener('pause', () => { /* don't restart — ended event handles advance */ });

    mediaContainer.innerHTML = '';
    mediaContainer.appendChild(vid);
  } else {
    const img = document.createElement('img');
    img.src = `/api/gallery/${item.id}/file`;
    img.alt = item.original_name;
    img.draggable = false;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.objectFit = 'contain';

    // Resume timer once image is loaded (or immediately if already playing)
    img.addEventListener('load', () => {
      if (isPlaying) restartTimer();
    });
    img.addEventListener('error', () => {
      // Skip broken images
      setTimeout(() => navigate(1), 1000);
    });

    mediaContainer.innerHTML = '';
    mediaContainer.appendChild(img);
  }
}

function stopCurrentMedia() {
  const vid = mediaContainer.querySelector('video');
  if (vid) {
    vid.pause();
    vid.src = '';
  }
}

// ============================================================
// Timer
// ============================================================
function startTimer() {
  elapsed = 0;
  timerStart = performance.now();
  updateRing(0);
  scheduleRaf();
}

function restartTimer() {
  cancelAnimationFrame(rafId);
  clearTimeout(timerInterval);
  startTimer();
}

function pauseTimer() {
  cancelAnimationFrame(rafId);
  clearTimeout(timerInterval);
}

function scheduleRaf() {
  rafId = requestAnimationFrame(tickTimer);
}

function tickTimer(now) {
  elapsed = now - timerStart;
  const progress = Math.min(elapsed / timerDuration, 1);
  updateRing(progress);

  if (elapsed >= timerDuration) {
    navigate(1);
    return;
  }

  scheduleRaf();
}

function updateRing(progress) {
  const offset = RING_CIRCUMFERENCE * (1 - progress);
  ringFg.style.strokeDashoffset = offset;
}

function togglePlayPause() {
  isPlaying = !isPlaying;

  if (isPlaying) {
    playPauseIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
    // If current item is a video, let it continue; otherwise restart timer
    const vid = mediaContainer.querySelector('video');
    if (vid) {
      vid.play().catch(() => {});
    } else {
      restartTimer();
    }
  } else {
    playPauseIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`;
    pauseTimer();
    updateRing(0);
    const vid = mediaContainer.querySelector('video');
    if (vid) vid.pause();
  }
}

// ============================================================
// Fullscreen
// ============================================================
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

document.addEventListener('fullscreenchange', () => {
  const isFs = !!document.fullscreenElement;
  fullscreenBtn.innerHTML = isFs
    ? `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>`
    : `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
});

// ============================================================
// Start
// ============================================================
document.addEventListener('DOMContentLoaded', initSlideshow);
