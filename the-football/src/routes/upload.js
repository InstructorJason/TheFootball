const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { db } = require('../database');

const router = express.Router();

const DATA_DIR = process.env.DATA_DIR || '/data';
const ORIGINALS_DIR = path.join(DATA_DIR, 'uploads', 'originals');
const THUMBNAILS_DIR = path.join(DATA_DIR, 'uploads', 'thumbnails');

const ALLOWED_MIMETYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
  'image/webp', 'image/heic', 'image/heif', 'image/avif',
  'video/mp4', 'video/quicktime', 'video/avi', 'video/webm',
  'video/x-matroska', 'video/x-msvideo', 'video/3gpp', 'video/mpeg',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif',
  '.mp4', '.mov', '.avi', '.webm', '.mkv', '.3gp', '.mpg', '.mpeg',
]);

// Authoritative MIME type by extension — overrides unreliable browser-reported values
const EXTENSION_MIMETYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.3gp': 'video/3gpp',
  '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg',
};

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '500') * 1024 * 1024;

const storage = multer.diskStorage({
  destination: ORIGINALS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIMETYPES.has(file.mimetype) || ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.originalname}`));
    }
  },
});

// Map sharp format names → canonical ext + MIME type
const SHARP_FORMAT_MAP = {
  jpeg: { ext: '.jpg',  mime: 'image/jpeg' },
  png:  { ext: '.png',  mime: 'image/png'  },
  gif:  { ext: '.gif',  mime: 'image/gif'  },
  webp: { ext: '.webp', mime: 'image/webp' },
  avif: { ext: '.avif', mime: 'image/avif' },
  heif: { ext: '.heic', mime: 'image/heic' },
  tiff: { ext: '.tiff', mime: 'image/tiff' },
};

// Detect true image format from file bytes — ignores browser-reported MIME/filename
async function detectImageFormat(filePath) {
  try {
    const { format } = await sharp(filePath).metadata();
    return SHARP_FORMAT_MAP[format] || null;
  } catch {
    return null;
  }
}

async function generateThumbnail(filePath, filename) {
  try {
    const thumbName = filename.replace(/\.[^.]+$/, '.jpg');
    const thumbPath = path.join(THUMBNAILS_DIR, thumbName);
    await sharp(filePath)
      .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(thumbPath);
    console.log(`[upload] Thumbnail generated: ${thumbName}`);
    return true;
  } catch (err) {
    console.error(`[upload] Thumbnail generation failed for ${filename}: ${err.message}`);
    return false;
  }
}

async function extractExif(filePath) {
  try {
    const { default: exifr } = await import('exifr');
    return await exifr.parse(filePath, {
      pick: ['Make', 'Model', 'DateTimeOriginal', 'CreateDate',
             'GPSLatitude', 'GPSLongitude', 'ImageWidth', 'ImageHeight',
             'Software', 'Orientation', 'FocalLength', 'ExposureTime',
             'FNumber', 'ISO'],
    });
  } catch {
    return null;
  }
}

// POST /api/upload
router.post('/', upload.array('files', 50), async (req, res) => {
  const uploadEnabled = db.prepare("SELECT value FROM settings WHERE key = 'upload_enabled'").get();
  if (uploadEnabled?.value === 'false') {
    return res.status(403).json({ error: 'Uploads are currently disabled' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const userAgent = req.headers['user-agent'] || '';
  const results = [];

  for (const file of req.files) {
    const ext = path.extname(file.originalname).toLowerCase();
    let mimetype = EXTENSION_MIMETYPES[ext] || file.mimetype;
    let originalName = file.originalname;
    let storedFilename = file.filename;
    let storedFilePath = file.path;
    const isImage = mimetype.startsWith('image/');
    let exifData = null;

    if (isImage) {
      // Detect true format from file bytes — iOS/macOS Safari converts images to HEIC on upload
      const detected = await detectImageFormat(storedFilePath);

      if (detected && detected.mime === 'image/heic') {
        // Convert HEIC → JPEG using heic-convert
        const jpegFilename = storedFilename.replace(/\.[^.]+$/, '.jpg');
        const jpegPath = path.join(ORIGINALS_DIR, jpegFilename);
        try {
          const heicConvert = require('heic-convert');
          const inputBuffer = fs.readFileSync(storedFilePath);
          console.log(`[upload] HEIC conversion starting: ${storedFilename} (${inputBuffer.length} bytes)`);

          let outputBuffer;
          // Support both heic-convert v1 (returns ArrayBuffer) and v2 (.one() method)
          if (typeof heicConvert.one === 'function') {
            outputBuffer = await heicConvert.one({ buffer: inputBuffer, toType: 'image/jpeg', quality: 0.92 });
          } else {
            const fn = typeof heicConvert === 'function' ? heicConvert : heicConvert.default;
            const result = await fn({ buffer: inputBuffer, format: 'JPEG', quality: 0.9 });
            // v1 returns ArrayBuffer, v2 might return Buffer or { buffer }
            outputBuffer = result?.buffer ?? result;
          }

          const outBuf = Buffer.isBuffer(outputBuffer) ? outputBuffer : Buffer.from(outputBuffer);
          console.log(`[upload] HEIC conversion output: ${outBuf.length} bytes`);

          fs.writeFileSync(jpegPath, outBuf);
          try { fs.unlinkSync(storedFilePath); } catch { /* already gone */ }
          storedFilename = jpegFilename;
          storedFilePath = jpegPath;
          mimetype = 'image/jpeg';
          const origExt = path.extname(originalName).toLowerCase();
          originalName = path.basename(originalName, origExt) + '.jpg';
          console.log(`[upload] HEIC conversion succeeded → ${storedFilename}`);
        } catch (err) {
          console.error(`[upload] HEIC conversion failed: ${err.message}`);
          mimetype = 'image/heic';
        }
      } else if (detected) {
        // For non-HEIC mismatches just correct the MIME type and extension label
        mimetype = detected.mime;
        const origExt = path.extname(originalName).toLowerCase();
        const sameFamily =
          (detected.mime === 'image/jpeg' && (origExt === '.jpg' || origExt === '.jpeg'));
        if (!sameFamily && origExt !== detected.ext) {
          originalName = path.basename(originalName, origExt) + detected.ext;
        }
      }

      exifData = await extractExif(storedFilePath);
      await generateThumbnail(storedFilePath, storedFilename);
    }

    const result = db.prepare(`
      INSERT INTO media (filename, original_name, mimetype, size, user_agent, exif_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      storedFilename,
      originalName,
      mimetype,
      file.size,
      userAgent,
      exifData ? JSON.stringify(exifData) : null,
    );

    results.push({ id: result.lastInsertRowid, name: file.originalname });
  }

  res.json({ success: true, uploaded: results.length, files: results });
});

// Handle multer errors
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes('not allowed')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
