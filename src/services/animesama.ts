/**
 * AnimeSama Scraper — Récupère les vrais liens VOSTFR/VF français
 * Sources : Sibnet, Sendvid, Vidmoly, Ok.ru, Dailymotion
 */

import { cacheGet, cacheSet } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

export interface AnimeSamaEpisode {
  number: number;
  players: AnimeSamaPlayer[];
}

export interface AnimeSamaPlayer {
  name: string;
  url:  string;
  lang: 'vostfr' | 'vf' | 'vo';
}

export interface AnimeSamaAnime {
  slug:     string;
  title:    string;
  url:      string;
  seasons:  AnimeSamaSeason[];
}

export interface AnimeSamaSeason {
  number: number;
  lang:   'vostfr' | 'vf';
  url:    string;
}

const BASE_URL = 'https://anime-sama.fr';
const TIMEOUT  = 10_000;

// ── Fetch helper avec timeout ─────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer':    'https://anime-sama.fr/',
        'Accept':     'text/html,application/xhtml+xml,*/*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── Recherche d'un anime par titre ─────────────────────────────────

export async function searchAnimeSama(query: string): Promise<AnimeSamaAnime | null> {
  const cacheKey = `animesama:search:${query.toLowerCase().trim()}`;
  const cached = await cacheGet<AnimeSamaAnime>(cacheKey);
  if (cached) return cached;

  try {
    // Anime-Sama a un endpoint de recherche interne
    const searchUrl = `${BASE_URL}/catalogue/?search=${encodeURIComponent(query)}`;
    const html = await fetchText(searchUrl);

    // Parse les résultats — format : <a href="/catalogue/SLUG/">
    const matches = [...html.matchAll(/href="\/catalogue\/([^/"]+)\/"[^>]*>([^<]*)/g)];

    if (!matches.length) {
      logger.debug({ query }, 'AnimeSama: aucun résultat');
      return null;
    }

    // Trouve le meilleur match par titre
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    const q = normalize(query);

    let bestSlug: string | null = null;
    let bestScore = 0;

    for (const match of matches) {
      const slug  = match[1]!;
      const title = match[2]?.trim() ?? '';
      const t = normalize(title);

      // Score basique de similarité
      let score = 0;
      if (t === q) score = 100;
      else if (t.includes(q) || q.includes(t)) score = 70;
      else {
        const qWords = q.split(' ');
        const tWords = t.split(' ');
        const common = qWords.filter(w => w.length > 2 && tWords.includes(w)).length;
        score = (common / Math.max(qWords.length, tWords.length)) * 60;
      }

      if (score > bestScore) {
        bestScore = score;
        bestSlug  = slug;
      }
    }

    if (!bestSlug || bestScore < 30) return null;

    // Récupère les saisons disponibles
    const anime = await getAnimeSamaInfo(bestSlug);
    if (anime) {
      await cacheSet(cacheKey, anime, 3600); // 1h
    }
    return anime;

  } catch (err: any) {
    logger.warn({ query, err: err.message }, 'AnimeSama search échoué');
    return null;
  }
}

// ── Récupère les infos d'un anime par slug ────────────────────────

async function getAnimeSamaInfo(slug: string): Promise<AnimeSamaAnime | null> {
  try {
    const url  = `${BASE_URL}/catalogue/${slug}/`;
    const html = await fetchText(url);

    // Extrait le titre
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const title = titleMatch?.[1]?.trim() ?? slug;

    // Cherche les saisons (saison1, saison2, ...) et langs (vostfr, vf)
    const seasons: AnimeSamaSeason[] = [];

    // Pattern : /catalogue/SLUG/saison1/vostfr/
    const seasonMatches = [...html.matchAll(/href="(\/catalogue\/[^"]+\/(saison\d+|film\d*)\/(vostfr|vf)\/?)"/gi)];

    for (const m of seasonMatches) {
      const fullUrl  = `${BASE_URL}${m[1]}`;
      const seasonStr = m[2]?.toLowerCase() ?? '';
      const langStr   = m[3]?.toLowerCase() as 'vostfr' | 'vf' ?? 'vostfr';
      const num = seasonStr.includes('film') ? 0 : parseInt(seasonStr.replace('saison', '')) || 1;

      if (!seasons.find(s => s.number === num && s.lang === langStr)) {
        seasons.push({ number: num, lang: langStr, url: fullUrl });
      }
    }

    return { slug, title, url, seasons };
  } catch (err: any) {
    logger.warn({ slug, err: err.message }, 'AnimeSama getInfo échoué');
    return null;
  }
}

// ── Récupère les épisodes d'une saison ────────────────────────────

