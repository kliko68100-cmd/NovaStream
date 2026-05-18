import express from 'express';
import cors from 'cors';
import { config, CORS_ORIGINS } from './config/index.js';
import { catalogRouter } from './routes/catalog.js';
import { sourcesRouter } from './routes/sources.js';
import { proxyRouter } from './routes/proxy.js';
import { syncRouter } from './routes/anilist-sync.js';
import { logger } from './lib/logger.js';
import { sourcesLimiter, proxyLimiter, syncLimiter } from './middleware/rateLimiter.js';

const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || CORS_ORIGINS.includes(origin) || config.NODE_ENV === 'development') {
      cb(null, true);
    } else {
      cb(new Error(`CORS bloqué: ${origin}`));
    }
  },
  credentials: true,
}));

// Routes
app.use('/api', catalogRouter);              // AniList catalogue
app.use('/api/sources', sourcesLimiter);
app.use('/api/sources', sourcesRouter);      // Sources vidéo + Anime-Sama
app.use('/api/proxy', proxyLimiter);
app.use('/api/proxy', proxyRouter);          // HLS proxy
app.use('/api/sync', syncLimiter);
app.use('/api/sync', syncRouter);            // Sync AniList

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '5.0.0', timestamp: new Date().toISOString() });
});

app.use((err: any, _req: any, res: any, _next: any) => {
  logger.error({ err: err.message }, 'Erreur non gérée');
  res.status(500).json({ error: 'Erreur interne' });
});

const PORT = config.PORT || 3001;
app.listen(PORT, () => {
  logger.info(`🚀 NovaStream API v5.0 — port ${PORT}`);
  logger.info(`🔗 CORS: ${CORS_ORIGINS.join(', ')}`);
});
