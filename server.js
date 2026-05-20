try {
  require('dotenv').config();
} catch (e) {
  // dotenv is only needed for local development
}
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const admin = require('firebase-admin'); // Re-add Firebase Admin
const cors = require('cors'); // Keep cors
const cloudinary = require('cloudinary').v2;
const jwt = require('jsonwebtoken');

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

// Firebase Admin Setup
let db;
let firebaseInitErrorMessage = ""; // Stores specific error message if Firebase init fails

function initializeFirebase() {
  // If Firebase Admin SDK is already initialized, return its firestore instance
  if (admin.apps.length) {
    try {
      if (db) return db;
      db = admin.firestore();
      return db;
    } catch (e) {
      return null;
    }
  }

  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

  if (!FIREBASE_PROJECT_ID) { firebaseInitErrorMessage = "FIREBASE_PROJECT_ID is missing from Vercel Environment Variables."; console.error("Firebase Init Error:", firebaseInitErrorMessage); return null; }
  if (!FIREBASE_CLIENT_EMAIL) { firebaseInitErrorMessage = "FIREBASE_CLIENT_EMAIL is missing from Vercel Environment Variables."; console.error("Firebase Init Error:", firebaseInitErrorMessage); return null; }
  if (!FIREBASE_PRIVATE_KEY) { firebaseInitErrorMessage = "FIREBASE_PRIVATE_KEY is missing from Vercel Environment Variables."; console.error("Firebase Init Error:", firebaseInitErrorMessage); return null; }

  try {
    // Remove potential surrounding quotes and handle escaped newlines (\n)
    const privateKeyFormatted = FIREBASE_PRIVATE_KEY.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert({ projectId: FIREBASE_PROJECT_ID, clientEmail: FIREBASE_CLIENT_EMAIL, privateKey: privateKeyFormatted }) });
    db = admin.firestore(); // Assign to global db variable
    console.log("Firebase Admin SDK initialized successfully.");
    return db;
  } catch (err) {
    firebaseInitErrorMessage = `Firebase Admin SDK initialization failed: ${err.message}. Please check FIREBASE_PRIVATE_KEY format and content in Vercel Environment Variables.`;
    console.error("Firebase Init Error:", firebaseInitErrorMessage);
    return null;
  }
}
db = initializeFirebase(); // Attempt initialization at startup

// Multer Memory Storage for Cloudinary streaming
// We use memory storage because Vercel's serverless functions don't have persistent local storage.
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
    const database = db || initializeFirebase(); // Re-attempt initialization if db is null
    if (!database) return res.status(503).json({ error: firebaseInitErrorMessage || 'Database connection is not ready. Ensure ALL FIREBASE keys are set correctly in Vercel Settings.' });
    const snapshot = await database.collection('notes').where('published', '==', true).get();
    const notes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ notes });
  } catch (err) {
    console.error("Error fetching notes:", err);
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
    const database = db || initializeFirebase();
    if (!database) return res.status(503).json({ error: firebaseInitErrorMessage || 'Database connection is not ready. Ensure ALL FIREBASE keys are set correctly in Vercel Settings.' });
    const snapshot = await database.collection('notes').get();
    const notes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ notes });
  } catch (err) {
    console.error("Error fetching staff notes:", err);
    res.status(500).json({ error: 'Firestore error: ' + err.message });
  }
});

app.post('/api/staff/notes', authMiddleware, upload.single('pdf'), async (req, res) => {
  try {
    const database = db || initializeFirebase(); // Re-attempt initialization if db is null
    if (!database) return res.status(503).json({ error: firebaseInitErrorMessage || 'Database connection is not ready. Ensure ALL FIREBASE keys are set correctly in Vercel Settings.' });
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
    const database = db || initializeFirebase(); // Re-attempt initialization if db is null
    if (!database) return res.status(503).json({ error: firebaseInitErrorMessage || 'Database connection is not ready. Ensure ALL FIREBASE keys are set correctly in Vercel Settings.' });
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
    const database = db || initializeFirebase(); // Re-attempt initialization if db is null
    if (!database) return res.status(503).json({ error: firebaseInitErrorMessage || 'Database connection is not ready. Ensure ALL FIREBASE keys are set correctly in Vercel Settings.' });
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