export async function getAnimeSamaEpisodes(
  slug: string,
  season: number,
  lang: 'vostfr' | 'vf' = 'vostfr'
): Promise<AnimeSamaEpisode[]> {
  const cacheKey = `animesama:eps:${slug}:s${season}:${lang}`;
  const cached = await cacheGet<AnimeSamaEpisode[]>(cacheKey);
  if (cached) return cached;

  try {
    const seasonStr = season === 0 ? 'film' : `saison${season}`;
    const url = `${BASE_URL}/catalogue/${slug}/${seasonStr}/${lang}/episodes.js`;

    const js = await fetchText(url);
    const episodes = parseEpisodesJs(js, lang);

    if (episodes.length > 0) {
      await cacheSet(cacheKey, episodes, 1800); // 30min
    }

    return episodes;
  } catch (err: any) {
    logger.warn({ slug, season, lang, err: err.message }, 'AnimeSama getEpisodes échoué');
    return [];
  }
}

// ── Parse le fichier episodes.js ──────────────────────────────────

function parseEpisodesJs(js: string, lang: 'vostfr' | 'vf'): AnimeSamaEpisode[] {
  const episodes: AnimeSamaEpisode[] = [];

  // Format : var eps1 = ["url1", "url2", ...];
  // ou : eps1 = ["url1", "url2"];
  // Chaque tableau = épisode, chaque URL = un player disponible
  
  // Cherche tous les tableaux de URLs
  const arrayMatches = [...js.matchAll(/(?:var\s+)?eps(\d+)\s*=\s*\[([^\]]+)\]/g)];

  for (const match of arrayMatches) {
    const epNum  = parseInt(match[1]!) || 0;
    const rawUrls = match[2] ?? '';

    // Extrait les URLs individuelles
    const urlMatches = [...rawUrls.matchAll(/"([^"]+)"/g)];
    const players: AnimeSamaPlayer[] = [];

    for (const urlMatch of urlMatches) {
      const url = urlMatch[1]?.trim() ?? '';
      if (!url || url === 'none') continue;

      const name = detectPlayerName(url);
      players.push({ name, url, lang });
    }

    if (players.length > 0) {
      episodes.push({ number: epNum, players });
    }
  }

  // Si pas de format eps1, essaie le format tableau simple
  if (episodes.length === 0) {
    const simpleMatch = js.match(/\[([^\]]{20,})\]/);
    if (simpleMatch) {
      const urlMatches = [...simpleMatch[1]!.matchAll(/"([^"]+)"/g)];
      let epNum = 1;
      for (const urlMatch of urlMatches) {
        const url = urlMatch[1]?.trim() ?? '';
        if (!url || url === 'none') continue;
        episodes.push({
          number: epNum++,
          players: [{ name: detectPlayerName(url), url, lang }],
        });
      }
    }
  }

  return episodes.sort((a, b) => a.number - b.number);
}

function detectPlayerName(url: string): string {
  if (url.includes('sibnet'))      return 'Sibnet';
  if (url.includes('sendvid'))     return 'Sendvid';
  if (url.includes('vidmoly'))     return 'Vidmoly';
  if (url.includes('ok.ru'))       return 'Ok.ru';
  if (url.includes('dailymotion')) return 'Dailymotion';
  if (url.includes('vk.com'))      return 'VK';
  if (url.includes('streamtape'))  return 'Streamtape';
  if (url.includes('yourupload'))  return 'YourUpload';
  return 'Player';
}

// ── Résolution complète TMDB → Anime-Sama ────────────────────────

export async function resolveAnimeSama(
  title: string,
  season: number,
  episode: number,
  lang: 'vostfr' | 'vf' = 'vostfr'
): Promise<AnimeSamaPlayer[] | null> {
  try {
    // Cherche par titre principal
    let anime = await searchAnimeSama(title);

    if (!anime) {
      logger.debug({ title }, 'AnimeSama: anime non trouvé');
      return null;
    }

    // Vérifie que la saison+lang existe
    const seasonInfo = anime.seasons.find(s => s.number === season && s.lang === lang)
      ?? anime.seasons.find(s => s.number === season)
      ?? anime.seasons[0];

    if (!seasonInfo) return null;

    const episodes = await getAnimeSamaEpisodes(anime.slug, seasonInfo.number, seasonInfo.lang);
    const ep = episodes.find(e => e.number === episode) ?? episodes[episode - 1];

    if (!ep?.players.length) return null;

    logger.info({ title, slug: anime.slug, episode, players: ep.players.length }, '✅ AnimeSama sources trouvées');
    return ep.players;

  } catch (err: any) {
    logger.error({ title, err: err.message }, 'AnimeSama resolve échoué');
    return null;
  }
}
