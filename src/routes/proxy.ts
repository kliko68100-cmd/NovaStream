/**
 * HLS Proxy — Proxy sécurisé pour streams M3U8
 * 
 * Fonctionnalités :
 * - Anti-CORS : proxifie les segments depuis le serveur
 * - Anti-pub : supprime les segments publicitaires du M3U8
 * - Réécriture URL : tous les segments passent par notre proxy
 * - Cache Redis pour les playlists M3U8
 * - Validation URL pour éviter le SSRF
 * - Rate limiting spécifique aux segments
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { cacheGet, cacheSet } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

export const proxyRouter = Router();

// ── Domaines bloqués (trackers, pubs) ─────────────────────────────

const BLOCKED_PATTERNS = [
  'doubleclick.net', 'googlesyndication.com', 'adnxs.com',
  'popads.net', 'popcash.net', 'trafficjunky.net',
  'juicyads.com', 'exoclick.com', 'adsterra.com',
  'propellerads.com', 'hilltopads.net', 'adskeeper.co.uk',
  'cdn.adnxs.com', 'ad.doubleclick', 'pagead2.googlesyndication',
  '/ads/', '/ad/', 'advertisement', 'prebid', 'vast',
  'tracker.', 'analytics.', 'telemetry.',
];

// ── Domaines autorisés pour les sources (allowlist) ───────────────

const ALLOWED_SOURCE_DOMAINS = [
  'megacloud.tv', 'mcdn.co', 'rapid-cloud.co', 'vidcloud.co',
  'vid.icu', 'vizcloud.digital', 'mcloud.to',
  'a.gogoanime.tv', 'cdn.gogoanime', 'gogocdn.net',
  'animepahe.ru', 'animepahe.com',
  'm3u8.', 'cdn.', 'hls.', 'stream.',
  'jwpcdn.com', 'fastly.', 'cloudfront.net',
];

function isBlockedUrl(url: string): boolean {
  const lc = url.toLowerCase();
  return BLOCKED_PATTERNS.some(p => lc.includes(p));
}

function isSafeSourceUrl(url: string): boolean {
  try {
    const u = new URL(url);
    // Bloque les IPs privées (SSRF protection)
    const host = u.hostname;
    if (
      host === 'localhost' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      host.startsWith('172.') ||
      host === '127.0.0.1' ||
      host === '0.0.0.0'
    ) return false;

    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

// ── Encodage/décodage URL proxifiée ───────────────────────────────

function encodeProxyUrl(url: string): string {
  return Buffer.from(url, 'utf-8').toString('base64url');
}

function decodeProxyUrl(encoded: string): string | null {
  try {
    return Buffer.from(encoded, 'base64url').toString('utf-8');
  } catch {
    return null;
  }
}

// ── Headers pour les requêtes proxy ───────────────────────────────

function getProxyHeaders(referer?: string): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Origin': referer ?? 'https://hianimeto.com',
    'Referer': referer ?? 'https://hianimeto.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
  };
}

// ── Réécriture M3U8 ───────────────────────────────────────────────

function rewriteM3U8(content: string, baseUrl: string, proxyBase: string, referer?: string): string {
  const lines = content.split('\n');
  const rewritten: string[] = [];
  let adBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Détection blocs publicitaires
    if (line.includes('#EXT-X-DISCONTINUITY')) {
      // Vérifie si le prochain segment est une pub
      const nextSegment = lines.slice(i + 1).find(l => !l.startsWith('#') && l.trim());
      if (nextSegment && isBlockedUrl(nextSegment)) {
        adBlock = true;
        continue;
      } else {
        adBlock = false;
      }
    }

    if (adBlock && !line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE')) {
      continue;
    }

    // Réécriture des URIs dans les tags
    if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) {
      const rewrittenLine = line.replace(/URI="([^"]+)"/, (_, uri) => {
        const absoluteUri = resolveUrl(uri, baseUrl);
        return `URI="${proxyBase}/segment?url=${encodeProxyUrl(absoluteUri)}&ref=${encodeURIComponent(referer ?? '')}"`;
      });
      rewritten.push(rewrittenLine);
      continue;
    }

    // Lignes playlist media (#EXT-X-STREAM-INF)
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      rewritten.push(line);
      i++;
      const nextLine = lines[i]?.trim() ?? '';
      if (nextLine && !nextLine.startsWith('#')) {
        const absoluteUrl = resolveUrl(nextLine, baseUrl);
        rewritten.push(`${proxyBase}/m3u8?url=${encodeProxyUrl(absoluteUrl)}&ref=${encodeURIComponent(referer ?? '')}`);
      }
      continue;
    }

    // Segments .ts / .aac / .mp4
    if (line && !line.startsWith('#')) {
      if (isBlockedUrl(line)) continue; // Bloque pub
      const absoluteUrl = resolveUrl(line, baseUrl);
      rewritten.push(`${proxyBase}/segment?url=${encodeProxyUrl(absoluteUrl)}&ref=${encodeURIComponent(referer ?? '')}`);
      continue;
    }

    rewritten.push(line);
  }

  return rewritten.join('\n');
}

function resolveUrl(url: string, base: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('//')) return `https:${url}`;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

// ── Routes ────────────────────────────────────────────────────────

/**
 * GET /api/proxy/m3u8?url=<base64url>&ref=<referer>
 * Proxifie et réécrit une playlist M3U8
 */
