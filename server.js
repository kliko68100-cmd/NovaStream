const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Trop de requêtes, réessaie dans 15 minutes.' }
});
app.use('/api/', limiter);

const TMDB_KEY   = process.env.TMDB_KEY;
const TMDB_API   = 'https://api.themoviedb.org/3';
const FREMBED_API = process.env.FREMBED_API || 'https://frembed.one/api/public';
const MANGADEX_API = 'https://api.mangadex.org';

if (!TMDB_KEY) { console.error('❌ TMDB_KEY manquant !'); process.exit(1); }

// ── HELPERS ────────────────────────────────────────────────
async function tmdbFetch(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${TMDB_API}${path}${sep}api_key=${TMDB_KEY}&language=fr-FR`;
  const res = await fetch(url, { timeout: 12000 });
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${res.statusText}`);
  return res.json();
}

async function frembedFetch(path) {
  const res = await fetch(`${FREMBED_API}${path}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      'Referer': 'https://frembed.one/',
      'Origin': 'https://frembed.one'
    },
    timeout: 12000
  });
  if (!res.ok) throw new Error(`Frembed ${res.status}`);
  return res.json();
}

async function mdFetch(path) {
  const res = await fetch(`${MANGADEX_API}${path}`, { timeout: 12000 });
  if (!res.ok) throw new Error(`MangaDex ${res.status}`);
  return res.json();
}

// ── TRENDING ───────────────────────────────────────────────
app.get('/api/trending/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1 } = req.query;
    res.json(await tmdbFetch(`/trending/${type}/week?page=${page}`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── POPULAR ────────────────────────────────────────────────
app.get('/api/popular/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1 } = req.query;
    res.json(await tmdbFetch(`/${type}/popular?page=${page}`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── TOP RATED ──────────────────────────────────────────────
app.get('/api/toprated/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1 } = req.query;
    res.json(await tmdbFetch(`/${type}/top_rated?page=${page}`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── NOW PLAYING (films au cinéma) ──────────────────────────
app.get('/api/nowplaying', async (req, res) => {
  try {
    const { page = 1 } = req.query;
    res.json(await tmdbFetch(`/movie/now_playing?page=${page}`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── ON THE AIR (séries en cours) ───────────────────────────
app.get('/api/onair', async (req, res) => {
  try {
    const { page = 1 } = req.query;
    res.json(await tmdbFetch(`/tv/on_the_air?page=${page}`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── ANIME (découverte animation japonaise avec genre filter) ─
// Genres TMDB TV : 10759=Action&Adventure, 35=Comedy, 80=Crime, 18=Drama,
// 10751=Family, 10762=Kids, 9648=Mystery, 10765=Sci-Fi&Fantasy, 10766=Soap,
// 10767=Talk, 10768=War&Politics, 37=Western
app.get('/api/anime', async (req, res) => {
  try {
    const { page = 1, genre = '' } = req.query;
    let path = `/discover/tv?with_genres=16&sort_by=popularity.desc&page=${page}&with_original_language=ja`;
    if (genre && genre !== '16') path += `&with_genres=16,${genre}`;
    res.json(await tmdbFetch(path));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── SEARCH ─────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  try {
    const { q, type = 'multi', page = 1 } = req.query;
    if (!q) return res.json({ results: [] });
    res.json(await tmdbFetch(`/search/${type}?query=${encodeURIComponent(q)}&page=${page}&include_adult=false`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── DETAILS ────────────────────────────────────────────────
app.get('/api/details/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    res.json(await tmdbFetch(`/${type}/${id}?append_to_response=credits,videos,similar,external_ids`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GENRES ─────────────────────────────────────────────────
app.get('/api/genres/:type', async (req, res) => {
  try {
    const { type } = req.params;
    res.json(await tmdbFetch(`/genre/${type}/list`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SEASON DETAILS (épisodes + synopsis) ───────────────────
app.get('/api/season/:showId/:season', async (req, res) => {
  try {
    const { showId, season } = req.params;
    res.json(await tmdbFetch(`/tv/${showId}/season/${season}`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── EPISODE DETAILS ────────────────────────────────────────
app.get('/api/episode/:showId/:season/:ep', async (req, res) => {
  try {
    const { showId, season, ep } = req.params;
    res.json(await tmdbFetch(`/tv/${showId}/season/${season}/episode/${ep}`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SOURCES (Frembed) ──────────────────────────────────────
app.get('/api/sources/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type = 'movie', s, e } = req.query;
    let path = `/sources/${id}?type=${type}`;
    if (s && e) path += `&s=${s}&e=${e}`;
    const data = await frembedFetch(path);
    res.json({
      sources:   data.sources   || [],
      subtitles: data.subtitles || [],
      headers:   { referer: 'https://frembed.one/' }
    });
  } catch (e) {
    console.error('[sources]', e.message);
    res.status(500).json({ error: 'Sources Frembed indisponibles', sources: [] });
  }
});

// ── MANGADEX — liste ───────────────────────────────────────
app.get('/api/manga/list', async (req, res) => {
  try {
    const { limit = 20, offset = 0, lang = 'fr' } = req.query;
    const data = await mdFetch(
      `/manga?limit=${limit}&offset=${offset}&order[followedCount]=desc&includes[]=cover_art&availableTranslatedLanguage[]=${lang}&availableTranslatedLanguage[]=en`
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MANGADEX — recherche ───────────────────────────────────
app.get('/api/manga/search', async (req, res) => {
  try {
    const { q = '', lang = 'fr' } = req.query;
    const data = await mdFetch(
      `/manga?limit=20&title=${encodeURIComponent(q)}&order[followedCount]=desc&includes[]=cover_art&availableTranslatedLanguage[]=${lang}&availableTranslatedLanguage[]=en`
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MANGADEX — chapitres ───────────────────────────────────
app.get('/api/manga/chapters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await mdFetch(
      `/manga/${id}/feed?limit=500&order[volume]=asc&order[chapter]=asc&translatedLanguage[]=fr&translatedLanguage[]=en&includes[]=scanlation_group`
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MANGADEX — pages ───────────────────────────────────────
app.get('/api/manga/pages/:chapId', async (req, res) => {
  try {
    const { chapId } = req.params;
    res.json(await mdFetch(`/at-home/server/${chapId}`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HEALTH ─────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  version: '3.0.0',
  timestamp: new Date().toISOString(),
  frembed: FREMBED_API
}));

// ── 404 ────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route introuvable' }));

// ── ERROR ──────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Erreur globale:', err.message);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// ── START ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 NovaStream API v3.0 — port ${PORT}`);
  console.log(`📡 TMDB_KEY : ${TMDB_KEY ? '✅ chargée' : '❌ MANQUANTE'}`);
  console.log(`🎬 Frembed  : ${FREMBED_API}`);
  console.log(`🌐 Frontend : ${process.env.FRONTEND_URL || '* (tous)'}`);
});

module.exports = app;
