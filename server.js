const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
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

const TMDB_KEY     = process.env.TMDB_KEY;
const TMDB_API     = 'https://api.themoviedb.org/3';
const FREMBED_API  = process.env.FREMBED_API || 'https://frembed.one/api/public';
const MANGADEX_API = 'https://api.mangadex.org';

if (!TMDB_KEY) { console.error('❌ TMDB_KEY manquant !'); process.exit(1); }

// ── SERVE STATIC FILES (index.html + sw.js) ──────────────────
// Si index.html et sw.js sont dans le même dossier que server.js
app.get('/', (req, res) => {
  const f = path.join(__dirname, 'index.html');
  res.sendFile(f, err => { if (err) res.status(404).json({ error: 'index.html introuvable' }); });
});

// Service Worker servi depuis la racine (même origine = essentiel)
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache');
  const f = path.join(__dirname, 'sw.js');
  res.sendFile(f, err => {
    if (err) {
      // SW fallback inline si fichier absent
      res.send(`
        const AD_HOSTS=['doubleclick.net','googlesyndication.com','adnxs.com',
          'popads.net','popcash.net','trafficjunky.net','juicyads.com',
          'exoclick.com','adsterra.com','propellerads.com','hilltopads.net',
          'pornhub.com','traffic.js','ads.js','adserver','banner','pagead'];
        self.addEventListener('fetch', e => {
          try {
            const u = new URL(e.request.url);
            if(AD_HOSTS.some(h => u.hostname.includes(h) || u.pathname.includes(h)))
              return e.respondWith(new Response('',{status:204}));
          } catch(_) {}
        });
        self.addEventListener('install', () => self.skipWaiting());
        self.addEventListener('activate', e => e.waitUntil(clients.claim()));
      `);
    }
  });
});

// ── HELPERS ────────────────────────────────────────────────────
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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
  const res = await fetch(`${MANGADEX_API}${path}`, {
    headers: { 'User-Agent': 'NovaStream/3.2 (contact@novastream.fr)' },
    timeout: 14000
  });
  if (!res.ok) throw new Error(`MangaDex ${res.status}`);
  return res.json();
}

