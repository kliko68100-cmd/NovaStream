import { ANILIST_API } from '../config/index.js';
import { cacheGet, cacheSet } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

// ── Types ─────────────────────────────────────────────────────────

export interface AniListMedia {
  id: number;
  idMal?: number;
  title: {
    romaji: string;
    english?: string;
    native: string;
    userPreferred: string;
  };
  description?: string;
  coverImage: { large: string; medium: string; color?: string };
  bannerImage?: string;
  genres: string[];
  averageScore?: number;
  popularity?: number;
  episodes?: number;
  duration?: number;
  status: string;
  season?: string;
  seasonYear?: number;
  format?: string;
  studios?: { nodes: { id: number; name: string; isAnimationStudio: boolean }[] };
  tags?: { name: string; rank: number }[];
  trailer?: { id: string; site: string };
  nextAiringEpisode?: { airingAt: number; episode: number };
  streamingEpisodes?: { title: string; thumbnail: string; url: string }[];
  recommendations?: { nodes: { mediaRecommendation: AniListMedia }[] };
  relations?: { edges: { relationType: string; node: AniListMedia }[] };
  startDate?: { year?: number; month?: number; day?: number };
  endDate?: { year?: number; month?: number; day?: number };
  externalLinks?: { url: string; site: string; type: string }[];
  isAdult: boolean;
}

export interface AniListUser {
  id: number;
  name: string;
  avatar: { large: string };
  statistics: {
    anime: {
      count: number;
      minutesWatched: number;
      episodesWatched: number;
    };
  };
}

export interface AniListListEntry {
  id: number;
  status: 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'DROPPED' | 'PAUSED' | 'REPEATING';
  progress: number;
  score?: number;
  media: AniListMedia;
}

// ── GQL helpers ───────────────────────────────────────────────────

async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string,
  cacheKey?: string,
  ttl = 3_600
): Promise<T> {
  if (cacheKey) {
    const cached = await cacheGet<T>(cacheKey);
    if (cached) return cached;
  }

  const res = await fetch(ANILIST_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) throw new Error(`AniList ${res.status}: ${res.statusText}`);

  const json = await res.json() as { data: T; errors?: any[] };
  if (json.errors?.length) throw new Error(`AniList GQL: ${json.errors[0]?.message}`);

  if (cacheKey) await cacheSet(cacheKey, json.data, ttl);
  return json.data;
}

// ── Fragments GQL ─────────────────────────────────────────────────

const MEDIA_FRAGMENT = `
  id idMal
  title { romaji english native userPreferred }
  description(asHtml: false)
  coverImage { large medium color }
  bannerImage
  genres
  averageScore popularity
  episodes duration status season seasonYear format
  isAdult
  studios(isMain: true) { nodes { id name isAnimationStudio } }
  tags { name rank }
  trailer { id site }
  nextAiringEpisode { airingAt episode }
  startDate { year month day }
  endDate { year month day }
  externalLinks { url site type }
`;

// ── Recherche par titre ───────────────────────────────────────────

export async function searchAniList(
  query: string,
  page = 1
): Promise<{ media: AniListMedia[]; pageInfo: any }> {
  const GQL = `
    query ($search: String, $page: Int) {
      Page(page: $page, perPage: 20) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `;

  const data = await gql<any>(
    GQL,
    { search: query, page },
    undefined,
    `anilist:search:${query}:${page}`,
    300
  );
  return {
    media: data.Page.media ?? [],
    pageInfo: data.Page.pageInfo,
  };
}

