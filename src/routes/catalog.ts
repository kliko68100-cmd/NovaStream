import { Router } from 'express';
import * as anilist from '../services/anilist.js';

export const catalogRouter = Router();

// ── AniList — Catalogue anime ─────────────────────────────────────

catalogRouter.get('/anime/trending', async (req, res) => {
  try { res.json(await anilist.getTrendingAniList(+(req.query.page??1))); }
  catch(e:any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anime/seasonal', async (req, res) => {
  try {
    const { year, season, page = '1' } = req.query as Record<string, string>;
    res.json(await anilist.getSeasonalAnime(year ? +year : undefined, season, +page));
  } catch(e:any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anime/popular', async (req, res) => {
  try { res.json(await anilist.getPopularAniList(+(req.query.page??1))); }
  catch(e:any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anime/toprated', async (req, res) => {
  try { res.json(await anilist.getTopRatedAniList(+(req.query.page??1))); }
  catch(e:any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anime/search', async (req, res) => {
  try {
    const q = String(req.query.q ?? '');
    if (!q) return res.status(400).json({ error: 'q requis' });
    res.json(await anilist.searchAniList(q, +(req.query.page??1)));
  } catch(e:any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anime/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id!);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });
    res.json(await anilist.getAniListMedia(id));
  } catch(e:any) { res.status(500).json({ error: e.message }); }
});

catalogRouter.get('/anilist/mal/:malId', async (req, res) => {
  try {
    const malId = parseInt(req.params.malId!);
    if (isNaN(malId)) return res.status(400).json({ error: 'ID invalide' });
    res.json(await anilist.getByMalId(malId));
  } catch(e:any) { res.status(500).json({ error: e.message }); }
});
