import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

const defaults = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessaie dans quelques minutes.' },
};

/** Limite générale API */
export const apiLimiter = rateLimit({
  ...defaults,
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
});

/** Limite sources (plus strict — scraping) */
export const sourcesLimiter = rateLimit({
  ...defaults,
  windowMs: 60_000,  // 1 min
  max: 30,
  message: { error: 'Trop de requêtes sources, attends 1 minute.' },
});

/** Limite proxy (segments HLS) */
export const proxyLimiter = rateLimit({
  ...defaults,
  windowMs: 60_000,
  max: 500,  // Segments nombreux mais légitimes
  skip: (req) => req.path.includes('/segment'), // Pas de limite sur segments
});

/** Limite sync AniList/MAL */
export const syncLimiter = rateLimit({
  ...defaults,
  windowMs: 60_000,
  max: 20,
});

/** Limite recherche */
export const searchLimiter = rateLimit({
  ...defaults,
  windowMs: 60_000,
  max: 30,
});
