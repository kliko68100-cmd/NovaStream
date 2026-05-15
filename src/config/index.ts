import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  TMDB_KEY: z.string().min(1, 'TMDB_KEY est requis'),

  ANILIST_CLIENT_ID: z.string().optional(),
  ANILIST_CLIENT_SECRET: z.string().optional(),

  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_TOKEN: z.string().optional(),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().default(500),

  PROVIDER_TIMEOUT: z.coerce.number().default(15_000),
  PROXY_CACHE_TTL: z.coerce.number().default(3_600),

  HLS_PROXY_SECRET: z.string().default('novastream_default_secret'),

  MAL_CLIENT_ID: z.string().optional(),
  MAL_CLIENT_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Config invalide :');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

export const TMDB_API  = 'https://api.themoviedb.org/3';
export const TMDB_IMG  = 'https://image.tmdb.org/t/p';
export const ANILIST_API = 'https://graphql.anilist.co';
export const MAL_API   = 'https://api.myanimelist.net/v2';
export const ANISKIP_API = 'https://api.aniskip.com/v2';

export const CORS_ORIGINS = config.CORS_ORIGINS
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
