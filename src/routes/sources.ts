import { Router } from 'express';
import { z } from 'zod';
import { resolveAnimeSama } from '../services/animesama.js';
import { logger } from '../lib/logger.js';

export const sourcesRouter = Router();

const Q = z.object({
  anilistId:  z.coerce.number().int().positive(),
  malId:      z.coerce.number().int().positive().optional(),
  episode:    z.coerce.number().int().positive().default(1),
  season:     z.coerce.number().int().positive().default(1),
  lang:       z.enum(['vf','vostfr','vo']).default('vostfr'),
  title:      z.string().optional(),
  titleEn:    z.string().optional(),
});

function getIframes(anilistId: number, episode: number, season: number) {
  return [
    { name: 'VidSrc',    url: `https://vidsrc.to/embed/tv/${anilistId}/${season}/${episode}` },
    { name: '2Embed',    url: `https://www.2embed.cc/embedtv/${anilistId}&s=${season}&e=${episode}` },
    { name: 'VidSrc.me', url: `https://vidsrc.me/embed/tv?tmdb=${anilistId}&season=${season}&episode=${episode}` },
    { name: 'EmbedSu',   url: `https://embed.su/embed/tv/${anilistId}/${season}/${episode}` },
  ];
}

sourcesRouter.get('/', async (req, res) => {
  const parsed = Q.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Params invalides', details: parsed.error.flatten() });

  const { anilistId, episode, season, lang, title, titleEn } = parsed.data;
  const searchTitle = title ?? titleEn ?? '';

  try {
    // 1. Anime-Sama (VOSTFR/VF français) — via proxy relay
    if (searchTitle && (lang === 'vostfr' || lang === 'vf')) {
      try {
        const players = await resolveAnimeSama(searchTitle, season, episode, lang);
        if (players && players.length > 0) {
          logger.info({ title: searchTitle, episode }, '✅ AnimeSama');
          return res.json({
            type: 'animesama',
            lang,
            iframes: players.map(p => ({ name: p.name, url: p.url })),
            fallback: getIframes(anilistId, episode, season),
          });
        }
      } catch(err:any) {
        logger.warn({ title: searchTitle, err: err.message }, 'AnimeSama échoué');
      }
    }

    // 2. Fallback iframes
    logger.info({ anilistId, episode }, 'Fallback iframe');
    return res.json({
      type: 'iframe',
      lang,
      iframes: getIframes(anilistId, episode, season),
    });

  } catch(err:any) {
    logger.error({ anilistId, err: err.message }, 'Erreur sources');
    return res.status(500).json({ error: 'Erreur interne' });
  }
});

// Proxy relay pour Anime-Sama (contourne le CORS depuis le navigateur)
sourcesRouter.get('/animesama/relay', async (req, res) => {
  const url = String(req.query.url ?? '');
  if (!url.startsWith('https://anime-sama.fr/') && !url.startsWith('http://anime-sama.fr/')) {
    return res.status(400).json({ error: 'URL non autorisée' });
  }
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
        'Referer': 'https://anime-sama.fr/',
        'Accept': 'text/html,application/javascript,*/*',
      },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await resp.text();
    res.setHeader('Content-Type', resp.headers.get('content-type') ?? 'text/plain');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(text);
  } catch(err:any) {
    res.status(502).json({ error: err.message });
  }
});
