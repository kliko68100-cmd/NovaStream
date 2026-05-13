import { Router } from 'express';
import { z } from 'zod';
import * as tmdb from '../services/tmdb.js';
import * as anilist from '../services/anilist.js';

export const catalogRouter = Router();

// ── TMDB Routes ───────────────────────────────────────────────────

catalogRouter.get('/trending', async (req, res) => {
  try {
    const { page = '1' } = req.query as Record<string, string>;
    const data = await tmdb.getTrending(+page);
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anime/popular', async (req, res) => {
  try {
    const { page = '1' } = req.query as Record<string, string>;
    res.json(await tmdb.getPopularAnime(+page));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anime/toprated', async (req, res) => {
  try {
    const { page = '1' } = req.query as Record<string, string>;
    res.json(await tmdb.getTopRatedAnime(+page));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anime/onair', async (req, res) => {
  try {
    const { page = '1' } = req.query as Record<string, string>;
    res.json(await tmdb.getOnAirAnime(+page));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anime/details/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id!);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });
    const [details, recommendations] = await Promise.allSettled([
      tmdb.getAnimeDetails(id),
      tmdb.getRecommendations(id),
    ]);
    const d = details.status === 'fulfilled' ? details.value : null;
    const r = recommendations.status === 'fulfilled' ? recommendations.value : null;
    res.json({ ...d, recommendations: r?.results ?? [] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anime/season/:showId/:season', async (req, res) => {
  try {
    const { showId, season } = req.params as Record<string, string>;
    res.json(await tmdb.getSeason(+showId!, +season!));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anime/episode/:showId/:season/:ep', async (req, res) => {
  try {
    const { showId, season, ep } = req.params as Record<string, string>;
    res.json(await tmdb.getEpisode(+showId!, +season!, +ep!));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/discover', async (req, res) => {
  try {
    const q = req.query as Record<string, string>;
    res.json(await tmdb.discover({
      type: q.type === 'movie' ? 'movie' : 'tv',
      genres: q.genres,
      sort: q.sort,
      language: q.language ?? 'ja',
      year: q.year,
      page: q.page ? +q.page : 1,
    }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/search', async (req, res) => {
  try {
    const { q, type = 'anime', page = '1' } = req.query as Record<string, string>;
    if (!q) return res.json({ results: [] });
    const data = type === 'anime'
      ? await tmdb.searchAnime(q, +page)
      : await tmdb.search(q, +page);
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/genres', async (_req, res) => {
  try {
    res.json(await tmdb.getGenres());
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── AniList Routes ────────────────────────────────────────────────

catalogRouter.get('/anilist/trending', async (req, res) => {
  try {
    const { page = '1' } = req.query as Record<string, string>;
    res.json(await anilist.getTrendingAniList(+page));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anilist/seasonal', async (req, res) => {
  try {
    const { year, season, page = '1' } = req.query as Record<string, string>;
    res.json(await anilist.getSeasonalAnime(year ? +year : undefined, season, +page));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anilist/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id!);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });
    res.json(await anilist.getAniListMedia(id));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anilist/mal/:malId', async (req, res) => {
  try {
    const malId = parseInt(req.params.malId!);
    if (isNaN(malId)) return res.status(400).json({ error: 'MAL ID invalide' });
    const data = await anilist.getByMalId(malId);
    if (!data) return res.status(404).json({ error: 'Introuvable' });
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anilist/search', async (req, res) => {
  try {
    const { q, page = '1' } = req.query as Record<string, string>;
    if (!q) return res.json({ media: [], pageInfo: {} });
    res.json(await anilist.searchAniList(q, +page));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/skiptimes/:malId/:episode', async (req, res) => {
  try {
    const { malId, episode } = req.params as Record<string, string>;
    const { episodeLength } = req.query as Record<string, string>;
    res.json(await anilist.getSkipTimes(+malId!, +episode!, episodeLength ? +episodeLength : undefined));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Image proxy TMDB thumbnails ───────────────────────────────────
// Évite les problèmes CSP en proxifiant les images TMDB

catalogRouter.get('/image/:size/*', async (req, res) => {
  try {
    const { size } = req.params as { size: string };
    const path = '/' + (req.params as any)[0];
    const url = `https://image.tmdb.org/t/p/${size}${path}`;

    const imgRes = await fetch(url, {
      headers: { 'User-Agent': 'NovaStream/4.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!imgRes.ok) return res.status(404).end();

    res.setHeader('Content-Type', imgRes.headers.get('content-type') ?? 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const buf = await imgRes.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch { res.status(502).end(); }
});
