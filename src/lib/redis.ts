/**
 * Cache — In-memory uniquement (pas de Redis requis)
 * Compatible avec l'interface utilisée dans le reste du code
 */

const memCache = new Map<string, { v: unknown; exp: number }>();

export function getRedis() { return null; }

export async function cacheGet<T>(key: string): Promise<T | null> {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) { memCache.delete(key); return null; }
  return entry.v as T;
}

export async function cacheSet(key: string, value: unknown, ttl = 3600): Promise<void> {
  memCache.set(key, { v: value, exp: Date.now() + ttl * 1000 });
}

export async function cacheDel(key: string): Promise<void> {
  memCache.delete(key);
}

export async function cacheFlushPattern(pattern: string): Promise<void> {
  const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
  for (const key of memCache.keys()) {
    if (regex.test(key)) memCache.delete(key);
  }
}

export function memGet<T>(key: string): T | null {
  return cacheGet<T>(key) as any;
}

export function memSet(key: string, value: unknown, ttl = 60): void {
  cacheSet(key, value, ttl);
}