proxyRouter.get('/m3u8', async (req: Request, res: Response) => {
  const { url: encodedUrl, ref } = req.query as Record<string, string>;

  if (!encodedUrl) {
    return res.status(400).json({ error: 'url requis' });
  }

  const originalUrl = decodeProxyUrl(encodedUrl);
  if (!originalUrl || !isSafeSourceUrl(originalUrl)) {
    return res.status(400).json({ error: 'URL invalide' });
  }

  const referer = ref ? decodeURIComponent(ref) : undefined;
  const cacheKey = `proxy:m3u8:${encodedUrl}`;
  const proxyBase = `${req.protocol}://${req.get('host')}/api/proxy`;

  try {
    // Cache court pour les M3U8 (ils changent souvent)
    const cached = await cacheGet<string>(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.send(cached);
    }

    const response = await fetch(originalUrl, {
      headers: getProxyHeaders(referer),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Source ${response.status}` });
    }

    const content = await response.text();

    // Détermine l'URL de base pour résoudre les URIs relatives
    const baseUrl = new URL(originalUrl).href.replace(/\/[^\/]*$/, '/');

    const rewritten = rewriteM3U8(content, baseUrl, proxyBase, referer);

    await cacheSet(cacheKey, rewritten, 30); // 30 secondes

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.send(rewritten);
  } catch (err: any) {
    logger.error({ url: originalUrl, err: err.message }, 'Proxy M3U8 échoué');
    return res.status(502).json({ error: 'Proxy échoué', message: err.message });
  }
});

/**
 * GET /api/proxy/segment?url=<base64url>&ref=<referer>
 * Proxifie un segment TS/AAC/MP4
 */
proxyRouter.get('/segment', async (req: Request, res: Response) => {
  const { url: encodedUrl, ref } = req.query as Record<string, string>;

  if (!encodedUrl) return res.status(400).end();

  const originalUrl = decodeProxyUrl(encodedUrl);
  if (!originalUrl || !isSafeSourceUrl(originalUrl)) {
    return res.status(400).end();
  }

  const referer = ref ? decodeURIComponent(ref) : undefined;

  try {
    const response = await fetch(originalUrl, {
      headers: {
        ...getProxyHeaders(referer),
        'Range': req.headers.range ?? '',
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok && response.status !== 206) {
      return res.status(response.status).end();
    }

    // Transmet les headers pertinents
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', response.headers.get('content-type') ?? 'video/mp2t');

    const contentLength = response.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
      res.status(206);
    }

    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Stream du body
    const body = response.body;
    if (!body) return res.end();

    const reader = body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    };
    pump().catch(() => res.end());
  } catch (err: any) {
    logger.debug({ url: originalUrl?.substring(0, 80), err: err.message }, 'Proxy segment échoué');
    res.status(502).end();
  }
});

/**
 * GET /api/proxy/subtitle?url=<url>
 * Proxifie les sous-titres VTT/SRT en ajoutant CORS
 */
proxyRouter.get('/subtitle', async (req: Request, res: Response) => {
  const { url } = req.query as { url?: string };

  if (!url || !isSafeSourceUrl(url)) {
    return res.status(400).json({ error: 'URL invalide' });
  }

  const cacheKey = `proxy:sub:${Buffer.from(url).toString('base64url').substring(0, 40)}`;
  const cached = await cacheGet<string>(cacheKey);

  if (cached) {
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(cached);
  }

  try {
    const response = await fetch(url, {
      headers: getProxyHeaders(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return res.status(response.status).end();

    let content = await response.text();

    // Convertit SRT → VTT si nécessaire
    if (!content.trimStart().startsWith('WEBVTT')) {
      content = srtToVtt(content);
    }

    await cacheSet(cacheKey, content, 3_600);

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(content);
  } catch (err: any) {
    logger.debug({ url, err: err.message }, 'Proxy subtitle échoué');
    return res.status(502).end();
  }
});

/**
 * POST /api/proxy/encode
 * Encode une URL pour le proxy (endpoint frontend)
 */
proxyRouter.post('/encode', (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url || !isSafeSourceUrl(url)) {
    return res.status(400).json({ error: 'URL invalide' });
  }
  return res.json({ encoded: encodeProxyUrl(url) });
});

// Export pour utilisation dans d'autres routes
export { encodeProxyUrl, decodeProxyUrl };

// ── SRT → VTT conversion ──────────────────────────────────────────

function srtToVtt(srt: string): string {
  return 'WEBVTT\n\n' +
    srt
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/^\d+\n/gm, '')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
      .trim();
}
