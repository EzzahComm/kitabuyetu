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
function buildPool(connectionString: string): Pool {
  const isSupabase =
    connectionString.includes('supabase.com') ||
    connectionString.includes('supabase.co');

  const newPool = new Pool({
    connectionString,
    max:                     env.DB_POOL_MAX,
    idleTimeoutMillis:       10_000,
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
// traffic. Connects as the least-privileged `app_tenant` role (no BYPASSRLS)
// once TENANT_DATABASE_URL is provisioned; falls back to the same pool/role
// as withAdminDb() until then, so this is a no-op until that role exists.
if (!globalWithPool._kyTenantPool) {
  globalWithPool._kyTenantPool = env.TENANT_DATABASE_URL
    ? buildPool(env.TENANT_DATABASE_URL)
    : globalWithPool._kyPool;
}

export const pool = globalWithPool._kyPool;
export const tenantPool = globalWithPool._kyTenantPool;

// ------------------------------------------------------------------
// Tenant context — must be set inside an explicit transaction so that
// SET LOCAL persists across all queries in the same transaction block.
// ------------------------------------------------------------------
export interface TenantContext {
  userId:  string;
  groupId: string;
  role:    string;
  organizationId?:  string;
}

async function setTenantLocals(client: PoolClient, ctx: TenantContext): Promise<void> {
  // set_config(name, value, is_local=TRUE) is transaction-scoped, equivalent to SET LOCAL.
  // Using the function form lets us pass values as parameterised arguments instead of
  // string-interpolating them into SQL, eliminating any injection risk.
  await client.query('SELECT set_config($1, $2, TRUE)', ['app.current_user_id',  ctx.userId]);
  await client.query('SELECT set_config($1, $2, TRUE)', ['app.current_group_id', ctx.groupId]);
  await client.query('SELECT set_config($1, $2, TRUE)', ['app.current_role',     ctx.role]);
  if (ctx.organizationId) {
    await client.query('SELECT set_config($1, $2, TRUE)', ['app.current_organization_id', ctx.organizationId]);
  }
}

/**
 * Run a read-only operation inside an implicit transaction so SET LOCAL works.
 * Automatically releases the client on completion or error.
 */
export async function withDb<T>(
  ctx: TenantContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
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
export async function withTransaction<T>(
  ctx: TenantContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withDb(ctx, fn);
}

/**
 * Run a privileged operation without a tenant context (super_admin / migration runner).
 * RLS is bypassed when using a role that has BYPASSRLS or when the app DB role has
 * been granted BYPASSRLS in production. Used only by admin endpoints.
 */
export async function withAdminDb<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
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