// ── TRENDING ───────────────────────────────────────────────────
app.get('/api/trending/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1 } = req.query;
    res.json(await tmdbFetch(`/trending/${type}/week?page=${page}`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── POPULAR ────────────────────────────────────────────────────
app.get('/api/popular/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1 } = req.query;
    res.json(await tmdbFetch(`/${type}/popular?page=${page}`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── TOP RATED ──────────────────────────────────────────────────
app.get('/api/toprated/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1 } = req.query;
    res.json(await tmdbFetch(`/${type}/top_rated?page=${page}`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── NOW PLAYING ────────────────────────────────────────────────
app.get('/api/nowplaying', async (req, res) => {
  try {
    const { page = 1 } = req.query;
    res.json(await tmdbFetch(`/movie/now_playing?page=${page}`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── ON THE AIR ─────────────────────────────────────────────────
app.get('/api/onair', async (req, res) => {
  try {
    const { page = 1 } = req.query;
    res.json(await tmdbFetch(`/tv/on_the_air?page=${page}`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── ANIME ──────────────────────────────────────────────────────
app.get('/api/anime', async (req, res) => {
  try {
    const { page = 1, genre = '' } = req.query;
    const genreFilter = genre ? `16,${genre}` : '16';
    const path = `/discover/tv?with_genres=${genreFilter}&sort_by=popularity.desc&page=${page}&with_original_language=ja`;
    res.json(await tmdbFetch(path));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── DISCOVER ───────────────────────────────────────────────────
app.get('/api/discover/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { with_genres = '', page = 1, sort_by = 'popularity.desc', with_original_language = '', year = '' } = req.query;
    if (!['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'Type invalide.' });
    let path = `/discover/${type}?sort_by=${sort_by}&page=${page}`;
    if (with_genres)            path += `&with_genres=${with_genres}`;
    if (with_original_language) path += `&with_original_language=${with_original_language}`;
    if (year && type === 'movie') path += `&primary_release_year=${year}`;
    if (year && type === 'tv')   path += `&first_air_date_year=${year}`;
    res.json(await tmdbFetch(path));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── SEARCH ─────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  try {
    const { q, type = 'multi', page = 1 } = req.query;
    if (!q) return res.json({ results: [] });
    res.json(await tmdbFetch(`/search/${type}?query=${encodeURIComponent(q)}&page=${page}&include_adult=false`));
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── DETAILS ────────────────────────────────────────────────────
app.get('/api/details/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    res.json(await tmdbFetch(`/${type}/${id}?append_to_response=credits,videos,similar,external_ids`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GENRES ─────────────────────────────────────────────────────
app.get('/api/genres/:type', async (req, res) => {
  try {
    const { type } = req.params;
    res.json(await tmdbFetch(`/genre/${type}/list`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SEASON / EPISODE ───────────────────────────────────────────
app.get('/api/season/:showId/:season', async (req, res) => {
  try {
    const { showId, season } = req.params;
    res.json(await tmdbFetch(`/tv/${showId}/season/${season}`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/episode/:showId/:season/:ep', async (req, res) => {
  try {
    const { showId, season, ep } = req.params;
    res.json(await tmdbFetch(`/tv/${showId}/season/${season}/episode/${ep}`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SOURCES (Frembed) ─────────────────────────────────────────
app.get('/api/sources/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type = 'movie', s, e, lang = 'vf' } = req.query;
    const frembedLang = lang === 'vostfr' ? 'vostfr' : 'vf';

    let data;
    // Tentative 1 : avec la langue demandée
    try {
      let path = `/sources/${id}?type=${type}&lang=${frembedLang}`;
      if (s && e) path += `&s=${s}&e=${e}`;
      data = await frembedFetch(path);
    } catch (_) {
      // Tentative 2 : sans filtre langue
      try {
        let path = `/sources/${id}?type=${type}`;
        if (s && e) path += `&s=${s}&e=${e}`;
        data = await frembedFetch(path);
      } catch (e2) {
        throw e2;
      }
    }

    let sources   = data.sources   || [];
    let subtitles = data.subtitles || [];

    // Pour VOSTFR : garder uniquement les sous-titres français
    if (lang === 'vostfr') {
      const frSubs = subtitles.filter(sub => {
        const l = (sub.lang || sub.language || sub.label || '').toLowerCase();
        return l.includes('fr') || l.includes('français') || l.includes('vostfr');
      });
      if (frSubs.length) subtitles = frSubs;
    }

    // Exclure les sources labellisées VO anglaise pure
    sources = sources.filter(src => {
      const label = (src.label || src.quality || '').toLowerCase();
      return !label.match(/\ben\b/) && !label.includes('english only');
    });

    res.json({
      sources,
      subtitles,
      lang: frembedLang,
      hasFrenchSub: subtitles.some(s => {
        const l = (s.lang || s.language || s.label || '').toLowerCase();
        return l.includes('fr') || l.includes('français');
      }),
      headers: { referer: 'https://frembed.one/' }
    });
  } catch (e) {
    console.error('[sources]', e.message);
    res.status(500).json({ error: 'Sources Frembed indisponibles', sources: [], subtitles: [] });
  }
});

// ═══════════════════════════════════════════════════════
//  MANGADEX — Endpoints améliorés
// ═══════════════════════════════════════════════════════

// Paramètres communs MangaDex
const MD_BASE_PARAMS = 'includes[]=cover_art&includes[]=author';
const MD_LANGS = 'availableTranslatedLanguage[]=fr&availableTranslatedLanguage[]=en';

// ── MANGA LIST ─────────────────────────────────────────────────
app.get('/api/manga/list', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const data = await mdFetch(
      `/manga?limit=${limit}&offset=${offset}&order[followedCount]=desc&${MD_BASE_PARAMS}&${MD_LANGS}`
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MANGA TRENDING (les plus suivis) ──────────────────────────
app.get('/api/manga/trending', async (req, res) => {
  try {
    const { limit = 30, offset = 0 } = req.query;
    const data = await mdFetch(
      `/manga?limit=${limit}&offset=${offset}&order[followedCount]=desc&${MD_BASE_PARAMS}&${MD_LANGS}`
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MANGA LATEST (dernières mises à jour) ─────────────────────
app.get('/api/manga/latest', async (req, res) => {
  try {
    const { limit = 30, offset = 0 } = req.query;
    const data = await mdFetch(
      `/manga?limit=${limit}&offset=${offset}&order[latestUploadedChapter]=desc&${MD_BASE_PARAMS}&${MD_LANGS}`
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MANGA TOP RATED ───────────────────────────────────────────
app.get('/api/manga/toprated', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const data = await mdFetch(
      `/manga?limit=${limit}&offset=${offset}&order[rating]=desc&${MD_BASE_PARAMS}&${MD_LANGS}`
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MANGA GENRES (tags) ───────────────────────────────────────
app.get('/api/manga/tags', async (req, res) => {
  try {
    const data = await mdFetch('/manga/tag');
    // Ne retourner que les genres (group = genre)
    const genres = (data.data || []).filter(t =>
      t.attributes?.group === 'genre'
    ).map(t => ({
      id: t.id,
      name: t.attributes?.name?.fr || t.attributes?.name?.en || 'Genre',
      group: t.attributes?.group
    })).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ data: genres });
  } catch (e) { res.status(500).json({ error: e.message, data: [] }); }
});

// ── MANGA BY TAG ──────────────────────────────────────────────
app.get('/api/manga/bytag/:tagId', async (req, res) => {
  try {
    const { tagId } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    const data = await mdFetch(
      `/manga?limit=${limit}&offset=${offset}&includedTags[]=${tagId}&order[followedCount]=desc&${MD_BASE_PARAMS}&${MD_LANGS}`
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MANGA SEARCH ──────────────────────────────────────────────
app.get('/api/manga/search', async (req, res) => {
  try {
    const { q = '' } = req.query;
    const data = await mdFetch(
      `/manga?limit=20&title=${encodeURIComponent(q)}&order[followedCount]=desc&${MD_BASE_PARAMS}&${MD_LANGS}`
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MANGA DETAILS ─────────────────────────────────────────────
app.get('/api/manga/details/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await mdFetch(`/manga/${id}?${MD_BASE_PARAMS}`);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MANGA CHAPTERS ────────────────────────────────────────────
app.get('/api/manga/chapters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await mdFetch(
      `/manga/${id}/feed?limit=500&order[volume]=asc&order[chapter]=asc&translatedLanguage[]=fr&translatedLanguage[]=en&includes[]=scanlation_group`
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MANGA PAGES ───────────────────────────────────────────────
app.get('/api/manga/pages/:chapId', async (req, res) => {
  try {
    const { chapId } = req.params;
    res.json(await mdFetch(`/at-home/server/${chapId}`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HEALTH ─────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  version: '3.2.0',
  timestamp: new Date().toISOString(),
  features: ['discover', 'genre-filter', 'vf-vostfr', 'manga-v2', 'adblock-sw', 'hls-audio-select']
}));

// ── 404 ────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route introuvable' }));

// ── ERROR ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Erreur globale:', err.message);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// ── START ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 NovaStream API v3.2 — port ${PORT}`);
  console.log(`📡 TMDB_KEY : ${TMDB_KEY ? '✅' : '❌ MANQUANTE'}`);
  console.log(`🎬 Frembed  : ${FREMBED_API}`);
  console.log(`📚 Manga    : trending/latest/tags/bytag activés`);
  console.log(`🛡️  SW adblock : /sw.js servi`);
});

module.exports = app;
