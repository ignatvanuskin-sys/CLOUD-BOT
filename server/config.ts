import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  BOT_TOKEN: z.union([z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/), z.literal('TEST_TOKEN')]).optional(),
  BOT_USERNAME: z.string().regex(/^[A-Za-z0-9_]{5,32}$/).optional(),
  WEBAPP_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+$/).optional(),
  CORS_ORIGIN: z.string().url().optional(),

  DB_DRIVER: z.enum(['sqlite', 'postgres']).default('sqlite'),
  DATABASE_PATH: z.string().default('./data/cloud-bot.sqlite'),
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(3600),
  ALLOW_DEV_LOGIN: z.enum(['true', 'false']).default('false'),
  ADMIN_TELEGRAM_IDS: z.string().default(''),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./storage/private'),
  DOWNLOAD_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(200 * 1024 * 1024).default(50 * 1024 * 1024),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),

  REDIS_URL: z.string().optional(),
  REDIS_KEY_PREFIX: z.string().default('cloud-bot:local:'),
  REDIS_TLS: z.enum(['true', 'false']).default('false'),
  DATABASE_SSL_REJECT_UNAUTHORIZED: z.enum(['true', 'false']).optional(),
});

export type AppConfig = z.infer<typeof EnvSchema> & { isProduction: boolean; allowedOrigin?: string };

export function loadConfig(env = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) throw new Error('Invalid environment: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));

  const config = parsed.data;
  const isProduction = config.NODE_ENV === 'production';
  const missing: string[] = [];
  if (isProduction) {
    for (const key of ['BOT_TOKEN', 'BOT_USERNAME', 'WEBAPP_URL', 'WEBHOOK_SECRET', 'CORS_ORIGIN', 'DATABASE_URL', 'REDIS_URL', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (!config[key]) missing.push(key);
    }
    if (config.ALLOW_DEV_LOGIN === 'true') missing.push('ALLOW_DEV_LOGIN must be false in production');
    for (const [key, value] of [['WEBAPP_URL', config.WEBAPP_URL], ['CORS_ORIGIN', config.CORS_ORIGIN]] as const) {
      if (value && new URL(value).protocol !== 'https:') missing.push(`${key} must use https in production`);
    }
    if (config.DB_DRIVER !== 'postgres') missing.push('DB_DRIVER must be postgres in production');
    if (config.STORAGE_DRIVER !== 's3') missing.push('STORAGE_DRIVER must be s3 in production');
    const onRailway = process.env.RAILWAY_ENVIRONMENT_NAME === 'production' || Boolean(process.env.RAILWAY_PROJECT_ID);
    if (config.REDIS_TLS !== 'true' && !(onRailway && config.REDIS_URL?.startsWith('redis://'))) {
      missing.push('REDIS_TLS must be true in production');
    }
  }
  if (missing.length) throw new Error('Production configuration error: ' + missing.join(', '));
  return { ...config, isProduction, allowedOrigin: config.CORS_ORIGIN || config.WEBAPP_URL };
}
