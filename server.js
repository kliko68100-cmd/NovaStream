const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// ============ SECURITY ============
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());

// ============ CORS ============
// Accepte le domaine Vercel + localhost en dev
const allowedOrigins = [
  process.env.FRONTEND_URL,          // ex: https://novastream.vercel.app
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
].filter(Boolean);

app.use(cors({ origin: '*' }));
app.use(express.json());
// ============ RATE LIMIT ============
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 150,
  message: { error: 'Trop de requêtes, réessaie dans 15 minutes.' }
});
app.use('/api/', limiter);

// ============ VARIABLES (depuis .env uniquement) ============
const TMDB_KEY = process.env.TMDB_KEY;
const TMDB_API = 'https://api.themoviedb.org/3';
const FREMBED_API = process.env.FREMBED_API || 'https://frembed.one/api/public';
const MANGADEX_API = 'https://api.mangadex.org';

if (!TMDB_KEY) {
  console.error('❌ TMDB_KEY manquant dans .env !');
  process.exit(1);
}

// ============ HELPERS ============
async function tmdbFetch(path) {
  const url = `${TMDB_API}${path}${path.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}&language=fr-FR`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${res.statusText}`);
  return res.json();
}

async function frembedFetch(path, extraHeaders = {}) {
  const res = await fetch(`${FREMBED_API}${path}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'fr-FR,fr;q=0.9',
      'Referer': 'https://frembed.one/',
      'Origin': 'https://frembed.one',
      'DNT': '1',
      ...extraHeaders
    }
  });
  if (!res.ok) throw new Error(`Frembed ${res.status}`);
  return res.json();
}

// ============ ROUTES TMDB ============

// GET /api/trending/:type  → movie | tv | all
app.get('/api/trending/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1 } = req.query;
    const data = await tmdbFetch(`/trending/${type}/week?page=${page}`);
    res.json(data);
  } catch (err) {
    console.error('[trending]', err.message);
    res.status(500).json({ error: 'Erreur TMDB trending', results: [] });
  }
});

// GET /api/popular/:type  → movie | tv | person
app.get('/api/popular/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1 } = req.query;
    const data = await tmdbFetch(`/${type}/popular?page=${page}`);
    res.json(data);
  } catch (err) {
    console.error('[popular]', err.message);
    res.status(500).json({ error: 'Erreur TMDB popular', results: [] });
  }
});

// GET /api/search?q=...&type=all
app.get('/api/search', async (req, res) => {
  try {
    const { q, type = 'multi', page = 1 } = req.query;
    if (!q) return res.json({ results: [] });

    // Recherche TMDB (multi = films + séries + personnes)
    const data = await tmdbFetch(`/search/${type}?query=${encodeURIComponent(q)}&page=${page}&include_adult=false`);
    res.json(data);
  } catch (err) {
    console.error('[search]', err.message);
    res.status(500).json({ error: 'Erreur recherche', results: [] });
  }
});

// GET /api/details/movie/:id  ou  /api/details/tv/:id
app.get('/api/details/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const data = await tmdbFetch(`/${type}/${id}?append_to_response=credits,videos,similar`);
    res.json(data);
  } catch (err) {
    console.error('[details]', err.message);
    res.status(500).json({ error: 'Erreur détails' });
  }
});

// ============ ROUTES SOURCES (Frembed) ============

// GET /api/sources/:id?type=movie|tv&s=1&e=1
app.get('/api/sources/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type = 'movie', s, e } = req.query;

    let path = `/sources/${id}?type=${type}`;
    if (s && e) path += `&s=${s}&e=${e}`;

    const data = await frembedFetch(path);

    res.json({
      sources: data.sources || [],
      subtitles: data.subtitles || [],
      headers: { referer: 'https://frembed.one/' }
    });
  } catch (err) {
    console.error('[sources]', err.message);
    res.status(500).json({ error: 'Erreur sources', sources: [] });
  }
});

// ============ ROUTES MANGADEX ============

// GET /api/manga/search?q=...
app.get('/api/manga/search', async (req, res) => {
  try {
    const { q = '' } = req.query;
    const url = `${MANGADEX_API}/manga?limit=20&title=${encodeURIComponent(q)}&order[followedCount]=desc`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (err) {
    console.error('[manga/search]', err.message);
    res.status(500).json({ error: 'Erreur MangaDex', data: [] });
  }
});

// GET /api/manga/chapters/:id
app.get('/api/manga/chapters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const url = `${MANGADEX_API}/manga/${id}/feed?limit=100&order[chapter]=desc&translatedLanguage[]=fr&translatedLanguage[]=en`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (err) {
    console.error('[manga/chapters]', err.message);
    res.status(500).json({ error: 'Erreur chapitres' });
  }
});

// GET /api/manga/pages/:chapId
app.get('/api/manga/pages/:chapId', async (req, res) => {
  try {
    const { chapId } = req.params;
    const url = `${MANGADEX_API}/at-home/server/${chapId}`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (err) {
    console.error('[manga/pages]', err.message);
    res.status(500).json({ error: 'Erreur pages' });
  }
});

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: '2.0.0'
}));

// ============ 404 ============
app.use((req, res) => res.status(404).json({ error: 'Route introuvable' }));

// ============ ERROR HANDLER ============
app.use((err, req, res, next) => {
  console.error('Erreur globale:', err.message);
  if (err.message.startsWith('CORS')) {
    return res.status(403).json({ error: err.message });
  }
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// ============ START ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 NovaStream API démarrée sur le port ${PORT}`);
  console.log(`📡 TMDB_KEY: ${TMDB_KEY ? '✅ chargée' : '❌ MANQUANTE'}`);
  console.log(`🔗 FREMBED_API: ${FREMBED_API}`);
  console.log(`🌐 Frontend autorisé: ${process.env.FRONTEND_URL || '* (tous)'}`);
});

module.exports = app;
