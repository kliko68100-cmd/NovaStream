const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// SECURITY
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json());

// RATE LIMIT
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Trop de requêtes, essaie plus tard'
});
app.use(limiter);

// ============ VARIABLES ============
const FREMBED_API = 'https://frembed.one/api/public';
const TMDB_KEY = 'b57c7a8b5c1436d6f4d2cfff87e08ef5';
const TMDB_API = 'https://api.themoviedb.org/3';
const MANGADEX_API = 'https://api.mangadex.org';

// ============ PROXY ROUTES ============

// Proxy pour contourner CORS & adblock detection
app.get('/api/search', async (req, res) => {
  try {
    const { q, type = 'all' } = req.query;
    if (!q) return res.json({ results: [] });

    const data = await fetch(
      `${FREMBED_API}/search?query=${encodeURIComponent(q)}&type=${type}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://frembed.one/'
        }
      }
    ).then(r => r.json());

    res.json(data);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Erreur de recherche' });
  }
});

// Get movie/serie details
app.get('/api/details/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await fetch(`${FREMBED_API}/info/${id}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur détails' });
  }
});

// Get sources (ANTI-ADBLOCK)
app.get('/api/sources/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { s, e } = req.query;

    // Requête avec headers qui contournent la détection adblock
    const headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'fr-FR,fr;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://frembed.one/',
      'Origin': 'https://frembed.one'
    };

    let url = `${FREMBED_API}/sources/${id}`;
    if (s && e) url += `?s=${s}&e=${e}`;

    const response = await fetch(url, { headers });
    const data = await response.json();

    // Clean response
    res.json({
      sources: data.sources || [],
      subtitles: data.subtitles || [],
      headers: {
        referer: 'https://frembed.one/'
      }
    });
  } catch (err) {
    console.error('Sources error:', err);
    res.status(500).json({ error: 'Erreur sources', sources: [] });
  }
});

// TMDB Proxy (trending)
app.get('/api/trending/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1 } = req.query;
    const url = `${TMDB_API}/trending/${type}/week?api_key=${TMDB_KEY}&language=fr-FR&page=${page}`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur TMDB' });
  }
});

// Popular
app.get('/api/popular/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1 } = req.query;
    const url = `${TMDB_API}/${type}/popular?api_key=${TMDB_KEY}&language=fr-FR&page=${page}`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur TMDB' });
  }
});

// MangaDex Proxy
app.get('/api/manga/search', async (req, res) => {
  try {
    const { q } = req.query;
    const url = `${MANGADEX_API}/manga?limit=20&title=${encodeURIComponent(q || '')}`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur MangaDex' });
  }
});

app.get('/api/manga/chapters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const url = `${MANGADEX_API}/manga/${id}/feed?limit=1&order[chapter]=desc&translatedLanguage[]=fr&translatedLanguage[]=en`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur chapitres' });
  }
});

app.get('/api/manga/pages/:chapId', async (req, res) => {
  try {
    const { chapId } = req.params;
    const url = `${MANGADEX_API}/at-home/server/${chapId}`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur pages' });
  }
});

// Static files
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 NovaStream server sur port ${PORT}`));

module.exports = app;
