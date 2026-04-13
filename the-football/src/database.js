const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_PATH = path.join(DATA_DIR, 'gallery.db');

// Ensure data directories exist
for (const dir of [
  path.join(DATA_DIR, 'uploads', 'originals'),
  path.join(DATA_DIR, 'uploads', 'thumbnails'),
]) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

async function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      created_by INTEGER REFERENCES admins(id)
    );

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      user_agent TEXT,
      exif_data TEXT,
      uploaded_at TEXT DEFAULT (datetime('now')),
      reviewed_at TEXT,
      reviewed_by INTEGER REFERENCES admins(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_media_status ON media(status);
    CREATE INDEX IF NOT EXISTS idx_media_uploaded ON media(uploaded_at);
  `);

  // Default settings
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const defaults = {
    slideshow_interval: '5000',
    video_playback_limit: '0',
    site_name: 'The Gallery',
    upload_enabled: 'true',
  };
  for (const [key, value] of Object.entries(defaults)) {
    insertSetting.run(key, value);
  }

  // Create initial admin if none exist
  const count = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
  if (count === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'changeme';
    const hash = bcrypt.hashSync(password, 12);
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash);
    console.log(`Initial admin created — username: ${username}`);
  }
}

module.exports = { db, initDatabase };
