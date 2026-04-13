/* ============================================================
   Admin dashboard logic
   ============================================================ */

let currentSection = 'pending';
let currentAdmin = null;
let selectedIds = new Set();

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Check if already logged in
  if (Auth.token) {
    try {
      const data = await api('/api/auth/me');
      currentAdmin = data.user;
      showDashboard();
      return;
    } catch {
      Auth.clear();
    }
  }
  showLogin();
});

// ============================================================
// Login
// ============================================================
function showLogin() {
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('adminApp').classList.add('hidden');
  document.getElementById('loginUsername').focus();
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: {
        username: document.getElementById('loginUsername').value.trim(),
        password: document.getElementById('loginPassword').value,
      },
    });
    Auth.set(data.token);
    currentAdmin = data.user;
    showDashboard();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

// ============================================================
// Dashboard
// ============================================================
function showDashboard() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('adminApp').classList.remove('hidden');
  document.getElementById('sidebarUsername').textContent = currentAdmin.username;

  // Show hamburger on mobile
  const toggleBtn = document.getElementById('sidebarToggle');
  toggleBtn.style.display = '';
  toggleBtn.addEventListener('click', toggleSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', logout);

  // Media modal close
  document.getElementById('mediaModalClose').addEventListener('click', closeMediaModal);
  document.getElementById('mediaModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeMediaModal();
  });

  // Sidebar nav
  document.querySelectorAll('.sidebar-link[data-section]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(link.dataset.section);
      closeSidebar();
    });
  });

  // Load initial section
  refreshStats();
  navigateTo('pending');

  // Poll for new pending items every 30s
  setInterval(refreshStats, 30000);
}

function logout() {
  Auth.clear();
  currentAdmin = null;
  api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  showLogin();
}

