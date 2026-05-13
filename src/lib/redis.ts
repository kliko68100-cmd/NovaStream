import Redis from 'ioredis';
import { config } from '../config/index.js';

let redis: Redis | null = null;

function createRedisClient(): Redis | null {
  try {
    const client = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5_000,
      lazyConnect: true,
      enableReadyCheck: true,
      ...(config.REDIS_TOKEN ? { password: config.REDIS_TOKEN } : {}),
    });

    client.on('error', (err) => {
      if (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND')) {
        // Redis indisponible — mode sans cache
      } else {
        console.error('[Redis] Erreur:', err.message);
      }
    });

    client.on('connect', () => console.log('✅ Redis connecté'));
    return client;
  } catch {
    console.warn('⚠️  Redis désactivé — cache en mémoire uniquement');
    return null;
  }
}

export function getRedis(): Redis | null {
  if (!redis) redis = createRedisClient();
  return redis;
}

// ── Cache helpers ────────────────────────────────────────────────

/** Récupère une valeur JSON depuis Redis, null si absent/erreur */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const r = getRedis();
    if (!r) return null;
    const raw = await r.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Stocke une valeur JSON dans Redis avec TTL (secondes) */
export async function cacheSet(key: string, value: unknown, ttl = 3600): Promise<void> {
  try {
    const r = getRedis();
    if (!r) return;
    await r.setex(key, ttl, JSON.stringify(value));
  } catch {
    // Silencieux — cache optionnel
  }
}

/** Supprime une clé */
export async function cacheDel(key: string): Promise<void> {
  try {
    const r = getRedis();
    if (!r) return;
    await r.del(key);
  } catch { /* */ }
}

/** Pattern suppression (ex: "catalog:*") */
export async function cacheFlushPattern(pattern: string): Promise<void> {
  try {
    const r = getRedis();
    if (!r) return;
    const keys = await r.keys(pattern);
    if (keys.length) await r.del(...keys);
  } catch { /* */ }
}

// ── In-memory fallback (pour dev sans Redis) ─────────────────────
const memCache = new Map<string, { v: unknown; exp: number }>();

export function memGet<T>(key: string): T | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) { memCache.delete(key); return null; }
  return entry.v as T;
}

export function memSet(key: string, value: unknown, ttl = 60): void {
  memCache.set(key, { v: value, exp: Date.now() + ttl * 1000 });
}
