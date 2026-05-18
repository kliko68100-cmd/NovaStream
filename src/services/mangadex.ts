/**
 * MangaDex API — Manga/Webtoon en VF uniquement
 */

import { cacheGet, cacheSet } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const BASE = 'https://api.mangadex.org';
const TIMEOUT = 10_000;

async function mdFetch(path: string, params: Record<string, any> = {}): Promise<any> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(i => url.searchParams.append(k, String(i)));
    else url.searchParams.set(k, String(v));
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'NovaStream/4.0' },
    });
    if (!res.ok) throw new Error(`MangaDex HTTP ${res.status}`);
    return res.json();
  } finally { clearTimeout(t); }
}

function getCoverUrl(manga: any): string | null {
  const cover = manga.relationships?.find((r: any) => r.type === 'cover_art');
  if (!cover?.attributes?.fileName) return null;
  return `https://uploads.mangadex.org/covers/${manga.id}/${cover.attributes.fileName}.512.jpg`;
}

function getTitle(manga: any): string {
  const attrs = manga.attributes;
  return attrs.title?.fr ?? attrs.title?.en ?? attrs.title?.['ja-ro'] ?? Object.values(attrs.title ?? {})[0] ?? 'Sans titre';
}

function getDescription(manga: any): string {
  const attrs = manga.attributes;
  return attrs.description?.fr ?? attrs.description?.en ?? '';
}

function formatManga(manga: any) {
  return {
    id:          manga.id,
    title:       getTitle(manga),
    description: getDescription(manga),
    cover:       getCoverUrl(manga),
    status:      manga.attributes.status,
    year:        manga.attributes.year,
    genres:      (manga.attributes.tags ?? [])
                   .filter((t: any) => t.attributes.group === 'genre')
                   .map((t: any) => t.attributes.name?.en ?? ''),
    rating:      manga.attributes.contentRating,
    type:        manga.attributes.originalLanguage === 'ko' ? 'webtoon'
                 : manga.attributes.originalLanguage === 'zh' ? 'manhua'
                 : 'manga',
    lastChapter: manga.attributes.lastChapter,
  };
}

// ── Popular ───────────────────────────────────────────────────────

export async function getPopularManga(page = 1) {
  const cacheKey = `mangadex:popular:${page}`;
  const cached = await cacheGet<any>(cacheKey);
  if (cached) return cached;

  const data = await mdFetch('/manga', {
    limit: 24,
    offset: (page - 1) * 24,
    'availableTranslatedLanguage[]': 'fr',
    'includes[]': ['cover_art'],
    order: { followedCount: 'desc' },
    hasAvailableChapters: true,
    contentRating: ['safe', 'suggestive'],
  });

  const result = {
    results: (data.data ?? []).map(formatManga),
    total: data.total,
    page,
  };
  await cacheSet(cacheKey, result, 600);
  return result;
}

// ── Search ────────────────────────────────────────────────────────

export async function searchManga(query: string, page = 1) {
  const data = await mdFetch('/manga', {
    title: query,
    limit: 20,
    offset: (page - 1) * 20,
    'availableTranslatedLanguage[]': 'fr',
    'includes[]': ['cover_art'],
    hasAvailableChapters: true,
    contentRating: ['safe', 'suggestive'],
  });
  return {
    results: (data.data ?? []).map(formatManga),
    total: data.total,
    page,
    query,
  };
}

// ── Details ───────────────────────────────────────────────────────

export async function getMangaDetails(id: string) {
  const cacheKey = `mangadex:details:${id}`;
  const cached = await cacheGet<any>(cacheKey);
  if (cached) return cached;

  const data = await mdFetch(`/manga/${id}`, {
    'includes[]': ['cover_art', 'author', 'artist'],
  });

  const manga = formatManga(data.data);
  const authors = (data.data.relationships ?? [])
    .filter((r: any) => r.type === 'author' || r.type === 'artist')
    .map((r: any) => r.attributes?.name)
    .filter(Boolean);

  const result = { ...manga, authors };
  await cacheSet(cacheKey, result, 3600);
  return result;
}

// ── Chapters ──────────────────────────────────────────────────────

export async function getMangaChapters(mangaId: string, page = 1) {
  const cacheKey = `mangadex:chapters:${mangaId}:${page}`;
  const cached = await cacheGet<any>(cacheKey);
  if (cached) return cached;

  const data = await mdFetch('/chapter', {
    manga: mangaId,
    'translatedLanguage[]': 'fr',
    limit: 100,
    offset: (page - 1) * 100,
    order: { chapter: 'asc' },
    'includes[]': ['scanlation_group'],
  });

  const chapters = (data.data ?? []).map((ch: any) => ({
    id:      ch.id,
    number:  ch.attributes.chapter,
    title:   ch.attributes.title ?? `Chapitre ${ch.attributes.chapter}`,
    pages:   ch.attributes.pages,
    date:    ch.attributes.publishAt,
    group:   ch.relationships?.find((r: any) => r.type === 'scanlation_group')?.attributes?.name ?? 'Inconnu',
  }));

  const result = { chapters, total: data.total, page };
  await cacheSet(cacheKey, result, 300);
  return result;
}

// ── Chapter pages ─────────────────────────────────────────────────

export async function getChapterPages(chapterId: string) {
  const cacheKey = `mangadex:pages:${chapterId}`;
  const cached = await cacheGet<any>(cacheKey);
  if (cached) return cached;

  const data = await mdFetch(`/at-home/server/${chapterId}`);
  const base = data.baseUrl;
  const hash = data.chapter.hash;
  const pages = (data.chapter.data ?? []).map((f: string) => `${base}/data/${hash}/${f}`);
  const pagesLow = (data.chapter.dataSaver ?? []).map((f: string) => `${base}/data-saver/${hash}/${f}`);

  const result = { pages, pagesLow, total: pages.length };
  await cacheSet(cacheKey, result, 3600);
  return result;
}

// ── Latest updates ────────────────────────────────────────────────

export async function getLatestManga(page = 1) {
  const cacheKey = `mangadex:latest:${page}`;
  const cached = await cacheGet<any>(cacheKey);
  if (cached) return cached;

  const data = await mdFetch('/manga', {
    limit: 24,
    offset: (page - 1) * 24,
    'availableTranslatedLanguage[]': 'fr',
    'includes[]': ['cover_art'],
    order: { updatedAt: 'desc' },
    hasAvailableChapters: true,
    contentRating: ['safe', 'suggestive'],
  });

  const result = { results: (data.data ?? []).map(formatManga), total: data.total, page };
  await cacheSet(cacheKey, result, 300);
  return result;
}

// ── By genre ─────────────────────────────────────────────────────

export async function getMangaByGenre(tagId: string, page = 1) {
  const data = await mdFetch('/manga', {
    'includedTags[]': [tagId],
    'availableTranslatedLanguage[]': 'fr',
    'includes[]': ['cover_art'],
    limit: 24,
    offset: (page - 1) * 24,
    order: { followedCount: 'desc' },
    hasAvailableChapters: true,
    contentRating: ['safe', 'suggestive'],
  });
  return { results: (data.data ?? []).map(formatManga), total: data.total };
}
