import { Router } from 'express';
import { z } from 'zod';
import { resolveMapping } from '../services/mapping.js';
import { resolveSources, getEpisodes } from '../providers/orchestrator.js';
import { getSkipTimes } from '../services/anilist.js';
import { resolveAnimeSama } from '../services/animesama.js';
import { logger } from '../lib/logger.js';

export const sourcesRouter = Router();

const SourcesQuery = z.object({
  tmdbId:        z.coerce.number().int().positive(),
  episode:       z.coerce.number().int().positive().optional(),
  season:        z.coerce.number().int().positive().optional(),
  lang:          z.enum(['vf', 'vostfr', 'vo']).default('vostfr'),
  provider:      z.string().optional(),
  episodeLength: z.coerce.number().optional(),
  title:         z.string().optional(), // titre pour Anime-Sama
});

function getIframeSources(tmdbId: number, episode = 1, season = 1) {
  return [
    { name: 'VidSrc',    url: `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}` },
    { name: '2Embed',    url: `https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}` },
    { name: 'VidSrc.me', url: `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}` },
    { name: 'EmbedSu',   url: `https://embed.su/embed/tv/${tmdbId}/${season}/${episode}` },
  ];
}

sourcesRouter.get('/', async (req, res) => {
  const parsed = SourcesQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Params invalides' });

  const { tmdbId, episode = 1, season = 1, lang, provider, episodeLength, title } = parsed.data;

  try {
    // ── 1. Anime-Sama (VOSTFR/VF français) ───────────────────────
    if (title && (lang === 'vostfr' || lang === 'vf')) {
      try {
        const asSources = await resolveAnimeSama(title, season, episode, lang);
        if (asSources && asSources.length > 0) {
          logger.info({ tmdbId, episode, title }, '✅ AnimeSama sources');
          const iframes = asSources.map(p => ({ name: p.name, url: p.url }));
          return res.json({
            type:          'animesama',
            providerId:    'animesama',
            providerName:  'Anime-Sama',
            lang,
            sources:       [],
            subtitles:     [],
            iframes,
            activeIframe:  iframes[0]!.url,
            episode:       { number: episode },
            iframeFallback: getIframeSources(tmdbId, episode, season),
          });
        }
      } catch (err: any) {
        logger.warn({ title, err: err.message }, 'AnimeSama échoué, suite...');
      }
    }

    // ── 2. Provider direct HiAnime etc. ──────────────────────────
    try {
      const mapping = await resolveMapping(tmdbId);
      const preferredProvider = provider ?? Object.keys(mapping.providerIds)[0] ?? 'HiAnime';
      const providerAnimeId = mapping.providerIds[preferredProvider];

      if (providerAnimeId) {
        const episodes = await getEpisodes(providerAnimeId, preferredProvider);
        const targetEp = episodes.find(ep => ep.number === episode) ?? episodes[episode - 1];

        if (targetEp) {
          const directSources = await resolveSources(targetEp.id, preferredProvider, lang);
          if (directSources) {
            let skipTimes: any = {};
            if (mapping.malId) {
              try { skipTimes = await getSkipTimes(mapping.malId, episode, episodeLength) as any; } catch { }
            }
            return res.json({
              ...directSources,
              type: 'hls',
              intro: skipTimes.intro ?? directSources.intro,
              outro: skipTimes.outro ?? directSources.outro,
              episode: { number: episode },
              iframes: getIframeSources(tmdbId, episode, season),
            });
          }
        }
      }
    } catch (err: any) {
      logger.warn({ tmdbId, err: err.message }, 'Provider HLS échoué');
    }

    // ── 3. Fallback iframes VidSrc ───────────────────────────────
    logger.info({ tmdbId, episode, season }, 'Fallback iframe');
    const iframes = getIframeSources(tmdbId, episode, season);
    return res.json({
      type: 'iframe', providerId: 'iframe-fallback', providerName: 'VidSrc',
      lang, sources: [], subtitles: [],
      iframes, activeIframe: iframes[0]!.url,
      episode: { number: episode },
    });

  } catch (err: any) {
    logger.error({ tmdbId, err: err.message }, 'Erreur sources');
    return res.status(500).json({ error: 'Erreur interne' });
  }
});

sourcesRouter.get('/episodes', async (req, res) => {
  const schema = z.object({ tmdbId: z.coerce.number().int().positive(), provider: z.string().default('HiAnime') });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Params invalides' });
  try {
    const mapping = await resolveMapping(parsed.data.tmdbId);
    const providerAnimeId = mapping.providerIds[parsed.data.provider];
    if (!providerAnimeId) return res.status(404).json({ error: 'Non mappé' });
    const episodes = await getEpisodes(providerAnimeId, parsed.data.provider);
    return res.json({ episodes, total: episodes.length });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

sourcesRouter.get('/mapping', async (req, res) => {
  const schema = z.object({ tmdbId: z.coerce.number().int().positive() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'tmdbId requis' });
  try { return res.json(await resolveMapping(parsed.data.tmdbId)); }
  catch (err: any) { return res.status(500).json({ error: err.message }); }
});

sourcesRouter.get('/animesama/search', async (req, res) => {
  const q = String(req.query.q ?? '');
  if (!q) return res.status(400).json({ error: 'q requis' });
  const { searchAnimeSama } = await import('../services/animesama.js');
  try { return res.json(await searchAnimeSama(q)); }
  catch (err: any) { return res.status(500).json({ error: err.message }); }
});
