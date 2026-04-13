/* ============================================================
   Upload functionality
   ============================================================ */

const ACCEPTED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/heic', 'image/heif', 'image/avif',
  'video/mp4', 'video/quicktime', 'video/avi',
  'video/webm', 'video/x-matroska', 'video/x-msvideo',
  'video/3gpp', 'video/mpeg',
];

const ACCEPTED_EXTS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif',
  '.mp4', '.mov', '.avi', '.webm', '.mkv', '.3gp', '.mpg', '.mpeg',
];

let uploadQueue = [];

function initUpload() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');

  if (!uploadArea) return;

  uploadArea.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    handleFiles([...fileInput.files]);
    fileInput.value = '';
  });

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = [...e.dataTransfer.files];
    handleFiles(files);
  });

  document.getElementById('uploadMoreBtn')?.addEventListener('click', () => {
    document.getElementById('uploadSuccess').classList.add('hidden');
    document.getElementById('uploadArea').classList.remove('hidden');
    document.getElementById('uploadQueue').innerHTML = '';
    document.getElementById('uploadQueue').classList.add('hidden');
    uploadQueue = [];
  });
}

function isAccepted(file) {
  if (ACCEPTED_TYPES.includes(file.type)) return true;
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  return ACCEPTED_EXTS.includes(ext);
}

function handleFiles(files) {
  const valid = files.filter(f => {
    if (!isAccepted(f)) {
      Toast.warning(`Skipped: ${f.name} (unsupported type)`);
      return false;
    }
    return true;
  });

  if (valid.length === 0) return;

  uploadQueue = valid.map(file => ({ file, status: 'pending' }));

  renderQueue();
  startUpload();
}

function renderQueue() {
  const container = document.getElementById('uploadQueue');
  container.innerHTML = '';
  container.classList.remove('hidden');
  document.getElementById('uploadArea').classList.add('hidden');
  document.getElementById('uploadSuccess').classList.add('hidden');

  uploadQueue.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'upload-item';
    el.id = `upload-item-${i}`;
    el.innerHTML = `
      <div>
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="color:var(--text-muted)">
          ${item.file.type.startsWith('video/') ? Icons.video : Icons.image}
        </svg>
      </div>
      <div class="flex-col" style="flex:1;min-width:0">
        <div class="upload-item-name">${escapeHtml(item.file.name)}</div>
        <div class="progress-bar-wrap"><div class="progress-bar" id="progress-${i}" style="width:0%"></div></div>
      </div>
      <div class="upload-item-status pending" id="status-${i}">${formatBytes(item.file.size)}</div>`;
    container.appendChild(el);
  });
}

async function startUpload() {
  // Upload all files as a single multipart request (batched by 10)
  const BATCH = 10;
  let allDone = true;

  for (let i = 0; i < uploadQueue.length; i += BATCH) {
    const batch = uploadQueue.slice(i, i + BATCH);
    const indices = batch.map((_, j) => i + j);

    // Mark as uploading
    indices.forEach(idx => {
      setItemStatus(idx, 'uploading', 'Uploading…');
      setItemProgress(idx, 20);
    });

    try {
      const formData = new FormData();
      batch.forEach(item => formData.append('files', item.file));

      const xhr = new XMLHttpRequest();
      await new Promise((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 80) + 20;
            indices.forEach(idx => setItemProgress(idx, pct));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              reject(new Error(JSON.parse(xhr.responseText).error || 'Upload failed'));
            } catch {
              reject(new Error('Upload failed'));
            }
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error')));

        xhr.open('POST', '/api/upload');
        xhr.send(formData);
      });

      indices.forEach(idx => {
        setItemProgress(idx, 100);
        setItemStatus(idx, 'done', 'Submitted ✓');
      });
    } catch (err) {
      allDone = false;
      indices.forEach(idx => setItemStatus(idx, 'error', `Error: ${err.message}`));
    }
  }

  // Show success or partial failure
  setTimeout(() => {
    if (allDone) {
      document.getElementById('uploadQueue').classList.add('hidden');
      document.getElementById('uploadSuccess').classList.remove('hidden');
    } else {
      Toast.error('Some files failed to upload. Check the list above.');
    }
  }, 800);
}

function setItemStatus(index, status, text) {
  const el = document.getElementById(`status-${index}`);
  if (el) {
    el.className = `upload-item-status ${status}`;
    el.textContent = text;
  }
}

function setItemProgress(index, pct) {
  const bar = document.getElementById(`progress-${index}`);
  if (bar) bar.style.width = `${pct}%`;
}

document.addEventListener('DOMContentLoaded', initUpload);
