import { config, TMDB_API, TMDB_IMG } from '../config/index.js';
import { cacheGet, cacheSet } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

// ── Types ─────────────────────────────────────────────────────────

export interface TMDBAnime {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  first_air_date: string;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  episode_run_time?: number[];
  number_of_episodes?: number;
  number_of_seasons?: number;
  external_ids?: { imdb_id?: string; tvdb_id?: number; mal_id?: number };
  credits?: { cast: any[]; crew: any[] };
  videos?: { results: any[] };
  similar?: { results: TMDBAnime[] };
  status?: string;
  tagline?: string;
  networks?: { id: number; name: string; logo_path: string }[];
  seasons?: TMDBSeason[];
}

export interface TMDBSeason {
  id: number;
  name: string;
  season_number: number;
  episode_count: number;
  poster_path: string | null;
  air_date: string;
  episodes?: TMDBEpisode[];
}

export interface TMDBEpisode {
  id: number;
  name: string;
  overview: string;
  episode_number: number;
  season_number: number;
  still_path: string | null;
  air_date: string;
  vote_average: number;
  runtime: number | null;
}

// ── Fetch helpers ─────────────────────────────────────────────────

async function tmdbFetch<T>(
  endpoint: string,
  lang = 'fr-FR',
  cache = true,
  ttl = 3_600
): Promise<T> {
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${TMDB_API}${endpoint}${sep}api_key=${config.TMDB_KEY}&language=${lang}`;
  const cacheKey = `tmdb:${endpoint}:${lang}`;

  if (cache) {
    const cached = await cacheGet<T>(cacheKey);
    if (cached) return cached;
  }

  const res = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) throw new Error(`TMDB ${res.status}: ${res.statusText} — ${endpoint}`);

  const data = await res.json() as T;
  if (cache) await cacheSet(cacheKey, data, ttl);
  return data;
}

// ── Image URL helpers ─────────────────────────────────────────────

export function posterUrl(path: string | null, size: 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w500'): string {
  return path ? `${TMDB_IMG}/${size}${path}` : '/placeholder-poster.jpg';
}

export function backdropUrl(path: string | null, size: 'w300' | 'w780' | 'w1280' | 'original' = 'w1280'): string {
  return path ? `${TMDB_IMG}/${size}${path}` : '/placeholder-backdrop.jpg';
}

export function stillUrl(path: string | null, size: 'w92' | 'w185' | 'w300' | 'original' = 'w300'): string {
  return path ? `${TMDB_IMG}/${size}${path}` : '/placeholder-still.jpg';
}

// ── API publics ───────────────────────────────────────────────────

/** Trending — anime de la semaine */
export async function getTrending(page = 1) {
  return tmdbFetch<any>(`/trending/tv/week?page=${page}`, 'fr-FR', true, 1_800);
}

/** Anime populaires (genre 16 = Animation + langue japonaise) */
export async function getPopularAnime(page = 1) {
  return tmdbFetch<any>(
    `/discover/tv?with_genres=16&with_original_language=ja&sort_by=popularity.desc&page=${page}`,
    'fr-FR', true, 3_600
  );
}

/** Anime les mieux notés */
export async function getTopRatedAnime(page = 1) {
  return tmdbFetch<any>(
    `/discover/tv?with_genres=16&with_original_language=ja&sort_by=vote_average.desc&vote_count.gte=200&page=${page}`,
    'fr-FR', true, 7_200
  );
}

/** Anime en cours de diffusion */
export async function getOnAirAnime(page = 1) {
  return tmdbFetch<any>(
    `/tv/on_the_air?page=${page}`,
    'fr-FR', true, 1_800
  );
}

/** Détails d'un anime avec toutes les relations */
export async function getAnimeDetails(tmdbId: number): Promise<TMDBAnime> {
  return tmdbFetch<TMDBAnime>(
    `/tv/${tmdbId}?append_to_response=credits,videos,similar,external_ids,watch/providers`,
    'fr-FR', true, 3_600
  );
}

/** IDs externes (inclut mal_id, tvdb_id, imdb_id) */
export async function getExternalIds(tmdbId: number) {
  return tmdbFetch<{ imdb_id?: string; tvdb_id?: number; mal_id?: number }>(
    `/tv/${tmdbId}/external_ids`,
    'fr-FR', true, 86_400
  );
}

/** Saison complète avec épisodes */
export async function getSeason(tmdbId: number, seasonNumber: number): Promise<TMDBSeason> {
  return tmdbFetch<TMDBSeason>(
    `/tv/${tmdbId}/season/${seasonNumber}`,
    'fr-FR', true, 3_600
  );
}

/** Épisode individuel */
export async function getEpisode(tmdbId: number, season: number, episode: number): Promise<TMDBEpisode> {
  return tmdbFetch<TMDBEpisode>(
    `/tv/${tmdbId}/season/${season}/episode/${episode}`,
    'fr-FR', true, 7_200
  );
}

/** Recherche multi */
export async function search(query: string, page = 1) {
  return tmdbFetch<any>(
    `/search/multi?query=${encodeURIComponent(query)}&page=${page}&include_adult=false`,
    'fr-FR', false
  );
}

/** Recherche anime uniquement */
export async function searchAnime(query: string, page = 1) {
  return tmdbFetch<any>(
    `/search/tv?query=${encodeURIComponent(query)}&page=${page}&with_genres=16&with_original_language=ja`,
    'fr-FR', false
  );
}

/** Genres TV */
export async function getGenres() {
  return tmdbFetch<{ genres: { id: number; name: string }[] }>(
    `/genre/tv/list`,
    'fr-FR', true, 86_400
  );
}

/** Discover avec filtres */
export async function discover(params: {
  type?: 'tv' | 'movie';
  genres?: string;
  sort?: string;
  language?: string;
  year?: string;
  page?: number;
}) {
  const {
    type = 'tv',
    genres = '16',
    sort = 'popularity.desc',
    language = 'ja',
    year,
    page = 1,
  } = params;

  let ep = `/discover/${type}?with_genres=${genres}&with_original_language=${language}&sort_by=${sort}&page=${page}`;
  if (year) ep += `&${type === 'tv' ? 'first_air_date_year' : 'primary_release_year'}=${year}`;

  return tmdbFetch<any>(ep, 'fr-FR', true, 3_600);
}

/** Recommandations basées sur un anime */
export async function getRecommendations(tmdbId: number, page = 1) {
  return tmdbFetch<any>(`/tv/${tmdbId}/recommendations?page=${page}`, 'fr-FR', true, 7_200);
}

/** Titres alternatifs (pour le mapping provider) */
export async function getAlternativeTitles(tmdbId: number) {
  return tmdbFetch<any>(`/tv/${tmdbId}/alternative_titles`, 'fr-FR', true, 86_400);
}
