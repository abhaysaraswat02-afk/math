require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;
const jwt = require('jsonwebtoken');

// Firebase Admin Setup
let db;

function getDb() {
  if (db) return db;
  try {
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
    if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
      return null;
    }
    if (!admin.apps.length) {
      const pk = FIREBASE_PRIVATE_KEY.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: FIREBASE_PROJECT_ID,
          clientEmail: FIREBASE_CLIENT_EMAIL,
          privateKey: pk,
        })
      });
    }
    db = admin.firestore();
    return db;
  } catch (err) {
    console.error("Firebase init error:", err.message);
    return null;
  }
}

// Initial attempt
getDb();

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
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(cors());
app.use(express.json());

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
    const database = getDb();
    if (!database) return res.status(503).json({ error: 'Database connection is not ready. Ensure FIREBASE keys are set in Vercel Settings.' });
    const snapshot = await database.collection('notes').where('published', '==', true).get();
    const notes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ notes });
  } catch (err) {
    res.status(500).json({ error: 'Firestore error: ' + err.message });
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
    const database = getDb();
    if (!database) return res.status(503).json({ error: 'Database connection is not ready.' });
    const snapshot = await database.collection('notes').get();
    const notes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ notes });
  } catch (err) {
    res.status(500).json({ error: 'Firestore error: ' + err.message });
  }
});

app.post('/api/staff/notes', authMiddleware, upload.single('pdf'), async (req, res) => {
  try {
    const database = getDb();
    if (!database) throw new Error("Database not initialized");
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
    const docRef = await database.collection('notes').add(note);
    res.status(201).json({ id: docRef.id, ...note });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/staff/notes/:id', authMiddleware, upload.single('pdf'), async (req, res) => {
  try {
    const database = getDb();
    if (!database) throw new Error("Database not initialized");
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

    await database.collection('notes').doc(id).update(updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/staff/notes/:id', authMiddleware, async (req, res) => {
  try {
    const database = getDb();
    if (!database) throw new Error("Database not initialized");
    await database.collection('notes').doc(req.params.id).delete();
    res.json({ success: true });
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
