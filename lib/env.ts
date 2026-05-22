/**
 * Single source of truth for all environment variables.
 * Validated at cold-start using Zod. Any missing or malformed var throws
 * immediately so the app fails fast instead of silently misbehaving.
 *
 * Import `env` from this module instead of accessing process.env directly.
 * Exception: middleware.ts (Edge Runtime) validates its own slim subset.
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  // ── App ──────────────────────────────────────────────────────────────────
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // ── Database ─────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URI'),
  // Max connections per serverless instance. Total usage = DB_POOL_MAX × warm instances.
  DB_POOL_MAX: z.coerce.number().int().positive().default(3),

  // ── Redis (Upstash) ───────────────────────────────────────────────────────
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  REDIS_PREFIX: z.string().default('ky:'),

  // ── JWT ───────────────────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // Optional dedicated refresh secret — prevents an access token from being
  // reused as a refresh token if keys are ever shared or leaked separately.
  // Falls back to JWT_SECRET when not set (backwards-compatible).
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // ── M-Pesa (Safaricom Daraja) ─────────────────────────────────────────────
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().min(1, 'MPESA_CONSUMER_KEY is required'),
  MPESA_CONSUMER_SECRET: z.string().min(1, 'MPESA_CONSUMER_SECRET is required'),
  MPESA_SHORTCODE: z.string().min(1, 'MPESA_SHORTCODE is required'),
  MPESA_PASSKEY: z.string().min(1, 'MPESA_PASSKEY is required'),
  MPESA_CALLBACK_URL: z.string().url('MPESA_CALLBACK_URL must be a valid URL'),
  MPESA_B2C_INITIATOR_NAME: z.string().optional(),
  MPESA_B2C_INITIATOR_PASSWORD: z.string().optional(),
  MPESA_B2C_QUEUE_TIMEOUT_URL: z.string().url().optional(),
  MPESA_B2C_RESULT_URL: z.string().url().optional(),

  // ── SMS (Africa's Talking) ────────────────────────────────────────────────
  AT_API_KEY: z.string().min(1, 'AT_API_KEY is required'),
  AT_USERNAME: z.string().default('sandbox'),
  AT_SENDER_ID: z.string().default('KitabuYetu'),

  // ── SMS (TextSMS Kenya — alternative provider) ────────────────────────────
  TEXTSMS_API_KEY: z.string().optional(),
  TEXTSMS_SENDER_ID: z.string().optional(),
  TEXTSMS_PARTNER_ID: z.string().optional(),

  // ── Email ─────────────────────────────────────────────────────────────────
  EMAIL_PROVIDER: z
    .enum(['resend', 'sendgrid', 'ses', 'mailgun', 'smtp'])
    .default('resend'),
  EMAIL_FROM: z.string().email('EMAIL_FROM must be a valid email address'),
  EMAIL_ADMIN: z.string().email().optional(),
  EMAIL_DRY_RUN: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),

  // ── Encryption ────────────────────────────────────────────────────────────
  ENCRYPTION_KEY: z
    .string()
    .min(32, 'ENCRYPTION_KEY must be at least 32 characters (use: openssl rand -hex 32)'),

  // ── Worker / Cron auth ────────────────────────────────────────────────────
  // WORKER_SECRET: used to authenticate manual POST calls to /api/v1/workers/cron
  WORKER_SECRET: z
    .string()
    .min(32, 'WORKER_SECRET must be at least 32 characters (use: openssl rand -hex 32)'),
  // CRON_SECRET: Vercel automatically sets this and includes it in cron GET requests
  CRON_SECRET: z.string().optional(),

  // ── Rate limiting / auth policy ───────────────────────────────────────────
  MAX_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(30),

  // ── Import limits ─────────────────────────────────────────────────────────
  CSV_MAX_ROWS: z.coerce.number().int().positive().default(5000),

  // ── Supabase JS client (Storage + Realtime) ───────────────────────────────
  // Not required for core auth/DB (which use raw pg), but needed for
  // Storage uploads, Realtime subscriptions, and the Supabase SSR client.
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`\n[env] Invalid environment variables:\n${issues}\n`);
  }
  return result.data;
}

// Exported as a function so callers import `env` not `getEnv()`.
// During Next.js build (NEXT_PHASE=phase-production-build) or when
// SKIP_ENV_VALIDATION=1 is set, skip strict Zod validation so the build
// succeeds without every production secret being present in the build env.
// Real validation still runs at cold-start in the deployed runtime.
export const env: Env = (() => {
  if (
    process.env.SKIP_ENV_VALIDATION === '1' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  ) {
    return process.env as unknown as Env;
  }
  return validateEnv();
})();
