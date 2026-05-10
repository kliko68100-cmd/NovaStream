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

const TMDB_KEY    = process.env.TMDB_KEY;
const TMDB_API    = 'https://api.themoviedb.org/3';
const FREMBED_API = process.env.FREMBED_API || 'https://frembed.one/api/public';
const MANGADEX_API = 'https://api.mangadex.org';

if (!TMDB_KEY) { console.error('❌ TMDB_KEY manquant !'); process.exit(1); }

// ── HELPERS ────────────────────────────────────────────────
async function tmdbFetch(path, lang = 'fr-FR') {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${TMDB_API}${path}${sep}api_key=${TMDB_KEY}&language=${lang}`;
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

// ── NOW PLAYING ────────────────────────────────────────────
app.get('/api/nowplaying', async (req, res) => {
  try {
    const { page = 1 } = req.query;
    res.json(await tmdbFetch(`/movie/now_playing?page=${page}`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── ON THE AIR ─────────────────────────────────────────────
app.get('/api/onair', async (req, res) => {
  try {
    const { page = 1 } = req.query;
    res.json(await tmdbFetch(`/tv/on_the_air?page=${page}`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── ANIME ──────────────────────────────────────────────────
app.get('/api/anime', async (req, res) => {
  try {
    const { page = 1, genre = '' } = req.query;
    const genreFilter = genre ? `16,${genre}` : '16';
    const path = `/discover/tv?with_genres=${genreFilter}&sort_by=popularity.desc&page=${page}&with_original_language=ja`;
    res.json(await tmdbFetch(path));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── DISCOVER (Films & Séries par genre) ───────────────────
// Supporte : /api/discover/movie?with_genres=28&page=1&sort_by=popularity.desc
//            /api/discover/tv?with_genres=18&page=2
app.get('/api/discover/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const {
      with_genres = '',
      page = 1,
      sort_by = 'popularity.desc',
      with_original_language = '',
      year = ''
    } = req.query;

    if (!['movie', 'tv'].includes(type)) {
      return res.status(400).json({ error: 'Type invalide. Utilise movie ou tv.' });
    }

    let path = `/discover/${type}?sort_by=${sort_by}&page=${page}`;
    if (with_genres)           path += `&with_genres=${with_genres}`;
    if (with_original_language) path += `&with_original_language=${with_original_language}`;
    if (year && type === 'movie') path += `&primary_release_year=${year}`;
    if (year && type === 'tv')   path += `&first_air_date_year=${year}`;

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

// ── SEASON DETAILS ─────────────────────────────────────────
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

// ── SOURCES (Frembed) — avec support langue VF/VOSTFR ─────
// lang = 'vf' (défaut) | 'vostfr'
// Frembed expose un paramètre `lang` : fr = VF, fr-sub = VOSTFR
app.get('/api/sources/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type = 'movie', s, e, lang = 'vf' } = req.query;

    // Mapping langue -> paramètre Frembed
    // 'vf'     -> on demande la piste audio française
    // 'vostfr' -> on demande la VO avec sous-titres français
    const frembedLang = lang === 'vostfr' ? 'vostfr' : 'vf';

    let path = `/sources/${id}?type=${type}&lang=${frembedLang}`;
    if (s && e) path += `&s=${s}&e=${e}`;

    let data;
    try {
      data = await frembedFetch(path);
    } catch (frembedErr) {
      // Si la langue demandée échoue, on réessaie sans filtre langue
      console.warn(`[sources] Frembed ${frembedLang} indisponible, fallback sans filtre…`);
      let fallbackPath = `/sources/${id}?type=${type}`;
      if (s && e) fallbackPath += `&s=${s}&e=${e}`;
      data = await frembedFetch(fallbackPath);
    }

    // Filtrage des sources : on exclut les sources en anglais pur (VO)
    // si l'utilisateur demande VF ou VOSTFR
    let sources = data.sources || [];
    let subtitles = data.subtitles || [];

    if (lang === 'vostfr') {
      // VOSTFR : on garde les sous-titres français, on filtre si possible
      subtitles = subtitles.filter(sub =>
        sub.lang?.toLowerCase().includes('fr') ||
        sub.language?.toLowerCase().includes('fr') ||
        sub.label?.toLowerCase().includes('fr') ||
        sub.label?.toLowerCase().includes('vostfr') ||
        sub.label?.toLowerCase().includes('français')
      );
    }

    // Exclure les sources labellisées explicitement comme VO anglais
    sources = sources.filter(src => {
      const label = (src.label || src.quality || '').toLowerCase();
      return !label.includes('english only') && !label.includes(' en ') && label !== 'en';
    });

    res.json({
      sources,
      subtitles,
      lang: frembedLang,
      headers: { referer: 'https://frembed.one/' }
    });
  } catch (e) {
    console.error('[sources]', e.message);
    res.status(500).json({ error: 'Sources Frembed indisponibles', sources: [], subtitles: [] });
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
  version: '3.1.0',
  timestamp: new Date().toISOString(),
  frembed: FREMBED_API,
  features: ['discover', 'genre-filter', 'vf-vostfr', 'manga']
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
  console.log(`🚀 NovaStream API v3.1 — port ${PORT}`);
  console.log(`📡 TMDB_KEY  : ${TMDB_KEY ? '✅ chargée' : '❌ MANQUANTE'}`);
  console.log(`🎬 Frembed   : ${FREMBED_API}`);
  console.log(`🌐 Features  : discover/genre, VF/VOSTFR, manga`);
});

module.exports = app;
