require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const jwt = require('jsonwebtoken');

const DATA_PATH = path.join(__dirname, 'data', 'notes-db.json');

// Cloudinary Setup
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'era1234';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const PORT = process.env.PORT || 3000;

// Multer Memory Storage for Cloudinary streaming
// We use memory storage because Vercel's serverless functions don't have persistent local storage.
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(cors());
app.use(express.json());

// Helper functions for local JSON data
function loadNotesData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return { notes: [] };
  }
}
function saveNotesData(data) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true }); // Ensure directory exists
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/staff.html', (req, res) => res.sendFile(path.join(__dirname, 'staff.html')));

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.get('/api/notes', async (req, res) => {
  try {
    const data = loadNotesData();
    const notes = (data.notes || []).filter(n => n.published !== false);
    res.json({ notes });
  } catch (err) {
    console.error("Error fetching notes:", err);
    res.status(500).json({ error: 'Failed to fetch notes from local data store.' });
  }
});

app.post('/api/staff/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ user: username }, JWT_SECRET, { expiresIn: '1h' });
    return res.json({ token, expiresIn: 3600 });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/api/staff/notes', authMiddleware, async (req, res) => {
  try {
    const data = loadNotesData();
    const notes = data.notes || [];
    res.json({ notes });
  } catch (err) {
    console.error("Error fetching staff notes:", err);
    res.status(500).json({ error: 'Failed to fetch staff notes from local data store.' });
  }
});

app.post('/api/staff/notes', authMiddleware, upload.single('pdf'), async (req, res) => {
  try {
    const data = loadNotesData();
    const note = { ...req.body };
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { resource_type: 'raw', folder: 'notes' },
          (error, result) => { if (error) reject(error); else resolve(result); }
        );
        uploadStream.end(req.file.buffer);
      });
      note.pdfUrl = result.secure_url;
    }
    note.published = note.published === 'true';
    note.originalPrice = note.originalPrice ? Number(note.originalPrice) : null;
    note.price = Number(note.price);
    note.id = String(Date.now()); // Generate a simple ID
    data.notes = [note, ...(data.notes || [])]; // Add new note to the beginning
    saveNotesData(data);
    res.status(201).json({ id: note.id, ...note });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/staff/notes/:id', authMiddleware, upload.single('pdf'), async (req, res) => {
  try {
    const data = loadNotesData();
    const id = req.params.id;
    const updates = { ...req.body };
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { resource_type: 'raw', folder: 'notes' },
          (error, result) => { if (error) reject(error); else resolve(result); }
        );
        uploadStream.end(req.file.buffer);
      });
      updates.pdfUrl = result.secure_url;
    }
    
    if (Object.prototype.hasOwnProperty.call(updates, 'published')) {
      updates.published = String(updates.published) === 'true';
    }
    if (updates.price) updates.price = Number(updates.price);
    if (updates.originalPrice) updates.originalPrice = Number(updates.originalPrice);

    const index = (data.notes || []).findIndex(item => item.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Note not found' });
    }
    data.notes[index] = { ...data.notes[index], ...updates };
    saveNotesData(data);
    res.json({ note: data.notes[index] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/staff/notes/:id', authMiddleware, async (req, res) => {
  try {
    const data = loadNotesData();
    const id = req.params.id;
    const index = (data.notes || []).findIndex(item => item.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const removed = data.notes.splice(index, 1)[0];
    saveNotesData(data);
    res.json({ note: removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Era of Mathantics (Jay Chaudhary) server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
