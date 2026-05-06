const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// ================= SECURITY =================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json());

// ================= RATE LIMIT =================
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Trop de requêtes, essaie plus tard' }
}));

// ================= VARIABLES =================
const FREMBED_API = 'https://frembed.one/api/public';
const TMDB_KEY = process.env.TMDB_KEY;
const TMDB_API = 'https://api.themoviedb.org/3';
const MANGADEX_API = 'https://api.mangadex.org';

// ================= HOME ROUTE =================
app.get('/', (req, res) => {
  res.send('🚀 NovaStream API is running');
});

// ================= HEALTH =================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// ================= SEARCH =================
app.get('/api/search', async (req, res) => {
  try {
    const { q, type = 'all' } = req.query;
    if (!q) return res.json({ results: [] });

    const data = await fetch(
      `${FREMBED_API}/search?query=${encodeURIComponent(q)}&type=${type}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
          'Referer': 'https://frembed.one/'
        }
      }
    ).then(r => r.json());

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search error' });
  }
});

// ================= DETAILS =================
app.get('/api/details/:id', async (req, res) => {
  try {
    const data = await fetch(`${FREMBED_API}/info/${req.params.id}`)
      .then(r => r.json());

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Details error' });
  }
});

// ================= SOURCES =================
app.get('/api/sources/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { s, e } = req.query;

    let url = `${FREMBED_API}/sources/${id}`;
    if (s && e) url += `?s=${s}&e=${e}`;

    const data = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://frembed.one/'
      }
    }).then(r => r.json());

    res.json({
      sources: data.sources || [],
      subtitles: data.subtitles || []
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sources error' });
  }
});

// ================= TMDB TRENDING =================
app.get('/api/trending/:type', async (req, res) => {
  try {
    const url = `${TMDB_API}/trending/${req.params.type}/week?api_key=${TMDB_KEY}&language=fr-FR`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'TMDB error' });
  }
});

// ================= TMDB POPULAR =================
app.get('/api/popular/:type', async (req, res) => {
  try {
    const url = `${TMDB_API}/${req.params.type}/popular?api_key=${TMDB_KEY}&language=fr-FR`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'TMDB error' });
  }
});

// ================= MANGA SEARCH =================
app.get('/api/manga/search', async (req, res) => {
  try {
    const url = `${MANGADEX_API}/manga?limit=20&title=${encodeURIComponent(req.query.q || '')}`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Manga error' });
  }
});

// ================= 404 =================
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 NovaStream running on port ${PORT}`);
});

module.exports = app;