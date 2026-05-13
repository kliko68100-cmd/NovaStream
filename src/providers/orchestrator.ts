/**
 * ProviderOrchestrator — Système multi-provider avec fallback automatique
 * Priorité : HiAnime → Gogoanime → AnimePahe
 * Détecte automatiquement VF/VOSTFR disponible par provider
 */

import { ANIME } from '@consumet/extensions';
import { IEpisodeServer, ISource, ISubtitle } from '@consumet/extensions/dist/models/index.js';
import { logger } from '../lib/logger.js';
import { cacheGet, cacheSet } from '../lib/redis.js';
import { config } from '../config/index.js';

// ── Types internes ────────────────────────────────────────────────

export interface ProviderSource {
  url: string;
  quality: string;
  isM3U8: boolean;
  isDASH?: boolean;
}

export interface ProviderSubtitle {
  url: string;
  lang: string;
  label: string;
  isDefault?: boolean;
}

export interface ResolvedSources {
  providerId: string;
  providerName: string;
  sources: ProviderSource[];
  subtitles: ProviderSubtitle[];
  intro?: { start: number; end: number };
  outro?: { start: number; end: number };
  headers?: Record<string, string>;
  lang: 'vf' | 'vostfr' | 'vo';
}

export interface ProviderSearchResult {
  id: string;
  title: string;
  url: string;
  image?: string;
  releaseDate?: string;
}

export interface ProviderEpisode {
  id: string;
  number: number;
  title?: string;
  image?: string;
  description?: string;
  url?: string;
}

// ── Providers instanciés ─────────────────────────────────────────

const hianime   = new ANIME.Zoro();       // HiAnime (anciennement Zoro/Aniwatch)
const gogoanime = new ANIME.Gogoanime();
let   animepahe: InstanceType<typeof ANIME.AnimePahe> | null = null;
try   { animepahe = new ANIME.AnimePahe(); } catch { /* optionnel */ }

interface ProviderEntry {
  name: string;
  instance: InstanceType<typeof ANIME.Zoro> | InstanceType<typeof ANIME.Gogoanime> | InstanceType<typeof ANIME.AnimePahe>;
  supportsVF: boolean;
  supportsVOSTFR: boolean;
  priority: number;
}

const PROVIDERS: ProviderEntry[] = [
  { name: 'HiAnime',   instance: hianime,   supportsVF: false, supportsVOSTFR: true, priority: 1 },
  { name: 'Gogoanime', instance: gogoanime, supportsVF: false, supportsVOSTFR: true, priority: 2 },
  ...(animepahe ? [{ name: 'AnimePahe', instance: animepahe, supportsVF: false, supportsVOSTFR: true, priority: 3 }] : []),
];

// ── Recherche anime par titre ──────────────────────────────────────

export async function searchAnime(
  query: string,
  providerName?: string
): Promise<ProviderSearchResult[]> {
  const cacheKey = `search:${providerName ?? 'all'}:${query}`;
  const cached = await cacheGet<ProviderSearchResult[]>(cacheKey);
  if (cached) return cached;

  const providers = providerName
    ? PROVIDERS.filter(p => p.name.toLowerCase() === providerName.toLowerCase())
    : PROVIDERS;

  for (const provider of providers) {
    try {
      const results = await withTimeout(
        provider.instance.search(query),
        config.PROVIDER_TIMEOUT
      );
      if (!results?.results?.length) continue;

      const mapped: ProviderSearchResult[] = results.results.map((r: any) => ({
        id: r.id,
        title: r.title,
        url: r.url ?? '',
        image: r.image,
        releaseDate: r.releaseDate,
      }));

      await cacheSet(cacheKey, mapped, 600); // 10 min
      return mapped;
    } catch (err) {
      logger.warn({ provider: provider.name, query, err }, 'Recherche provider échouée');
    }
  }

  return [];
}

// ── Récupération des épisodes ──────────────────────────────────────

export async function getEpisodes(
  animeId: string,
  providerName = 'HiAnime'
): Promise<ProviderEpisode[]> {
  const cacheKey = `episodes:${providerName}:${animeId}`;
  const cached = await cacheGet<ProviderEpisode[]>(cacheKey);
  if (cached) return cached;

  const provider = PROVIDERS.find(p => p.name === providerName) ?? PROVIDERS[0]!;

  try {
    const info = await withTimeout(
      provider.instance.fetchAnimeInfo(animeId),
      config.PROVIDER_TIMEOUT
    );
    if (!info?.episodes?.length) return [];

    const episodes: ProviderEpisode[] = info.episodes.map((ep: any) => ({
      id: ep.id,
      number: ep.number ?? 0,
      title: ep.title,
      image: ep.image,
      description: ep.description,
      url: ep.url,
    }));

    await cacheSet(cacheKey, episodes, 1800); // 30 min
    return episodes;
  } catch (err) {
    logger.error({ provider: providerName, animeId, err }, 'Fetch épisodes échoué');
    return [];
  }
}

// ── Résolution des sources avec fallback ──────────────────────────

