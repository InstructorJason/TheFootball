/* ============================================================
   Gallery & Upload page logic
   ============================================================ */

let allItems = [];        // all cleared items from server
let filteredItems = [];   // after filter applied
let currentPage = 1;
let totalPages = 1;
let selectMode = false;
let selectedIds = new Set();
let currentFilter = 'all';
let settings = {};
let videoPlaybackLimit = 0;

// Lightbox state
let lightboxIndex = 0;

// ============================================================
// Init
// ============================================================
async function initGallery() {
  // Load site settings
  try {
    settings = await api('/api/gallery/settings/public');
    videoPlaybackLimit = settings.video_playback_limit || 0;
    if (settings.site_name) {
      document.getElementById('siteName').innerHTML =
        settings.site_name.replace(/(\S+)\s*$/, '<span>$1</span>');
      document.title = settings.site_name;
    }
    if (settings.upload_enabled === false) {
      document.getElementById('navUpload').classList.add('hidden');
    }
  } catch { /* use defaults */ }

  // Tab switching via hash or nav links
  document.getElementById('navGallery').addEventListener('click', (e) => {
    e.preventDefault();
    showTab('gallery');
  });
  document.getElementById('navUpload').addEventListener('click', (e) => {
    e.preventDefault();
    showTab('upload');
  });

  // Filter chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      applyFilter();
    });
  });

  // Select mode
  document.getElementById('selectModeBtn').addEventListener('click', enterSelectMode);
  document.getElementById('cancelSelectBtn').addEventListener('click', exitSelectMode);
  document.getElementById('selectAllBtn').addEventListener('click', selectAll);
  document.getElementById('clearSelectionBtn').addEventListener('click', clearSelection);
  document.getElementById('downloadSelectedBtn').addEventListener('click', downloadSelected);
  document.getElementById('downloadAllBtn').addEventListener('click', downloadAll);

  // Lightbox
  document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
  document.getElementById('lightboxPrev').addEventListener('click', () => moveLightbox(-1));
  document.getElementById('lightboxNext').addEventListener('click', () => moveLightbox(1));
  document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.id === 'lightboxBody') closeLightbox();
  });

  document.addEventListener('keydown', handleKeydown);

  // Show initial tab based on hash
  const hash = location.hash.replace('#', '');
  showTab(hash === 'upload' ? 'upload' : 'gallery');

  await loadGallery(1);
}

function showTab(tab) {
  const isGallery = tab === 'gallery';
  document.getElementById('gallery-section').classList.toggle('hidden', !isGallery);
  document.getElementById('upload-section').classList.toggle('hidden', isGallery);
  document.getElementById('navGallery').classList.toggle('active', isGallery);
  document.getElementById('navUpload').classList.toggle('active', !isGallery);
  if (isGallery) location.hash = '';
  else location.hash = 'upload';
}

// ============================================================
// Load Gallery
// ============================================================
async function loadGallery(page = 1) {
  const grid = document.getElementById('galleryGrid');
  grid.innerHTML = '<div class="loading-overlay" style="grid-column:1/-1"><div class="spinner"></div></div>';

  try {
    const data = await api(`/api/gallery?page=${page}&limit=100`);
    allItems = data.items || [];
    currentPage = data.page;
    totalPages = data.pages;

    applyFilter();

    const count = data.total;
    document.getElementById('galleryCount').textContent =
      count === 0 ? '' : `${count} item${count !== 1 ? 's' : ''}`;
    document.getElementById('downloadAllBtn').classList.toggle('hidden', count === 0);
  } catch (err) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <p>Failed to load gallery: ${escapeHtml(err.message)}</p>
    </div>`;
  }
}

function applyFilter() {
  if (currentFilter === 'all') {
    filteredItems = [...allItems];
  } else if (currentFilter === 'image') {
    filteredItems = allItems.filter(i => !isVideo(i.mimetype));
  } else {
    filteredItems = allItems.filter(i => isVideo(i.mimetype));
  }
  renderGrid();
}

function renderGrid() {
  const grid = document.getElementById('galleryGrid');
  grid.innerHTML = '';

  if (filteredItems.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      <h3>No media yet</h3>
      <p>Approved photos and videos will appear here.</p>
    </div>`;
    return;
  }

  filteredItems.forEach((item, index) => {
    const el = createMediaItem(item, index);
    grid.appendChild(el);
  });
}

function createMediaItem(item, index) {
  const div = document.createElement('div');
  div.className = 'media-item';
  div.dataset.id = item.id;
  div.dataset.index = index;

  const video = isVideo(item.mimetype);

  if (video) {
    div.innerHTML = `
      <div class="video-thumb" style="background:var(--surface-3)">
        <video src="/api/gallery/${item.id}/file" preload="metadata" muted playsinline
               style="width:100%;height:100%;object-fit:cover"
               ${videoPlaybackLimit > 0 ? `data-limit="${videoPlaybackLimit}"` : ''}></video>
      </div>
      <div class="video-badge">VIDEO</div>
      <div class="play-icon">${Icons.play}</div>
      <div class="select-check">${Icons.check}</div>
      <div class="item-overlay">
        <div class="item-actions">
          <a href="/api/gallery/${item.id}/download" class="btn btn-ghost btn-sm" download
             onclick="event.stopPropagation()" title="Download">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/></svg>
          </a>
        </div>
      </div>`;
  } else {
    div.innerHTML = `
      <img src="/api/gallery/${item.id}/thumb" alt="${escapeHtml(item.original_name)}"
           loading="lazy" decoding="async">
      <div class="select-check">${Icons.check}</div>
      <div class="item-overlay">
        <div class="item-actions">
          <a href="/api/gallery/${item.id}/download" class="btn btn-ghost btn-sm" download
             onclick="event.stopPropagation()" title="Download">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/></svg>
          </a>
        </div>
      </div>`;
  }

  div.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    if (selectMode) {
      toggleSelect(item.id, div);
    } else {
      openLightbox(index);
    }
  });

  return div;
}

