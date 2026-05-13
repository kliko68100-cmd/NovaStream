import { Router } from 'express';
import { z } from 'zod';
import { resolveMapping, getProviderEpisodeId } from '../services/mapping.js';
import { resolveSources, searchAnime, getEpisodes } from '../providers/orchestrator.js';
import { getSkipTimes } from '../services/anilist.js';
import { logger } from '../lib/logger.js';

export const sourcesRouter = Router();

// ── Validation ────────────────────────────────────────────────────

const SourcesQuery = z.object({
  tmdbId: z.coerce.number().int().positive(),
  episode: z.coerce.number().int().positive().optional(),
  season: z.coerce.number().int().positive().optional(),
  lang: z.enum(['vf', 'vostfr', 'vo']).default('vostfr'),
  provider: z.string().optional(),
  episodeLength: z.coerce.number().optional(),
});

// ── GET /api/sources — Résolution complète ────────────────────────
/**
 * Résout les sources vidéo pour un anime TMDB
 * Query params:
 *   tmdbId    — ID TMDB obligatoire
 *   episode   — Numéro d'épisode (défaut: 1)
 *   season    — Saison (ignoré pour les providers, utilisé pour logging)
 *   lang      — vf|vostfr|vo (défaut: vostfr)
 *   provider  — HiAnime|Gogoanime|AnimePahe (optionnel, sinon auto)
 *   episodeLength — Durée en secondes pour AniSkip
 */
sourcesRouter.get('/', async (req, res) => {
  const parsed = SourcesQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Params invalides', details: parsed.error.flatten() });
  }

  const { tmdbId, episode = 1, lang, provider, episodeLength } = parsed.data;

  try {
    // ── 1. Résolution du mapping TMDB → Provider ──────────────────
    const mapping = await resolveMapping(tmdbId);

    const preferredProvider = provider ??
      (Object.keys(mapping.providerIds)[0]) ??
      'HiAnime';

    const providerAnimeId = mapping.providerIds[preferredProvider];

    if (!providerAnimeId) {
      return res.status(404).json({
        error: 'Anime introuvable chez les providers',
        mapping: { malId: mapping.malId, anilistId: mapping.anilistId },
      });
    }

    // ── 2. Récupère l'ID de l'épisode ─────────────────────────────
    const episodes = await getEpisodes(providerAnimeId, preferredProvider);
    const targetEp = episodes.find(ep => ep.number === episode) ?? episodes[episode - 1];

    if (!targetEp) {
      return res.status(404).json({
        error: `Épisode ${episode} introuvable`,
        availableEpisodes: episodes.length,
      });
    }

    // ── 3. Résolution des sources ─────────────────────────────────
    const sources = await resolveSources(targetEp.id, preferredProvider, lang);

    if (!sources) {
      return res.status(503).json({
        error: 'Sources indisponibles',
        suggestion: 'Essaie un autre provider',
        availableProviders: Object.keys(mapping.providerIds),
      });
    }

    // ── 4. Skip times AniSkip (optionnel) ─────────────────────────
    let skipTimes = { intro: undefined as any, outro: undefined as any };
    if (mapping.malId) {
      skipTimes = await getSkipTimes(mapping.malId, episode, episodeLength);
      // Override par les données du provider si disponibles
      if (!skipTimes.intro && sources.intro) skipTimes.intro = sources.intro;
      if (!skipTimes.outro && sources.outro) skipTimes.outro = sources.outro;
    }

    return res.json({
      ...sources,
      intro: skipTimes.intro,
      outro: skipTimes.outro,
      episode: {
        id: targetEp.id,
        number: targetEp.number,
        title: targetEp.title,
        image: targetEp.image,
      },
      mapping: {
        malId: mapping.malId,
        anilistId: mapping.anilistId,
        providerAnimeId,
        availableProviders: Object.keys(mapping.providerIds),
      },
    });
  } catch (err: any) {
    logger.error({ tmdbId, episode, err: err.message }, 'Erreur resolution sources');
    return res.status(500).json({ error: 'Erreur interne', message: err.message });
  }
});

// ── GET /api/sources/episodes — Liste épisodes provider ───────────
sourcesRouter.get('/episodes', async (req, res) => {
  const schema = z.object({
    tmdbId: z.coerce.number().int().positive(),
    provider: z.string().default('HiAnime'),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Params invalides' });

  const { tmdbId, provider } = parsed.data;

  try {
    const mapping = await resolveMapping(tmdbId);
    const providerAnimeId = mapping.providerIds[provider];

    if (!providerAnimeId) {
      return res.status(404).json({
        error: 'Anime non mappé pour ce provider',
        availableProviders: Object.keys(mapping.providerIds),
      });
    }

    const episodes = await getEpisodes(providerAnimeId, provider);
    return res.json({ episodes, total: episodes.length, provider });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sources/mapping — Info mapping d'un anime ────────────
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

// ── GET /api/sources/providers — Liste des providers disponibles ──
sourcesRouter.get('/providers', (_req, res) => {
  const { PROVIDERS } = require('../providers/orchestrator.js');
  return res.json({
    providers: PROVIDERS.map((p: any) => ({
      name: p.name,
      supportsVF: p.supportsVF,
      supportsVOSTFR: p.supportsVOSTFR,
      priority: p.priority,
    })),
  });
});
