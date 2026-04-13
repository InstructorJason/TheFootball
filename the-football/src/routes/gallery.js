const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { db } = require('../database');

const router = express.Router();

const DATA_DIR = process.env.DATA_DIR || '/data';
const ORIGINALS_DIR = path.join(DATA_DIR, 'uploads', 'originals');
const THUMBNAILS_DIR = path.join(DATA_DIR, 'uploads', 'thumbnails');

// GET /api/gallery — list cleared media
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const offset = (page - 1) * limit;

  const total = db.prepare("SELECT COUNT(*) as c FROM media WHERE status = 'cleared'").get().c;
  const items = db.prepare(`
    SELECT id, filename, original_name, mimetype, size, uploaded_at
    FROM media WHERE status = 'cleared'
    ORDER BY uploaded_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

// GET /api/gallery/settings/public
router.get('/settings/public', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({
    slideshow_interval: parseInt(s.slideshow_interval || '5000'),
    video_playback_limit: parseInt(s.video_playback_limit || '0'),
    site_name: s.site_name || 'The Gallery',
    upload_enabled: s.upload_enabled !== 'false',
  });
});

// GET /api/gallery/:id/file — serve cleared file
router.get('/:id/file', (req, res) => {
  const media = db.prepare("SELECT * FROM media WHERE id = ? AND status = 'cleared'").get(req.params.id);
  if (!media) return res.status(404).json({ error: 'Not found' });

  const filePath = path.join(ORIGINALS_DIR, media.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });

  res.setHeader('Content-Type', media.mimetype);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(media.original_name)}"`);
  res.sendFile(filePath);
});

// GET /api/gallery/:id/thumb — serve thumbnail (cleared only)
router.get('/:id/thumb', (req, res) => {
  const media = db.prepare("SELECT * FROM media WHERE id = ? AND status = 'cleared'").get(req.params.id);
  if (!media) return res.status(404).json({ error: 'Not found' });

  if (media.mimetype.startsWith('video/')) {
    return res.status(204).end();
  }

  const thumbName = media.filename.replace(/\.[^.]+$/, '.jpg');
  const thumbPath = path.join(THUMBNAILS_DIR, thumbName);
  if (fs.existsSync(thumbPath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    return res.sendFile(thumbPath);
  }

  const orig = path.join(ORIGINALS_DIR, media.filename);
  if (fs.existsSync(orig)) {
    res.setHeader('Content-Type', media.mimetype);
    return res.sendFile(orig);
  }

  res.status(404).end();
});

// GET /api/gallery/:id/download — download single file
router.get('/:id/download', (req, res) => {
  const media = db.prepare("SELECT * FROM media WHERE id = ? AND status = 'cleared'").get(req.params.id);
  if (!media) return res.status(404).json({ error: 'Not found' });

  const filePath = path.join(ORIGINALS_DIR, media.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(media.original_name)}"`);
  res.sendFile(filePath);
});

// POST /api/gallery/download/bulk — ZIP download
router.post('/download/bulk', (req, res) => {
  const { ids } = req.body;

  let items;
  if (!ids || ids === 'all') {
    items = db.prepare("SELECT * FROM media WHERE status = 'cleared' ORDER BY uploaded_at DESC").all();
  } else if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    items = db.prepare(
      `SELECT * FROM media WHERE id IN (${placeholders}) AND status = 'cleared' ORDER BY uploaded_at DESC`
    ).all(...ids);
  } else {
    return res.status(400).json({ error: 'Provide ids array or "all"' });
  }

  if (items.length === 0) {
    return res.status(404).json({ error: 'No media found' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="gallery-${Date.now()}.zip"`);

  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', err => { console.error('Archive error:', err); });
  archive.pipe(res);

  // Handle duplicate filenames
  const seen = new Map();
  for (const item of items) {
    const filePath = path.join(ORIGINALS_DIR, item.filename);
    if (!fs.existsSync(filePath)) continue;

    let name = item.original_name;
    const count = seen.get(name) || 0;
    if (count > 0) {
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      name = `${base} (${count})${ext}`;
    }
    seen.set(item.original_name, count + 1);
    archive.file(filePath, { name });
  }

  archive.finalize();
});

module.exports = router;
