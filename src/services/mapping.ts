/**
 * MappingService — Résolution TMDB → AniList → Provider ID
 * 
 * Stratégie :
 * 1. TMDB external_ids → mal_id direct si disponible
 * 2. Si pas de mal_id : recherche AniList par titre romaji
 * 3. Recherche dans le provider par titre AniList
 * 4. Cache agressif (24h) pour éviter les calls répétés
 */

import { getExternalIds, getAnimeDetails, getAlternativeTitles } from './tmdb.js';
import { getByMalId, searchAniList, AniListMedia } from './anilist.js';
import { searchAnime, PROVIDERS } from '../providers/orchestrator.js';
import { cacheGet, cacheSet } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

export interface AnimeMapping {
  tmdbId: number;
  malId?: number;
  anilistId?: number;
  anilistData?: AniListMedia;
  providerIds: Record<string, string>; // { HiAnime: "...", Gogoanime: "..." }
  title: {
    romaji: string;
    english?: string;
    french?: string;
    native?: string;
  };
}

const MAPPING_TTL = 86_400; // 24h

/** Résolution complète d'un mapping TMDB → tout */
export async function resolveMapping(tmdbId: number): Promise<AnimeMapping> {
  const cacheKey = `mapping:${tmdbId}`;
  const cached = await cacheGet<AnimeMapping>(cacheKey);
  if (cached) return cached;

  logger.debug({ tmdbId }, 'Résolution mapping...');

  const mapping: AnimeMapping = {
    tmdbId,
    providerIds: {},
    title: { romaji: '' },
  };

  try {
    // ── Étape 1 : TMDB details + external IDs ─────────────────────
    const [details, externalIds] = await Promise.allSettled([
      getAnimeDetails(tmdbId),
      getExternalIds(tmdbId),
    ]);

    const tmdbDetails = details.status === 'fulfilled' ? details.value : null;
    const extIds = externalIds.status === 'fulfilled' ? externalIds.value : null;

    const tmdbTitle = tmdbDetails?.name ?? '';
    const malId = extIds?.mal_id ?? tmdbDetails?.external_ids?.mal_id;

    if (malId) mapping.malId = malId;

    // Récupère titres alternatifs TMDB (pour mieux matcher les providers)
    let frenchTitle: string | undefined;
    try {
      const altTitles = await getAlternativeTitles(tmdbId);
      const fr = altTitles?.results?.find((t: any) => t.iso_3166_1 === 'FR');
      if (fr) frenchTitle = fr.title;
    } catch { /* */ }

    // ── Étape 2 : AniList via MAL ID ou recherche titre ───────────
    let anilistData: AniListMedia | null = null;

    if (malId) {
      anilistData = await getByMalId(malId);
    }

    if (!anilistData && tmdbTitle) {
      const { media } = await searchAniList(tmdbTitle);
      anilistData = media[0] ?? null;

      // Vérification de cohérence : le titre doit être similaire
      if (anilistData && !titlesSimilar(tmdbTitle, [
        anilistData.title.romaji,
        anilistData.title.english ?? '',
        anilistData.title.native,
      ])) {
        anilistData = null;
      }
    }

    if (anilistData) {
      mapping.anilistId = anilistData.id;
      mapping.malId = mapping.malId ?? anilistData.idMal;
      mapping.anilistData = anilistData;
      mapping.title = {
        romaji: anilistData.title.romaji,
        english: anilistData.title.english,
        french: frenchTitle,
        native: anilistData.title.native,
      };
    } else {
      mapping.title = {
        romaji: tmdbTitle,
        french: frenchTitle,
      };
    }

    // ── Étape 3 : Recherche dans les providers ────────────────────
    const searchTitles = [
      mapping.title.romaji,
      mapping.title.english,
      mapping.title.french,
      tmdbTitle,
    ].filter((t): t is string => Boolean(t));

    await Promise.allSettled(
      PROVIDERS.map(async (provider) => {
        for (const title of searchTitles) {
          try {
            const results = await searchAnime(title, provider.name);
            const best = findBestMatch(title, results);
            if (best) {
              mapping.providerIds[provider.name] = best.id;
              logger.debug({ provider: provider.name, id: best.id, title: best.title }, 'Provider ID trouvé');
              break;
            }
          } catch { continue; }
        }
      })
    );

    await cacheSet(cacheKey, mapping, MAPPING_TTL);
    logger.info({ tmdbId, malId: mapping.malId, anilistId: mapping.anilistId, providers: Object.keys(mapping.providerIds) }, '✅ Mapping résolu');
  } catch (err) {
    logger.error({ tmdbId, err }, 'Erreur mapping');
  }

  return mapping;
}

/** Récupère juste l'ID provider pour un anime TMDB */
export async function getProviderEpisodeId(
  tmdbId: number,
  episodeNumber: number,
  providerName = 'HiAnime'
): Promise<string | null> {
  const cacheKey = `ep-id:${tmdbId}:${providerName}:${episodeNumber}`;
  const cached = await cacheGet<string>(cacheKey);
  if (cached) return cached;

  try {
    const mapping = await resolveMapping(tmdbId);
    const providerAnimeId = mapping.providerIds[providerName];
    if (!providerAnimeId) return null;

    // Import dynamique pour éviter les dépendances circulaires
    const { getEpisodes } = await import('../providers/orchestrator.js');
    const episodes = await getEpisodes(providerAnimeId, providerName);

    const episode = episodes.find(ep => ep.number === episodeNumber);
    if (!episode) return null;

    await cacheSet(cacheKey, episode.id, 1_800);
    return episode.id;
  } catch (err) {
    logger.error({ tmdbId, episodeNumber, providerName, err }, 'Erreur getProviderEpisodeId');
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function titlesSimilar(query: string, candidates: string[]): boolean {
  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const q = normalize(query);
  return candidates.some(c => {
    const cn = normalize(c);
    // Coincidence exacte ou inclus dans l'autre
    if (cn === q || cn.includes(q) || q.includes(cn)) return true;
    // Distance de Levenshtein simplifiée : 80% similarité
    const maxLen = Math.max(q.length, cn.length);
    let common = 0;
    const qWords = q.split(' ');
    const cWords = cn.split(' ');
    qWords.forEach(w => { if (cWords.includes(w)) common++; });
    return common / Math.max(qWords.length, cWords.length) > 0.6;
  });
}

function findBestMatch(
  query: string,
  results: { id: string; title: string }[]
): { id: string; title: string } | null {
  if (!results.length) return null;

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

  const q = normalize(query);

  // Cherche une correspondance exacte d'abord
  const exact = results.find(r => normalize(r.title) === q);
  if (exact) return exact;

  // Puis une correspondance partielle
  const partial = results.find(r =>
    normalize(r.title).includes(q) || q.includes(normalize(r.title))
  );
  if (partial) return partial;

  // Sinon le premier résultat (le plus pertinent selon le provider)
  return results[0] ?? null;
}
