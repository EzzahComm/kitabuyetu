import { Pool, PoolClient } from 'pg';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

// Module-level singleton pools. Safe in Next.js API routes (Node.js runtime).
// HMR in dev can create multiple instances — guard with globalThis.
const globalWithPool = globalThis as typeof globalThis & {
  _kyPool?: Pool;
  _kyTenantPool?: Pool;
};

// SUPABASE connection guidance:
//   • Use the Supavisor SESSION-mode pooler (aws-0-<region>.pooler.supabase.com:5432).
//     Direct connections (db.<ref>.supabase.co:5432) are IPv6-only and unreachable
//     from AWS Lambda's IPv4-only outbound networking.
//   • Do NOT use transaction-mode pooler (port 6543) — it doesn't preserve
//     SET LOCAL across queries, which our RLS context relies on.
//   • TLS verification relaxed for Supabase pooler hosts: the pooler cert chain
//     isn't fully present in Node's default CA bundle on Lambda. The connection
//     remains TLS-encrypted; we just stop pinning the chain.
/**
 * True only when the DSN's HOST is supabase.com/supabase.co or a subdomain of
 * one. Deliberately not a substring test: this decides whether to relax TLS
 * certificate verification, so `postgres://…@supabase.com.attacker.net/db` and
 * `…@evilsupabase.com/db` must NOT match — both of which a plain
 * `.includes('supabase.com')` accepted (CodeQL js/incomplete-url-substring-
 * sanitization, high). Real hosts (aws-0-<region>.pooler.supabase.com,
 * db.<ref>.supabase.co) still match.
 *
 * Returns false for an absent or unparseable DSN, which is the normal state
 * during `next build` — see buildPool below.
 */
function isSupabaseHost(dsn: string | undefined): boolean {
  if (!dsn) return false;
  try {
    const host = new URL(dsn).hostname.toLowerCase();
    return (
      host === 'supabase.com' ||
      host.endsWith('.supabase.com') ||
      host === 'supabase.co' ||
      host.endsWith('.supabase.co')
    );
  } catch {
    return false;
  }
}

function buildPool(connectionString: string | undefined): Pool {
  // `connectionString` can legitimately be undefined HERE and only here: during
  // `next build`, lib/env.ts deliberately skips Zod validation
  // (NEXT_PHASE=phase-production-build) and returns raw process.env, so
  // env.DATABASE_URL is undefined whenever the build environment lacks it.
  // Next.js evaluates every route's module graph while collecting page data,
  // and this module is imported by almost all of them — so an unguarded
  // `.includes()` here threw "Cannot read properties of undefined" and failed
  // the ENTIRE build at whichever route imported lib/db first, regardless of
  // whether that route touches the database.
  //
  // Same trap as the module-scope throw in daraja.service.ts (fixed in b6ee340):
  // anything that can fail at import time fails the whole build, not just the
  // feature it guards. Nothing is weakened by tolerating it: at real runtime
  // validateEnv() has already proven DATABASE_URL is a valid URL, and pg does
  // not dial until .connect(), so a placeholder is never used to open a socket.
  const isSupabase = isSupabaseHost(connectionString);

  const newPool = new Pool({
    connectionString,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    ssl: isSupabase
      ? { rejectUnauthorized: false }
      : env.NODE_ENV === 'production'
        ? { rejectUnauthorized: true }
        : false,
  });

  newPool.on('error', (err) => {
    logger.error('[pg pool] Idle client error', err);
  });

  return newPool;
}

if (!globalWithPool._kyPool) {
  globalWithPool._kyPool = buildPool(env.DATABASE_URL);
}