export async function resolveSources(
  episodeId: string,
  providerName = 'HiAnime',
  lang: 'vf' | 'vostfr' | 'vo' = 'vostfr'
): Promise<ResolvedSources | null> {
  const cacheKey = `sources:${providerName}:${episodeId}:${lang}`;
  const cached = await cacheGet<ResolvedSources>(cacheKey);
  if (cached) return cached;

  // Ordre d'essai : provider demandé en premier, puis les autres
  const orderedProviders = [
    ...PROVIDERS.filter(p => p.name === providerName),
    ...PROVIDERS.filter(p => p.name !== providerName),
  ];

  for (const provider of orderedProviders) {
    try {
      logger.debug({ provider: provider.name, episodeId }, 'Tentative source');

      // HiAnime supporte les serveurs sub/dub
      let sourceData: ISource | null = null;

      if (provider.name === 'HiAnime') {
        sourceData = await resolveHiAnime(provider.instance as InstanceType<typeof ANIME.Zoro>, episodeId, lang);
      } else {
        const servers = await withTimeout<IEpisodeServer[]>(
          provider.instance.fetchEpisodeServers(episodeId),
          8_000
        );
        if (servers?.length) {
          // Essaie chaque serveur jusqu'à succès
          for (const server of servers.slice(0, 4)) {
            try {
              sourceData = await withTimeout<ISource>(
                provider.instance.fetchEpisodeSources(episodeId, server.name as any),
                config.PROVIDER_TIMEOUT
              );
              if (sourceData?.sources?.length) break;
            } catch { continue; }
          }
        }
        if (!sourceData?.sources?.length) {
          sourceData = await withTimeout<ISource>(
            provider.instance.fetchEpisodeSources(episodeId),
            config.PROVIDER_TIMEOUT
          );
        }
      }

      if (!sourceData?.sources?.length) continue;

      const result: ResolvedSources = {
        providerId: provider.name.toLowerCase(),
        providerName: provider.name,
        sources: normalizeSources(sourceData.sources),
        subtitles: normalizeSubtitles(sourceData.subtitles ?? [], lang),
        headers: sourceData.headers as Record<string, string> | undefined,
        lang,
        intro: sourceData.intro ? { start: sourceData.intro.start, end: sourceData.intro.end } : undefined,
        outro: (sourceData as any).outro ? { start: (sourceData as any).outro.start, end: (sourceData as any).outro.end } : undefined,
      };

      await cacheSet(cacheKey, result, config.PROXY_CACHE_TTL);
      logger.info({ provider: provider.name, sources: result.sources.length }, '✅ Sources résolues');
      return result;
    } catch (err) {
      logger.warn({ provider: provider.name, episodeId, err }, 'Provider échoué, fallback...');
    }
  }

  logger.error({ episodeId }, '❌ Tous les providers ont échoué');
  return null;
}

// ── HiAnime — gestion sub/dub séparée ─────────────────────────────

async function resolveHiAnime(
  instance: InstanceType<typeof ANIME.Zoro>,
  episodeId: string,
  lang: 'vf' | 'vostfr' | 'vo'
): Promise<ISource | null> {
  // HiAnime utilise "sub" pour VOSTFR et "dub" pour VF (anglais principalement)
  const serverType = lang === 'vf' ? 'dub' : 'sub';

  // Serveurs disponibles pour HiAnime : vidcloud, streamtape, streamsb
  const serversToTry = ['vidcloud', 'hd-2', 'hd-1'];

  for (const server of serversToTry) {
    try {
      const data = await withTimeout<ISource>(
        instance.fetchEpisodeSources(episodeId, server as any, serverType as any),
        config.PROVIDER_TIMEOUT
      );
      if (data?.sources?.length) return data;
    } catch { continue; }
  }

  // Fallback sans serveur spécifique
  return withTimeout<ISource>(
    instance.fetchEpisodeSources(episodeId),
    config.PROVIDER_TIMEOUT
  ).catch(() => null);
}

// ── Normalisation ─────────────────────────────────────────────────

function normalizeSources(raw: any[]): ProviderSource[] {
  return raw
    .filter(s => s.url)
    .map(s => ({
      url: s.url,
      quality: s.quality ?? 'auto',
      isM3U8: s.isM3U8 ?? s.url.includes('.m3u8'),
      isDASH: s.isDASH ?? s.url.includes('.mpd'),
    }))
    .sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
}

function qualityRank(q: string): number {
  if (q.includes('1080')) return 4;
  if (q.includes('720'))  return 3;
  if (q.includes('480'))  return 2;
  if (q.includes('360'))  return 1;
  return 0;
}

function normalizeSubtitles(raw: any[], preferLang: string): ProviderSubtitle[] {
  const subs: ProviderSubtitle[] = raw
    .filter(s => s.url)
    .map(s => {
      const lang = (s.lang ?? s.language ?? '').toLowerCase();
      return {
        url: s.url,
        lang,
        label: s.lang ?? s.language ?? 'Inconnu',
        isDefault: lang.includes('fr') || lang.includes('fre'),
      };
    });

  // Mettre le français en premier
  return subs.sort((a, b) => {
    const aFr = a.lang.includes('fr') || a.lang.includes('fre');
    const bFr = b.lang.includes('fr') || b.lang.includes('fre');
    if (aFr && !bFr) return -1;
    if (!aFr && bFr) return 1;
    return 0;
  });
}

// ── Utilitaires ───────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout après ${ms}ms`)), ms)
    ),
  ]);
}

export { PROVIDERS };
