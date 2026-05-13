import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { config, CORS_ORIGINS } from './config/index.js';
import { logger } from './lib/logger.js';
import { catalogRouter } from './routes/catalog.js';
import { sourcesRouter } from './routes/sources.js';
import { proxyRouter } from './routes/proxy.js';
import { syncRouter } from './routes/anilist-sync.js';
import { apiLimiter, sourcesLimiter, proxyLimiter, syncLimiter, searchLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { initJobs, closeJobs } from './jobs/index.js';

const app = express();

// ── Security & Middleware ──────────────────────────────────────────

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || CORS_ORIGINS.includes(origin) || config.NODE_ENV === 'development') {
      cb(null, true);
    } else {
      cb(new Error(`CORS bloqué: ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
}));

app.use(compression());
app.use(express.json({ limit: '1mb' }));

// ── Rate Limiting ──────────────────────────────────────────────────

app.use('/api/', apiLimiter);
app.use('/api/sources', sourcesLimiter);
app.use('/api/proxy', proxyLimiter);
app.use('/api/sync', syncLimiter);

// ── Routes ────────────────────────────────────────────────────────

app.use('/api', catalogRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/proxy', proxyRouter);
app.use('/api/sync', syncRouter);

// ── Health check ──────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '4.0.0',
    timestamp: new Date().toISOString(),
    env: config.NODE_ENV,
    features: [
      'multi-provider', 'hls-proxy', 'redis-cache', 'bullmq-jobs',
      'anilist-sync', 'aniskip', 'subtitle-proxy', 'anti-ads',
      'tmdb-mapping', 'vf-vostfr',
    ],
  });
});

// ── 404 & Error handlers ──────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────

const server = app.listen(config.PORT, () => {
  logger.info(`🚀 NovaStream API v4.0 — port ${config.PORT} [${config.NODE_ENV}]`);
  logger.info(`📡 TMDB_KEY  : ${config.TMDB_KEY ? '✅' : '❌ MANQUANTE'}`);
  logger.info(`🔴 Redis     : ${config.REDIS_URL}`);
  logger.info(`🔗 CORS      : ${CORS_ORIGINS.join(', ')}`);
});

// Init BullMQ après le démarrage du serveur
initJobs();

// ── Graceful shutdown ─────────────────────────────────────────────

async function shutdown(signal: string) {
  logger.info(`${signal} reçu — arrêt gracieux...`);
  server.close(async () => {
    await closeJobs();
    logger.info('✅ Serveur arrêté proprement');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection');
});

export default app;
