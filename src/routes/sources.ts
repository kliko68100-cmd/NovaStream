import { Router } from 'express';
import { z } from 'zod';
import { resolveMapping, getProviderEpisodeId } from '../services/mapping.js';
import { resolveSources, searchAnime, getEpisodes } from '../providers/orchestrator.js';
import { getSkipTimes } from '../services/anilist.js';
import { logger } from '../lib/logger.js';

export const sourcesRouter = Router();

const SourcesQuery = z.object({
  tmdbId:        z.coerce.number().int().positive(),
  episode:       z.coerce.number().int().positive().optional(),
  season:        z.coerce.number().int().positive().optional(),
  lang:          z.enum(['vf', 'vostfr', 'vo']).default('vostfr'),
  provider:      z.string().optional(),
  episodeLength: z.coerce.number().optional(),
});

function getIframeSources(tmdbId: number, episode = 1, season = 1) {
  return [
    { name: 'VidSrc',    url: `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}` },
    { name: '2Embed',    url: `https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}` },
    { name: 'VidSrc.me', url: `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}` },
    { name: 'EmbedSu',   url: `https://embed.su/embed/tv/${tmdbId}/${season}/${episode}` },
    { name: 'AutoEmbed', url: `https://autoembed.cc/tv/tmdb/${tmdbId}-${season}-${episode}` },
  ];
}

sourcesRouter.get('/', async (req, res) => {
  const parsed = SourcesQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Params invalides', details: parsed.error.flatten() });
  }

  const { tmdbId, episode = 1, season = 1, lang, provider, episodeLength } = parsed.data;

  try {
    // Tentative provider direct (HiAnime etc.)
    let mapping: any = null;
    try {
      mapping = await resolveMapping(tmdbId);
      const preferredProvider = provider ?? (Object.keys(mapping.providerIds)[0]) ?? 'HiAnime';
      const providerAnimeId = mapping.providerIds[preferredProvider];

      if (providerAnimeId) {
        const episodes = await getEpisodes(providerAnimeId, preferredProvider);
        const targetEp = episodes.find(ep => ep.number === episode) ?? episodes[episode - 1];

        if (targetEp) {
          const directSources = await resolveSources(targetEp.id, preferredProvider, lang);

          if (directSources) {
            let skipTimes = { intro: undefined as any, outro: undefined as any };
            if (mapping.malId) {
              try { skipTimes = await getSkipTimes(mapping.malId, episode, episodeLength) as any; } catch { }
              if (!skipTimes.intro && directSources.intro) skipTimes.intro = directSources.intro;
              if (!skipTimes.outro && directSources.outro) skipTimes.outro = directSources.outro;
            }

            return res.json({
              ...directSources,
              type: 'hls',
              intro: skipTimes.intro,
              outro: skipTimes.outro,
              episode: { number: episode },
              iframes: getIframeSources(tmdbId, episode, season),
            });
          }
        }
      }
    } catch (err: any) {
      logger.warn({ tmdbId, err: err.message }, 'Provider direct échoué, fallback iframe');
    }

    // Fallback iframe — toujours disponible
    logger.info({ tmdbId, episode, season }, 'Fallback iframe activé');
    const iframeSources = getIframeSources(tmdbId, episode, season);

    return res.json({
      type: 'iframe',
      providerId: 'iframe-fallback',
      providerName: 'VidSrc',
      lang: lang as 'vf' | 'vostfr' | 'vo',
      sources: [],
      subtitles: [],
      iframes: iframeSources,
      activeIframe: iframeSources[0]!.url,
      episode: { number: episode },
    });

  } catch (err: any) {
    logger.error({ tmdbId, episode, err: err.message }, 'Erreur sources');
    return res.status(500).json({ error: 'Erreur interne', message: err.message });
  }
});

sourcesRouter.get('/episodes', async (req, res) => {
  const schema = z.object({
    tmdbId:   z.coerce.number().int().positive(),
    provider: z.string().default('HiAnime'),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Params invalides' });
  const { tmdbId, provider } = parsed.data;
  try {
    const mapping = await resolveMapping(tmdbId);
    const providerAnimeId = mapping.providerIds[provider];
    if (!providerAnimeId) {
      return res.status(404).json({ error: 'Anime non mappé', availableProviders: Object.keys(mapping.providerIds) });
    }
    const episodes = await getEpisodes(providerAnimeId, provider);
    return res.json({ episodes, total: episodes.length, provider });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

sourcesRouter.get('/mapping', async (req, res) => {
  const schema = z.object({ tmdbId: z.coerce.number().int().positive() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'tmdbId requis' });
  try {
    const mapping = await resolveMapping(parsed.data.tmdbId);
    return res.json(mapping);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

sourcesRouter.get('/providers', (_req, res) => {
  return res.json({
    providers: [
      { name: 'HiAnime',   type: 'direct', supportsVOSTFR: true },
      { name: 'AnimeKai',  type: 'direct', supportsVOSTFR: true },
      { name: 'VidSrc',    type: 'iframe', supportsVOSTFR: true },
      { name: '2Embed',    type: 'iframe', supportsVOSTFR: true },
      { name: 'EmbedSu',   type: 'iframe', supportsVOSTFR: true },
    ],
  });
});
