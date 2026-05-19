import { Request, Response, NextFunction } from 'express';
import { cacheGet, cacheSet } from '../lib/redis.js';

interface CacheOptions {
  ttl?: number;         // Secondes
  keyFn?: (req: Request) => string;
  condition?: (req: Request) => boolean;
}

/**
 * Middleware cache Redis — met en cache les réponses JSON
 * Usage : router.get('/route', cacheMiddleware({ ttl: 300 }), handler)
 */
export function cacheMiddleware(options: CacheOptions = {}) {
  const { ttl = 300, keyFn, condition } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Ne cache pas si condition false
    if (condition && !condition(req)) return next();

    // Clé de cache
    const key = keyFn
      ? keyFn(req)
      : `route:${req.method}:${req.originalUrl}`;

    try {
      const cached = await cacheGet<any>(key);
      if (cached !== null) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Key', key);
        return res.json(cached);
      }
    } catch { /* Redis indisponible */ }

    // Intercepte res.json pour mettre en cache
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      // Ne cache pas les erreurs
      if (res.statusCode < 400) {
        cacheSet(key, body, ttl).catch(() => {});
        res.setHeader('X-Cache', 'MISS');
      }
      return originalJson(body);
    };

    next();
  };
}

/** TTLs prédéfinis */
export const CacheTTL = {
  LIVE:    30,         // 30s — données live (trending, on-air)
  SHORT:   300,        // 5min — recherches
  MEDIUM:  3_600,      // 1h — détails, épisodes
  LONG:    86_400,     // 24h — genres, mappings stables
  WEEK:    604_800,    // 7j — données rarement modifiées
} as const;
