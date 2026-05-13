/**
 * BullMQ Jobs — Tâches background
 * - Cache warmup : pré-chauffe le cache au démarrage
 * - Mapping preload : résout les mappings des trending
 * - Stats : log des métriques périodiques
 */

import { Queue, Worker, Job } from 'bullmq';
import { getRedis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { getTrending, getPopularAnime } from '../services/tmdb.js';
import { resolveMapping } from '../services/mapping.js';
import { getTrendingAniList } from '../services/anilist.js';

// ── Setup ─────────────────────────────────────────────────────────

let cacheQueue: Queue | null = null;
let mappingQueue: Queue | null = null;
let cacheWorker: Worker | null = null;
let mappingWorker: Worker | null = null;

const QUEUE_CONNECTION_OPTS = {
  connection: {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  },
};

export function initJobs(): void {
  const redis = getRedis();
  if (!redis) {
    logger.warn('⚠️  BullMQ désactivé — Redis indisponible');
    return;
  }

  const conn = { host: redis.options.host as string, port: redis.options.port as number };

  // ── Queues ──────────────────────────────────────────────────────
  cacheQueue = new Queue('cache-warmup', { connection: conn });
  mappingQueue = new Queue('mapping-preload', { connection: conn });

  // ── Workers ─────────────────────────────────────────────────────

  cacheWorker = new Worker('cache-warmup', async (job: Job) => {
    logger.debug({ jobId: job.id, name: job.name }, 'Cache warmup job...');

    switch (job.name) {
      case 'warmup-trending':
        await Promise.allSettled([
          getTrending(1),
          getPopularAnime(1),
          getTrendingAniList(1),
        ]);
        break;

      case 'warmup-pages':
        await Promise.allSettled(
          [2, 3].map(page => getPopularAnime(page))
        );
        break;
    }
  }, {
    connection: conn,
    concurrency: 2,
  });

  mappingWorker = new Worker('mapping-preload', async (job: Job) => {
    const { tmdbIds } = job.data as { tmdbIds: number[] };
    for (const id of tmdbIds) {
      await resolveMapping(id).catch(err =>
        logger.warn({ id, err: err.message }, 'Mapping preload échoué')
      );
      // Délai entre requêtes pour ne pas surcharger les providers
      await sleep(500);
    }
  }, {
    connection: conn,
    concurrency: 1,
  });

  // Gestion d'erreurs workers
  for (const worker of [cacheWorker, mappingWorker]) {
    worker?.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, err: err.message }, 'Job échoué');
    });
    worker?.on('completed', (job) => {
      logger.debug({ jobId: job.id, name: job.name }, 'Job terminé');
    });
  }

  logger.info('✅ BullMQ initialisé');

  // ── Schedule initial warmup ──────────────────────────────────────
  scheduleWarmup();
}

export async function scheduleWarmup(): Promise<void> {
  if (!cacheQueue) return;

  try {
    await cacheQueue.add('warmup-trending', {}, {
      delay: 2_000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });

    await cacheQueue.add('warmup-pages', {}, {
      delay: 10_000,
      attempts: 2,
    });

    logger.info('📋 Warmup schedulé');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Schedule warmup échoué');
  }
}

/** Précharge les mappings pour une liste de TMDB IDs */
export async function scheduleMappingPreload(tmdbIds: number[]): Promise<void> {
  if (!mappingQueue || !tmdbIds.length) return;

  // Divise en chunks de 10
  const chunks: number[][] = [];
  for (let i = 0; i < tmdbIds.length; i += 10) {
    chunks.push(tmdbIds.slice(i, i + 10));
  }

  for (let i = 0; i < chunks.length; i++) {
    await mappingQueue.add('preload-chunk', { tmdbIds: chunks[i] }, {
      delay: i * 5_000, // Étale les jobs
      attempts: 2,
    }).catch(() => {});
  }
}

export async function closeJobs(): Promise<void> {
  await Promise.allSettled([
    cacheWorker?.close(),
    mappingWorker?.close(),
    cacheQueue?.close(),
    mappingQueue?.close(),
  ]);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