// Tenant-context pool — used by withDb()/withTransaction() for real tenant
// traffic. Connects as the least-privileged `app_tenant` role (no BYPASSRLS).
// CRITICAL: TENANT_DATABASE_URL is REQUIRED in production. Falling back to the
// admin pool silently disables RLS, creating a security vulnerability.
// See: Phase 1 RLS Hardening (2026-09-16).
if (!globalWithPool._kyTenantPool) {
  // Next.js's build-time page-data-collection step imports every route
  // module, evaluating this module scope regardless of whether the build
  // machine holds production secrets (it deliberately doesn't). Throwing
  // here on that basis would kill the whole build at whichever route
  // imports lib/db first — the same class of bug __tests__/unit/db/
  // pool-build-time.test.ts guards against for DATABASE_URL. Real
  // enforcement happens at cold-start in the deployed runtime, same as
  // lib/env.ts's validateEnv().
  //
  // Also treats a Jest run as non-production: CI's Quality Gate job sets
  // NODE_ENV=production workflow-wide (so `npm run build` behaves like a
  // real production build), which the earlier `npm run test:ci` step
  // inherits too — any unit test that imports lib/db transitively (e.g.
  // through lib/auth/middleware.ts) hit this throw despite never having
  // TENANT_DATABASE_URL configured, since no unit test needs a real
  // Postgres connection. JEST_WORKER_ID is set by Jest itself for every
  // worker process and is never present in the deployed runtime, so this
  // narrows nothing about real production enforcement.
  const isBuildTime =
    process.env.SKIP_ENV_VALIDATION === '1' ||
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.JEST_WORKER_ID !== undefined;

  if (!env.TENANT_DATABASE_URL) {
    if (env.NODE_ENV === 'production' && !isBuildTime) {
      throw new Error(
        'TENANT_DATABASE_URL is REQUIRED in production. ' +
          'Missing this env var causes RLS to be silently bypassed, ' +
          'creating a critical security vulnerability. ' +
          'Set TENANT_DATABASE_URL to the PostgreSQL connection string for the app_tenant role.',
      );
    }
    // In development (or at build time), allow fallback to admin pool, but log a warning
    logger.warn(
      '[db] TENANT_DATABASE_URL not set — using admin pool for tenant traffic. ' +
        'RLS enforcement is disabled. Set TENANT_DATABASE_URL to enable RLS in development.',
    );
  }
  globalWithPool._kyTenantPool = env.TENANT_DATABASE_URL ? buildPool(env.TENANT_DATABASE_URL) : globalWithPool._kyPool;
}

export const pool = globalWithPool._kyPool;
export const tenantPool = globalWithPool._kyTenantPool;

// ------------------------------------------------------------------
// Tenant context — must be set inside an explicit transaction so that
// SET LOCAL persists across all queries in the same transaction block.
// ------------------------------------------------------------------
export interface TenantContext {
  userId: string;
  /**
   * Required, and deliberately kept required: every group-scoped service
   * relies on it being a real id. The ONE caller without a group is the
   * organization axis (withOrganizationAccess), whose coordinator holds a
   * backoffice token carrying an organization but no group — it passes the
   * empty string, which `app_current_group_id()` is already written to read
   * as "no group" (`NULLIF(current_setting(...), '')::uuid`). Organization
   * scoping is `organizationId` + the app.current_organization_id GUC, and
   * nothing under that tree reads `groupId`.
   */
  groupId: string;
  role: string;
  organizationId?: string;
}

async function setTenantLocals(client: PoolClient, ctx: TenantContext): Promise<void> {
  // set_config(name, value, is_local=TRUE) is transaction-scoped, equivalent to SET LOCAL.
  // Using the function form lets us pass values as parameterised arguments instead of
  // string-interpolating them into SQL, eliminating any injection risk.
  //
  // One round trip, not up to four: each set_config call still fires as part
  // of computing this single output row, so all four side effects still
  // happen — this only removes three extra network trips per tenant
  // transaction (measured live: 6,409 set_config calls / 2,126 BEGINs =
  // ~3 per transaction, docs/audits/optimization-2026-09).
  // organizationId is now always passed ('' when absent) rather than
  // conditionally skipped — app_current_organization_id() already treats ''
  // the same as never-set (NULLIF(current_setting(...), '')::uuid), so this
  // is not a behavior change, just one fewer branch.
  await client.query(
    `SELECT set_config('app.current_user_id', $1, TRUE),
            set_config('app.current_group_id', $2, TRUE),
            set_config('app.current_role', $3, TRUE),
            set_config('app.current_organization_id', $4, TRUE)`,
    [ctx.userId, ctx.groupId, ctx.role, ctx.organizationId ?? ''],
  );
}

/**
 * Run a read-only operation inside an implicit transaction so SET LOCAL works.
 * Automatically releases the client on completion or error.
 */
export async function withDb<T>(ctx: TenantContext, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await tenantPool.connect();
  try {
    await client.query('BEGIN');
    await setTenantLocals(client, ctx);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run a write operation inside an explicit transaction.
 * On any error the transaction is rolled back before re-throwing.
 */
export async function withTransaction<T>(ctx: TenantContext, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withDb(ctx, fn);
}

/**
 * Run a privileged operation without a tenant context (super_admin / migration runner).
 * RLS is bypassed when using a role that has BYPASSRLS or when the app DB role has
 * been granted BYPASSRLS in production. Used only by admin endpoints.
 */
export async function withAdminDb<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------------
// Convenience query helper — wraps a single parameterised query
// ------------------------------------------------------------------
export async function query<T extends Record<string, unknown>>(
  ctx: TenantContext,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const rows = await withDb<T[]>(ctx, async (client) => {
    const result = await client.query<T>(sql, params);
    return result.rows;
  });
  return rows;
}