// ============================================================
// Sidebar (mobile)
// ============================================================
function toggleSidebar() {
  document.getElementById('adminSidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}

function closeSidebar() {
  document.getElementById('adminSidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

// ============================================================
// Navigation
// ============================================================
function navigateTo(section) {
  currentSection = section;
  selectedIds.clear();

  // Update sidebar active state
  document.querySelectorAll('.sidebar-link[data-section]').forEach(l => {
    l.classList.toggle('active', l.dataset.section === section);
  });

  const titles = {
    pending: 'Approval Queue',
    cleared: 'Cleared Media',
    rejected: 'Rejected Media',
    users: 'Admin Users',
    settings: 'Settings',
  };
  document.getElementById('sectionTitle').textContent = titles[section] || section;
  document.getElementById('topbarActions').innerHTML = '';

  const content = document.getElementById('adminContent');
  content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

  switch (section) {
    case 'pending': loadQueue('pending'); break;
    case 'cleared': loadQueue('cleared'); break;
    case 'rejected': loadQueue('rejected'); break;
    case 'users': loadUsers(); break;
    case 'settings': loadSettings(); break;
  }
}

// ============================================================
// Stats / Badge
// ============================================================
async function refreshStats() {
  try {
    const stats = await api('/api/admin/stats');
    const badge = document.getElementById('pendingBadge');
    if (stats.pending > 0) {
      badge.textContent = stats.pending > 99 ? '99+' : stats.pending;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch { /* ignore */ }
}

// ============================================================
// Queue (pending / cleared / rejected)
// ============================================================
async function loadQueue(status, page = 1) {
  const content = document.getElementById('adminContent');

  try {
    const data = await api(`/api/admin/media?status=${status}&page=${page}&limit=50`);
    renderQueue(status, data);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

function renderQueue(status, data) {
  const content = document.getElementById('adminContent');
  const { items, total, page, pages } = data;

  if (items.length === 0) {
    const messages = {
      pending: ['No pending items', 'Nothing waiting for review — you\'re all caught up!'],
      cleared: ['No cleared media', 'Approved items will appear here.'],
      rejected: ['No rejected items', 'Rejected submissions will appear here.'],
    };
    const [title, desc] = messages[status] || ['No items', ''];
    content.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        <h3>${title}</h3>
        <p>${desc}</p>
      </div>`;
    return;
  }

  // Build bulk action buttons for this status
  let bulkBtns = '';
  if (status !== 'cleared') {
    bulkBtns += `<button class="btn btn-success btn-sm" id="bulkApproveBtn" onclick="bulkUpdateStatus('cleared', '${status}')">
      <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      Approve
    </button>`;
  }
  if (status !== 'rejected') {
    bulkBtns += `<button class="btn btn-warning btn-sm" id="bulkRejectBtn" onclick="bulkUpdateStatus('rejected', '${status}')">
      <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      Reject
    </button>`;
  }
  bulkBtns += `<button class="btn btn-danger btn-sm" id="bulkDeleteBtn" onclick="bulkDelete('${status}')">
    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
    Delete
  </button>`;

  const controls = document.createElement('div');
  controls.className = 'queue-controls';
  controls.id = 'queueControls';
  controls.innerHTML = `
    <label class="select-all-label" title="Select all on this page">
      <input type="checkbox" id="selectAllCheck" onchange="handleSelectAll(this)">
      <span>Select all</span>
    </label>
    <span class="sel-count hidden" id="selCount"></span>
    <div class="bulk-actions hidden" id="bulkActions">${bulkBtns}</div>
    <span style="margin-left:auto;color:var(--text-muted);font-size:.85rem">
      ${total} item${total !== 1 ? 's' : ''}${pages > 1 ? ` · Page ${page} of ${pages}` : ''}
    </span>`;

  const grid = document.createElement('div');
  grid.className = 'admin-grid';
  items.forEach(item => grid.appendChild(createAdminCard(item, status)));

  content.innerHTML = '';
  content.appendChild(controls);
  content.appendChild(grid);

  if (pages > 1) {
    content.appendChild(renderPagination(page, pages, (p) => loadQueue(status, p)));
  }
}

function createAdminCard(item, status) {
  const card = document.createElement('div');
  card.className = 'admin-card';
  card.dataset.id = item.id;

  const video = isVideo(item.mimetype);
  const thumbSrc = `/api/admin/media/${item.id}/thumb`;
  const fileSrc = `/api/admin/media/${item.id}/file`;

  let exifHtml = '';
  if (item.exif_data) {
    try {
      const exif = JSON.parse(item.exif_data);
      const rows = [];
      if (exif.Make || exif.Model) rows.push(`<tr><td>Device</td><td>${escapeHtml([exif.Make, exif.Model].filter(Boolean).join(' '))}</td></tr>`);
      if (exif.DateTimeOriginal || exif.CreateDate) {
        const d = exif.DateTimeOriginal || exif.CreateDate;
        rows.push(`<tr><td>Taken</td><td>${escapeHtml(String(d))}</td></tr>`);
      }
      if (exif.GPSLatitude && exif.GPSLongitude) {
        const lat = typeof exif.GPSLatitude === 'number' ? exif.GPSLatitude.toFixed(5) : exif.GPSLatitude;
        const lon = typeof exif.GPSLongitude === 'number' ? exif.GPSLongitude.toFixed(5) : exif.GPSLongitude;
        rows.push(`<tr><td>GPS</td><td>${lat}, ${lon}</td></tr>`);
      }
      if (exif.ImageWidth && exif.ImageHeight) rows.push(`<tr><td>Size</td><td>${exif.ImageWidth}×${exif.ImageHeight}</td></tr>`);
      if (rows.length > 0) {
        exifHtml = `
          <span class="exif-toggle" onclick="this.nextElementSibling.classList.toggle('show');this.textContent=this.nextElementSibling.classList.contains('show')?'Hide EXIF':'Show EXIF'">Show EXIF</span>
          <div class="exif-details"><table class="exif-table">${rows.join('')}</table></div>`;
      }
    } catch { /* ignore */ }
  }

  const uaShort = item.user_agent
    ? item.user_agent.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim().substring(0, 80)
    : null;

  card.innerHTML = `
    <div class="admin-card-thumb" onclick="previewMedia(${item.id}, '${video ? 'video' : 'image'}', '${escapeHtml(item.original_name)}')">
      ${video
        ? `<div style="width:100%;height:100%;background:var(--surface-3);display:flex;align-items:center;justify-content:center">
             <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
           </div>
           <div class="video-badge">VIDEO</div>`
        : `<img src="${thumbSrc}" alt="${escapeHtml(item.original_name)}" loading="lazy">`}
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s;background:rgba(0,0,0,0.3)" class="thumb-hover">
        <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      </div>
      <div class="admin-card-select" onclick="toggleCardSelection(${item.id}, event)">
        <div class="admin-select-check">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      </div>
    </div>

    <div class="admin-card-body">
      <div class="admin-card-name" title="${escapeHtml(item.original_name)}">${escapeHtml(item.original_name)}</div>
      <div class="admin-card-meta">
        ${formatDate(item.uploaded_at)}<br>
        ${formatBytes(item.size)}
        ${item.reviewed_by_name ? `<br><span style="color:var(--text-dim)">By ${escapeHtml(item.reviewed_by_name)}</span>` : ''}
        ${uaShort ? `<br><span style="color:var(--text-dim);font-size:.7rem">${escapeHtml(uaShort)}</span>` : ''}
      </div>
      ${exifHtml}
    </div>

    <div class="admin-card-actions">
      ${status === 'pending' ? `
        <button class="btn btn-success btn-sm" onclick="updateStatus(${item.id}, 'cleared')">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Approve
        </button>
        <button class="btn btn-warning btn-sm" onclick="updateStatus(${item.id}, 'rejected')">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Reject
        </button>
      ` : ''}
      ${status === 'rejected' ? `
        <button class="btn btn-success btn-sm" onclick="updateStatus(${item.id}, 'cleared')">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Approve
        </button>
      ` : ''}
      ${status === 'cleared' ? `
        <button class="btn btn-warning btn-sm" onclick="updateStatus(${item.id}, 'rejected')">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Reject
        </button>
      ` : ''}
      <button class="btn btn-danger btn-sm" onclick="deleteMedia(${item.id})" style="margin-left:auto">
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
        Delete
      </button>
    </div>`;

  // Hover effect on thumb
  const thumb = card.querySelector('.admin-card-thumb');
  const hover = card.querySelector('.thumb-hover');
  thumb.addEventListener('mouseenter', () => hover.style.opacity = '1');
  thumb.addEventListener('mouseleave', () => hover.style.opacity = '0');

  return card;
}

// ============================================================
// Selection
// ============================================================
function toggleCardSelection(id, event) {
  event.stopPropagation();
  const card = document.querySelector(`.admin-card[data-id="${id}"]`);
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    card?.classList.remove('selected');
  } else {
    selectedIds.add(id);
    card?.classList.add('selected');
  }
  updateSelectionUI();
}

function handleSelectAll(checkbox) {
  const cards = document.querySelectorAll('.admin-card');
  cards.forEach(c => {
    const id = parseInt(c.dataset.id);
    if (checkbox.checked) {
      selectedIds.add(id);
      c.classList.add('selected');
    } else {
      selectedIds.delete(id);
      c.classList.remove('selected');
    }
  });
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = selectedIds.size;
  const cards = document.querySelectorAll('.admin-card');
  const selCount = document.getElementById('selCount');
  const bulkActions = document.getElementById('bulkActions');
  const selectAllCheck = document.getElementById('selectAllCheck');

  if (selCount) {
    if (count > 0) {
      selCount.textContent = `${count} selected`;
      selCount.classList.remove('hidden');
      bulkActions?.classList.remove('hidden');
    } else {
      selCount.classList.add('hidden');
      bulkActions?.classList.add('hidden');
    }
  }

  if (selectAllCheck) {
    selectAllCheck.indeterminate = count > 0 && count < cards.length;
    selectAllCheck.checked = cards.length > 0 && count === cards.length;
  }
}

// ============================================================
// Bulk actions
// ============================================================
async function bulkUpdateStatus(targetStatus, currentStatus) {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  const label = targetStatus === 'cleared' ? 'Approve' : 'Reject';
  const btnClass = targetStatus === 'cleared' ? 'btn-success' : 'btn-warning';
  const confirmed = await confirmDialog(
    `${label} ${ids.length} item${ids.length !== 1 ? 's' : ''}?`,
    `Bulk ${label}`,
    label,
    btnClass
  );
  if (!confirmed) return;

  let success = 0, failed = 0;
  for (const id of ids) {
    try {
      await api(`/api/admin/media/${id}/status`, { method: 'PATCH', body: { status: targetStatus } });
      document.querySelector(`.admin-card[data-id="${id}"]`)?.remove();
      selectedIds.delete(id);
      success++;
    } catch { failed++; }
  }

  if (success > 0) Toast.success(`${success} item${success !== 1 ? 's' : ''} ${targetStatus === 'cleared' ? 'approved' : 'rejected'}`);
  if (failed > 0) Toast.error(`${failed} item${failed !== 1 ? 's' : ''} failed`);

  updateSelectionUI();
  const grid = document.querySelector('.admin-grid');
  if (grid && grid.children.length === 0) navigateTo(currentSection);
  refreshStats();
}

async function bulkDelete(currentStatus) {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  const confirmed = await confirmDialog(
    `Permanently delete ${ids.length} item${ids.length !== 1 ? 's' : ''}? This cannot be undone.`,
    'Bulk Delete',
    'Delete',
    'btn-danger'
  );
  if (!confirmed) return;

  let success = 0, failed = 0;
  for (const id of ids) {
    try {
      await api(`/api/admin/media/${id}`, { method: 'DELETE' });
      document.querySelector(`.admin-card[data-id="${id}"]`)?.remove();
      selectedIds.delete(id);
      success++;
    } catch { failed++; }
  }

  if (success > 0) Toast.success(`${success} item${success !== 1 ? 's' : ''} deleted`);
  if (failed > 0) Toast.error(`${failed} failed`);

  updateSelectionUI();
  const grid = document.querySelector('.admin-grid');
  if (grid && grid.children.length === 0) navigateTo(currentSection);
  refreshStats();
}

function renderPagination(current, total, onPage) {
  const nav = document.createElement('div');
  nav.className = 'pagination';

  const addBtn = (label, page, active = false, disabled = false) => {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (active ? ' active' : '');
    btn.textContent = label;
    btn.disabled = disabled;
    if (!disabled && !active) btn.addEventListener('click', () => onPage(page));
    nav.appendChild(btn);
  };

  addBtn('‹', current - 1, false, current <= 1);

  const start = Math.max(1, current - 2);
  const end = Math.min(total, current + 2);
  for (let p = start; p <= end; p++) addBtn(p, p, p === current);

  addBtn('›', current + 1, false, current >= total);

  return nav;
}

// ============================================================
// Individual media actions
// ============================================================
async function updateStatus(id, status) {
  const card = document.querySelector(`.admin-card[data-id="${id}"]`);
  if (card) card.style.opacity = '0.5';

  try {
    await api(`/api/admin/media/${id}/status`, {
      method: 'PATCH',
      body: { status },
    });

    const label = status === 'cleared' ? 'Approved' : 'Rejected';
    Toast.success(`${label} successfully`);

    selectedIds.delete(id);
    card?.remove();

    const grid = document.querySelector('.admin-grid');
    if (grid && grid.children.length === 0) {
      navigateTo(currentSection);
    }

    updateSelectionUI();
    refreshStats();
  } catch (err) {
    if (card) card.style.opacity = '1';
    Toast.error(err.message);
  }
}

async function deleteMedia(id) {
  const confirmed = await confirmDialog(
    'This will permanently delete the file and cannot be undone.',
    'Delete Media'
  );
  if (!confirmed) return;

  const card = document.querySelector(`.admin-card[data-id="${id}"]`);
  if (card) card.style.opacity = '0.5';

  try {
    await api(`/api/admin/media/${id}`, { method: 'DELETE' });
    Toast.success('Deleted permanently');
    selectedIds.delete(id);
    card?.remove();

    const grid = document.querySelector('.admin-grid');
    if (grid && grid.children.length === 0) {
      navigateTo(currentSection);
    }
    updateSelectionUI();
    refreshStats();
  } catch (err) {
    if (card) card.style.opacity = '1';
    Toast.error(err.message);
  }
}

// ============================================================
// Media Preview Modal
// ============================================================
function previewMedia(id, type, name) {
  const modal = document.getElementById('mediaModal');
  const content = document.getElementById('mediaModalContent');

  if (type === 'video') {
    content.innerHTML = `<video src="/api/admin/media/${id}/file" controls autoplay playsinline style="max-width:90vw;max-height:80vh"></video>`;
  } else {
    content.innerHTML = `<img src="/api/admin/media/${id}/file" alt="${escapeHtml(name)}" style="max-width:90vw;max-height:80vh;object-fit:contain">`;
  }

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMediaModal() {
  const modal = document.getElementById('mediaModal');
  const vid = modal.querySelector('video');
  if (vid) { vid.pause(); vid.src = ''; }
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

// ESC to close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMediaModal();
});

// ============================================================
// Users
// ============================================================
async function loadUsers() {
  const content = document.getElementById('adminContent');

  try {
    const data = await api('/api/admin/users');
    renderUsers(data.users);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

function renderUsers(users) {
  const content = document.getElementById('adminContent');

  content.innerHTML = `
    <div style="max-width:720px">
      <!-- Add user form -->
      <div class="card" style="margin-bottom:24px">
        <h2 style="font-size:.95rem;font-weight:600;margin-bottom:16px">Add Admin User</h2>
        <form id="addUserForm">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            <div class="form-group">
              <label class="form-label">Username</label>
              <input type="text" class="form-control" id="newUsername" autocomplete="off" required
                     pattern="[a-zA-Z0-9_.-]+" title="Letters, numbers, underscores, hyphens, dots">
            </div>
            <div class="form-group">
              <label class="form-label">Password (min 8 chars)</label>
              <input type="password" class="form-control" id="newPassword" minlength="8" required autocomplete="new-password">
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-sm" id="addUserBtn">Add User</button>
        </form>
      </div>

      <!-- Users table -->
      <div class="card" style="padding:0;overflow:hidden">
        <table class="data-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Created</th>
              <th>Created By</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="usersTableBody">
            ${users.map(u => `
              <tr data-uid="${u.id}">
                <td>
                  <strong>${escapeHtml(u.username)}</strong>
                  ${u.id === currentAdmin.id ? ' <span style="font-size:.72rem;color:var(--accent)">(you)</span>' : ''}
                </td>
                <td class="text-muted text-sm">${formatDate(u.created_at)}</td>
                <td class="text-muted text-sm">${u.created_by_name ? escapeHtml(u.created_by_name) : '—'}</td>
                <td style="text-align:right">
                  ${u.id !== currentAdmin.id
                    ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')">Remove</button>`
                    : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <!-- Change own password -->
      <div class="card" style="margin-top:24px">
        <h2 style="font-size:.95rem;font-weight:600;margin-bottom:16px">Change Your Password</h2>
        <form id="changePwForm">
          <div style="display:flex;flex-direction:column;gap:12px;max-width:360px">
            <div class="form-group">
              <label class="form-label">Current Password</label>
              <input type="password" class="form-control" id="currentPw" required autocomplete="current-password">
            </div>
            <div class="form-group">
              <label class="form-label">New Password (min 8 chars)</label>
              <input type="password" class="form-control" id="newPw" minlength="8" required autocomplete="new-password">
            </div>
            <div>
              <button type="submit" class="btn btn-primary btn-sm" id="changePwBtn">Update Password</button>
            </div>
          </div>
        </form>
      </div>
    </div>`;

  document.getElementById('addUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('addUserBtn');
    btn.disabled = true;
    btn.textContent = 'Adding…';

    try {
      const result = await api('/api/admin/users', {
        method: 'POST',
        body: {
          username: document.getElementById('newUsername').value.trim(),
          password: document.getElementById('newPassword').value,
        },
      });
      Toast.success(`User "${result.username}" created`);
      document.getElementById('newUsername').value = '';
      document.getElementById('newPassword').value = '';
      loadUsers();
    } catch (err) {
      Toast.error(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add User';
    }
  });

  document.getElementById('changePwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('changePwBtn');
    btn.disabled = true;
    btn.textContent = 'Updating…';

    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: {
          current_password: document.getElementById('currentPw').value,
          new_password: document.getElementById('newPw').value,
        },
      });
      Toast.success('Password updated successfully');
      document.getElementById('changePwForm').reset();
    } catch (err) {
      Toast.error(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update Password';
    }
  });
}

async function deleteUser(id, username) {
  const confirmed = await confirmDialog(
    `Remove admin access for "${username}"? This cannot be undone.`,
    'Remove User'
  );
  if (!confirmed) return;

  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    Toast.success(`${username} removed`);
    document.querySelector(`tr[data-uid="${id}"]`)?.remove();
  } catch (err) {
    Toast.error(err.message);
  }
}

// ============================================================
// Settings
// ============================================================
async function loadSettings() {
  const content = document.getElementById('adminContent');

  try {
    const settings = await api('/api/admin/settings');
    renderSettings(settings);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

function renderSettings(s) {
  const content = document.getElementById('adminContent');

  const videoLimit = parseInt(s.video_playback_limit) || 0;
  const slideshowInterval = parseInt(s.slideshow_interval) || 5000;

  content.innerHTML = `
    <form id="settingsForm" style="max-width:560px;display:flex;flex-direction:column;gap:16px">

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Site Name</div>
          <div class="setting-desc">Displayed in the header and browser tab</div>
        </div>
        <input type="text" class="form-control" id="s_site_name" value="${escapeHtml(s.site_name || 'The Gallery')}"
               style="max-width:180px">
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Allow Uploads</div>
          <div class="setting-desc">Enable or disable public media submissions</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="s_upload_enabled" ${s.upload_enabled !== 'false' ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Default Slideshow Speed</div>
          <div class="setting-desc">How long each photo is shown (seconds)</div>
        </div>
        <select class="form-control" id="s_slideshow_interval" style="max-width:120px">
          <option value="2000" ${slideshowInterval===2000?'selected':''}>2s</option>
          <option value="3000" ${slideshowInterval===3000?'selected':''}>3s</option>
          <option value="5000" ${slideshowInterval===5000?'selected':''}>5s</option>
          <option value="8000" ${slideshowInterval===8000?'selected':''}>8s</option>
          <option value="10000" ${slideshowInterval===10000?'selected':''}>10s</option>
          <option value="15000" ${slideshowInterval===15000?'selected':''}>15s</option>
          <option value="30000" ${slideshowInterval===30000?'selected':''}>30s</option>
        </select>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Video Playback Limit</div>
          <div class="setting-desc">Max seconds a video plays in gallery/slideshow (0 = no limit)</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <label class="toggle">
            <input type="checkbox" id="s_video_limit_enabled" ${videoLimit > 0 ? 'checked' : ''}
                   onchange="document.getElementById('s_video_limit_val').disabled = !this.checked">
            <span class="toggle-slider"></span>
          </label>
          <input type="number" class="form-control" id="s_video_limit_val"
                 value="${videoLimit > 0 ? videoLimit : 30}"
                 min="1" max="3600" style="max-width:80px"
                 ${videoLimit === 0 ? 'disabled' : ''}>
          <span class="text-muted text-sm">sec</span>
        </div>
      </div>

      <div>
        <button type="submit" class="btn btn-primary" id="saveSettingsBtn">Save Settings</button>
      </div>
    </form>`;

  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveSettingsBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    const limitEnabled = document.getElementById('s_video_limit_enabled').checked;
    const limitVal = parseInt(document.getElementById('s_video_limit_val').value) || 30;

    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: {
          site_name: document.getElementById('s_site_name').value.trim() || 'The Gallery',
          upload_enabled: document.getElementById('s_upload_enabled').checked ? 'true' : 'false',
          slideshow_interval: document.getElementById('s_slideshow_interval').value,
          video_playback_limit: limitEnabled ? String(limitVal) : '0',
        },
      });
      Toast.success('Settings saved');
    } catch (err) {
      Toast.error(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Settings';
    }
  });
}