/** Détails par ID AniList */
export async function getAniListMedia(id: number): Promise<AniListMedia> {
  const GQL = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FRAGMENT}
        streamingEpisodes { title thumbnail url }
        recommendations { nodes { mediaRecommendation { ${MEDIA_FRAGMENT} } } }
        relations { edges { relationType node { id title { romaji } coverImage { large } format } } }
      }
    }
  `;

  const data = await gql<any>(GQL, { id }, undefined, `anilist:media:${id}`, 3_600);
  return data.Media;
}

/** Par ID MAL */
export async function getByMalId(malId: number): Promise<AniListMedia | null> {
  const GQL = `
    query ($malId: Int) {
      Media(idMal: $malId, type: ANIME) {
        ${MEDIA_FRAGMENT}
      }
    }
  `;
  try {
    const data = await gql<any>(GQL, { malId }, undefined, `anilist:mal:${malId}`, 86_400);
    return data.Media ?? null;
  } catch {
    return null;
  }
}

/** Trending AniList */
export async function getTrendingAniList(page = 1) {
  const GQL = `
    query ($page: Int) {
      Page(page: $page, perPage: 24) {
        pageInfo { total hasNextPage }
        media(type: ANIME, sort: TRENDING_DESC, isAdult: false, status_in: [RELEASING, FINISHED]) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `;
  const data = await gql<any>(GQL, { page }, undefined, `anilist:trending:${page}`, 1_800);
  return { results: data.Page.media ?? [], pageInfo: data.Page.pageInfo };
}

/** Saisonniers */
export async function getSeasonalAnime(year?: number, season?: string, page = 1) {
  const now = new Date();
  const currentYear = year ?? now.getFullYear();
  const months = ['WINTER', 'WINTER', 'SPRING', 'SPRING', 'SPRING', 'SUMMER', 'SUMMER', 'SUMMER', 'FALL', 'FALL', 'FALL', 'WINTER'];
  const currentSeason = season ?? months[now.getMonth()]!;

  const GQL = `
    query ($year: Int, $season: MediaSeason, $page: Int) {
      Page(page: $page, perPage: 24) {
        pageInfo { total hasNextPage }
        media(type: ANIME, seasonYear: $year, season: $season, sort: POPULARITY_DESC, isAdult: false) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `;

  const data = await gql<any>(
    GQL,
    { year: currentYear, season: currentSeason, page },
    undefined,
    `anilist:seasonal:${currentYear}:${currentSeason}:${page}`,
    3_600
  );
  return { results: data.Page.media ?? [], season: currentSeason, year: currentYear };
}

// ── OAuth / User ──────────────────────────────────────────────────

export async function getAniListUser(token: string): Promise<AniListUser> {
  const GQL = `
    query {
      Viewer {
        id name
        avatar { large }
        statistics { anime { count minutesWatched episodesWatched } }
      }
    }
  `;
  const data = await gql<any>(GQL, {}, token);
  return data.Viewer;
}

export async function getUserList(
  userId: number,
  status: string,
  token?: string
): Promise<AniListListEntry[]> {
  const GQL = `
    query ($userId: Int, $status: MediaListStatus) {
      MediaListCollection(userId: $userId, type: ANIME, status: $status) {
        lists {
          entries {
            id status progress score
            media { ${MEDIA_FRAGMENT} }
          }
        }
      }
    }
  `;
  const data = await gql<any>(GQL, { userId, status }, token);
  return data.MediaListCollection.lists.flatMap((l: any) => l.entries) ?? [];
}

export async function updateListEntry(
  mediaId: number,
  status: string,
  progress: number,
  token: string,
  score?: number
): Promise<void> {
  const GQL = `
    mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $score: Float) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, score: $score) {
        id
      }
    }
  `;
  await gql<any>(GQL, { mediaId, status, progress, score }, token);
}

// ── AniSkip — timestamps intro/outro ─────────────────────────────

export interface SkipTimes {
  intro?: { start: number; end: number };
  outro?: { start: number; end: number };
}

export async function getSkipTimes(malId: number, episode: number, episodeLength = 0): Promise<SkipTimes> {
  const cacheKey = `aniskip:${malId}:${episode}`;
  const cached = await cacheGet<SkipTimes>(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://api.aniskip.com/v2/skip-times/${malId}/${episode}?types[]=op&types[]=ed${episodeLength ? `&episodeLength=${episodeLength}` : ''}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return {};

    const data = await res.json() as { results: any[] };
    const result: SkipTimes = {};

    for (const item of data.results ?? []) {
      if (item.skipType === 'op') {
        result.intro = { start: item.interval.startTime, end: item.interval.endTime };
      } else if (item.skipType === 'ed') {
        result.outro = { start: item.interval.startTime, end: item.interval.endTime };
      }
    }

    await cacheSet(cacheKey, result, 86_400); // 24h
    return result;
  } catch (err) {
    logger.debug({ malId, episode, err }, 'AniSkip indisponible');
    return {};
  }
}

// ── Populaires (par popularité AniList) ───────────────────────────

export async function getPopularAniList(page = 1) {
  const data = await gql<any>(`
    query($page: Int) {
      Page(page: $page, perPage: 24) {
        pageInfo { total currentPage lastPage }
        media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `, { page }, undefined, `anilist:popular:${page}`, 3600);
  return { results: data.Page.media, pageInfo: data.Page.pageInfo };
}

// ── Top rated ────────────────────────────────────────────────────

export async function getTopRatedAniList(page = 1) {
  const data = await gql<any>(`
    query($page: Int) {
      Page(page: $page, perPage: 24) {
        pageInfo { total currentPage lastPage }
        media(type: ANIME, sort: SCORE_DESC, isAdult: false, averageScore_greater: 70) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `, { page }, undefined, `anilist:toprated:${page}`, 3600);
  return { results: data.Page.media, pageInfo: data.Page.pageInfo };
}