// ============================================================
// Select Mode
// ============================================================
function enterSelectMode() {
  selectMode = true;
  selectedIds.clear();
  document.getElementById('selectModeBtn').classList.add('hidden');
  document.getElementById('downloadAllBtn').classList.add('hidden');
  document.getElementById('selectionBar').classList.remove('hidden');
  updateSelectionUI();
}

function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  document.querySelectorAll('.media-item.selected').forEach(el => el.classList.remove('selected'));
  document.getElementById('selectModeBtn').classList.remove('hidden');
  if (filteredItems.length > 0) document.getElementById('downloadAllBtn').classList.remove('hidden');
  document.getElementById('selectionBar').classList.add('hidden');
}

function toggleSelect(id, el) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    el.classList.remove('selected');
  } else {
    selectedIds.add(id);
    el.classList.add('selected');
  }
  updateSelectionUI();
}

function selectAll() {
  filteredItems.forEach(item => {
    selectedIds.add(item.id);
    document.querySelector(`.media-item[data-id="${item.id}"]`)?.classList.add('selected');
  });
  updateSelectionUI();
}

function clearSelection() {
  selectedIds.clear();
  document.querySelectorAll('.media-item.selected').forEach(el => el.classList.remove('selected'));
  updateSelectionUI();
}

function updateSelectionUI() {
  const n = selectedIds.size;
  document.getElementById('selectedCount').textContent = `${n} selected`;
  document.getElementById('selCount').textContent = n;
  document.getElementById('downloadSelectedBtn').disabled = n === 0;
}

// ============================================================
// Downloads
// ============================================================
async function downloadAll() {
  await bulkDownload('all');
}

async function downloadSelected() {
  await bulkDownload([...selectedIds]);
}

async function bulkDownload(ids) {
  Toast.info('Preparing download…');
  try {
    const res = await fetch('/api/gallery/download/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Download failed');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gallery-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    Toast.success('Download started!');
  } catch (err) {
    Toast.error(err.message);
  }
}

// ============================================================
// Lightbox
// ============================================================
function openLightbox(index) {
  lightboxIndex = index;
  renderLightboxItem();
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  // Stop any playing video
  const video = document.querySelector('#lightboxContent video');
  if (video) { video.pause(); video.src = ''; }
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
}

function moveLightbox(dir) {
  const newIndex = lightboxIndex + dir;
  if (newIndex < 0 || newIndex >= filteredItems.length) return;
  // Stop current video
  const video = document.querySelector('#lightboxContent video');
  if (video) { video.pause(); video.src = ''; }
  lightboxIndex = newIndex;
  renderLightboxItem();
}

function renderLightboxItem() {
  const item = filteredItems[lightboxIndex];
  const content = document.getElementById('lightboxContent');
  const title = document.getElementById('lightboxTitle');
  const counter = document.getElementById('lightboxCounter');
  const dl = document.getElementById('lightboxDownload');

  title.textContent = item.original_name;
  counter.textContent = `${lightboxIndex + 1} / ${filteredItems.length}`;
  dl.href = `/api/gallery/${item.id}/download`;
  dl.download = item.original_name;

  if (isVideo(item.mimetype)) {
    content.innerHTML = `
      <video src="/api/gallery/${item.id}/file" controls autoplay playsinline
             style="max-width:90vw;max-height:85vh"
             ${videoPlaybackLimit > 0 ? `data-limit="${videoPlaybackLimit}"` : ''}></video>`;

    const vid = content.querySelector('video');
    if (videoPlaybackLimit > 0) {
      vid.addEventListener('timeupdate', () => {
        if (vid.currentTime >= videoPlaybackLimit) {
          vid.pause();
          vid.currentTime = videoPlaybackLimit;
        }
      });
    }
  } else {
    content.innerHTML = `
      <img src="/api/gallery/${item.id}/file" alt="${escapeHtml(item.original_name)}"
           style="max-width:90vw;max-height:85vh;object-fit:contain;border-radius:var(--radius)">`;
  }

  document.getElementById('lightboxPrev').style.opacity = lightboxIndex === 0 ? '0.3' : '';
  document.getElementById('lightboxNext').style.opacity = lightboxIndex === filteredItems.length - 1 ? '0.3' : '';
}

function handleKeydown(e) {
  const lb = document.getElementById('lightbox');
  if (!lb.classList.contains('open')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') moveLightbox(-1);
  if (e.key === 'ArrowRight') moveLightbox(1);
}

// Touch swipe on lightbox
let touchStartX = 0;
document.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!document.getElementById('lightbox').classList.contains('open')) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) moveLightbox(dx < 0 ? 1 : -1);
}, { passive: true });

// ============================================================
// Start
// ============================================================
document.addEventListener('DOMContentLoaded', initGallery);
