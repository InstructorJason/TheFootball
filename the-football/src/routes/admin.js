const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const DATA_DIR = process.env.DATA_DIR || '/data';
const ORIGINALS_DIR = path.join(DATA_DIR, 'uploads', 'originals');
const THUMBNAILS_DIR = path.join(DATA_DIR, 'uploads', 'thumbnails');

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  const pending = db.prepare("SELECT COUNT(*) as c FROM media WHERE status = 'pending'").get().c;
  const cleared = db.prepare("SELECT COUNT(*) as c FROM media WHERE status = 'cleared'").get().c;
  const rejected = db.prepare("SELECT COUNT(*) as c FROM media WHERE status = 'rejected'").get().c;
  res.json({ pending, cleared, rejected });
});

// GET /api/admin/media?status=pending|cleared|rejected&page=1&limit=50
router.get('/media', (req, res) => {
  const status = req.query.status || 'pending';
  if (!['pending', 'cleared', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as c FROM media WHERE status = ?').get(status).c;
  const items = db.prepare(`
    SELECT m.*, a.username as reviewed_by_name
    FROM media m
    LEFT JOIN admins a ON m.reviewed_by = a.id
    WHERE m.status = ?
    ORDER BY m.uploaded_at DESC
    LIMIT ? OFFSET ?
  `).all(status, limit, offset);

  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

// GET /api/admin/media/:id/file — serve any file (admin only)
router.get('/media/:id/file', (req, res) => {
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!media) return res.status(404).json({ error: 'Not found' });

  const filePath = path.join(ORIGINALS_DIR, media.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });

  res.setHeader('Content-Type', media.mimetype);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(media.original_name)}"`);
  res.sendFile(filePath);
});

// GET /api/admin/media/:id/thumb
router.get('/media/:id/thumb', (req, res) => {
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!media) return res.status(404).json({ error: 'Not found' });

  if (media.mimetype.startsWith('video/')) return res.status(204).end();

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

// PATCH /api/admin/media/:id/status — approve or reject
router.patch('/media/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['cleared', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be "cleared" or "rejected"' });
  }

  const media = db.prepare('SELECT id FROM media WHERE id = ?').get(req.params.id);
  if (!media) return res.status(404).json({ error: 'Not found' });

  db.prepare(`
    UPDATE media SET status = ?, reviewed_at = datetime('now'), reviewed_by = ?
    WHERE id = ?
  `).run(status, req.admin.id, req.params.id);

  res.json({ success: true });
});

// DELETE /api/admin/media/:id — permanently delete
router.delete('/media/:id', (req, res) => {
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!media) return res.status(404).json({ error: 'Not found' });

  const origPath = path.join(ORIGINALS_DIR, media.filename);
  const thumbName = media.filename.replace(/\.[^.]+$/, '.jpg');
  const thumbPath = path.join(THUMBNAILS_DIR, thumbName);

  try { fs.unlinkSync(origPath); } catch { /* already gone */ }
  try { fs.unlinkSync(thumbPath); } catch { /* already gone */ }

  db.prepare('DELETE FROM media WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/admin/users
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT a.id, a.username, a.created_at, b.username as created_by_name
    FROM admins a
    LEFT JOIN admins b ON a.created_by = b.id
    ORDER BY a.created_at ASC
  `).all();
  res.json({ users });
});

// POST /api/admin/users — create new admin
router.post('/users', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username may only contain letters, numbers, underscores, hyphens, and dots' });
  }

  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already exists' });

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(
    'INSERT INTO admins (username, password_hash, created_by) VALUES (?, ?, ?)'
  ).run(username, hash, req.admin.id);

  res.status(201).json({ success: true, id: result.lastInsertRowid, username });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  if (parseInt(req.params.id) === req.admin.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  const user = db.prepare('SELECT id FROM admins WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('DELETE FROM admins WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/admin/settings
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

// PUT /api/admin/settings
router.put('/settings', (req, res) => {
  const ALLOWED_KEYS = ['slideshow_interval', 'video_playback_limit', 'site_name', 'upload_enabled'];
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  for (const [key, value] of Object.entries(req.body)) {
    if (ALLOWED_KEYS.includes(key)) {
      upsert.run(key, String(value));
    }
  }

  res.json({ success: true });
});

module.exports = router;
