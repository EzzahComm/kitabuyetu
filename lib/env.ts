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
  // Backoffice tokens are issued to platform staff (super_admin/support/
  // organization_coordinator) by /api/v1/auth/admin/login. Tighter TTLs than tenant
  // tokens because the blast radius of a stolen platform token is much
  // larger (cross-tenant access).
  BACKOFFICE_ACCESS_EXPIRES_IN:  z.string().default('15m'),
  BACKOFFICE_REFRESH_EXPIRES_IN: z.string().default('8h'),

  // ── M-Pesa (Safaricom Daraja) ─────────────────────────────────────────────
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().min(1, 'MPESA_CONSUMER_KEY is required'),
  MPESA_CONSUMER_SECRET: z.string().min(1, 'MPESA_CONSUMER_SECRET is required'),
  MPESA_SHORTCODE: z.string().min(1, 'MPESA_SHORTCODE is required'),
  MPESA_PASSKEY: z.string().min(1, 'MPESA_PASSKEY is required'),
  // Base URL of the deployment (no trailing slash, no path).
  // All callback paths are derived as `${MPESA_CALLBACK_BASE_URL}/api/v1/mpesa/...`
  // Safaricom rejects http:// for production shortcodes — HTTPS enforced below
  // when MPESA_ENV=production.
  MPESA_CALLBACK_BASE_URL: z
    .string()
    .url('MPESA_CALLBACK_BASE_URL must be a valid URL')
    .refine((u) => !u.endsWith('/'), 'MPESA_CALLBACK_BASE_URL must not end with a slash'),
  MPESA_B2C_INITIATOR_NAME: z.string().optional(),
  // Plaintext initiator password — RSA-encrypted at boot against Safaricom's
  // public cert by lib/utils/mpesa-credential.ts. Operators who prefer to
  // pre-encrypt and paste a static SecurityCredential blob can still do so
  // via MPESA_B2C_SECURITY_CREDENTIAL.
  MPESA_B2C_INITIATOR_PASSWORD: z.string().optional(),
  // Sub-account shortcodes (Safaricom Daraja "Organization Accounts").
  // Used for reconciliation tracing — the API call still uses MPESA_SHORTCODE
  // as PartyA, but every B2C row records which sub-account funded it.
  MPESA_WORKING_SHORTCODE:           z.string().optional(),
  MPESA_UTILITY_SHORTCODE:           z.string().optional(),
  MPESA_LOAN_DISBURSEMENT_SHORTCODE: z.string().optional(),
  MPESA_CHARGES_SHORTCODE:           z.string().optional(),
  MPESA_SETTLEMENT_SHORTCODE:        z.string().optional(),
  MPESA_AIRTIME_SHORTCODE:           z.string().optional(),
  // Airtime purchase is operator-specific on Daraja — the exact CommandID and
  // request path are provisioned per shortcode. The wrapper stays inert (throws
  // NotImplementedError) until MPESA_AIRTIME_COMMAND_ID is set. ENDPOINT
  // defaults to the documented path but is overridable.
  MPESA_AIRTIME_COMMAND_ID:          z.string().optional(),
  MPESA_AIRTIME_ENDPOINT:            z.string().optional(),
  // Pre-encrypted SecurityCredential (optional). When set, takes precedence
  // over the runtime RSA encryption of MPESA_B2C_INITIATOR_PASSWORD.
  MPESA_B2C_SECURITY_CREDENTIAL: z.string().optional(),

  // ── SMS (TextSMS Kenya — primary provider) ────────────────────────────────
  // All three required for production. Service falls back to dry_run when unset.
  TEXTSMS_API_KEY:    z.string().min(1, 'TEXTSMS_API_KEY is required'),
  TEXTSMS_SENDER_ID: z.string().default('KitabuYetu'),
  TEXTSMS_PARTNER_ID: z.string().min(1, 'TEXTSMS_PARTNER_ID is required'),

  // ── WhatsApp (Meta Cloud API) ─────────────────────────────────────────────
  // All five optional so the service falls back to dry_run mode when unset.
  WHATSAPP_PHONE_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_BUSINESS_ID: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().default('v18.0'),
  // Webhook (E10.2): VERIFY_TOKEN echoed back during the Meta subscribe handshake;
  // APP_SECRET signs the POST payload as X-Hub-Signature-256: sha256=<hex(hmac)>.
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),

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
  // Format from Resend dashboard: whsec_<base64>. Used by svix HMAC verify.
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  // ECDSA P-256 public key from SendGrid Event Webhook settings.
  // Either the raw base64 the dashboard shows, or the full PEM block —
  // the verify helper accepts both.
  SENDGRID_WEBHOOK_VERIFICATION_KEY: z.string().optional(),

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
}).superRefine((data, ctx) => {
  // Production Daraja shortcodes ONLY accept HTTPS callback URLs.
  // Sandbox tolerates http:// (and ngrok plaintext tunnels), so we only
  // gate this in production.
  if (data.MPESA_ENV === 'production' && !data.MPESA_CALLBACK_BASE_URL.startsWith('https://')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MPESA_CALLBACK_BASE_URL'],
      message: 'Must use https:// when MPESA_ENV=production (Safaricom rejects plaintext callbacks)',
    });
  }
  // Production B2C needs either a pre-encrypted SecurityCredential blob
  // OR the plaintext initiator password (we RSA-encrypt at boot).
  if (
    data.MPESA_ENV === 'production' &&
    data.MPESA_B2C_INITIATOR_NAME &&
    !data.MPESA_B2C_SECURITY_CREDENTIAL &&
    !data.MPESA_B2C_INITIATOR_PASSWORD
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MPESA_B2C_SECURITY_CREDENTIAL'],
      message: 'Set MPESA_B2C_INITIATOR_PASSWORD (auto-encrypted) or MPESA_B2C_SECURITY_CREDENTIAL (pre-encrypted) for production B2C',
    });
  }
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
