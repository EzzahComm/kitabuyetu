import { Pool, PoolClient } from 'pg';
import { env } from '@/lib/env';

// Module-level singleton pool. Safe in Next.js API routes (Node.js runtime).
// HMR in dev can create multiple instances — guard with globalThis.
const globalWithPool = globalThis as typeof globalThis & { _kyPool?: Pool };

if (!globalWithPool._kyPool) {
  // SUPABASE: Use the DIRECT connection string (port 5432), not pgBouncer (port 6543).
  // pgBouncer transaction mode does not support SET LOCAL required by RLS policies.
  const isRemote =
    env.DATABASE_URL.includes('supabase.com') ||
    env.DATABASE_URL.includes('supabase.co');

  globalWithPool._kyPool = new Pool({
    connectionString:        env.DATABASE_URL,
    max:                     env.DB_POOL_MAX,
    idleTimeoutMillis:       10_000,
    connectionTimeoutMillis: 8_000,
    ssl: isRemote
      ? { rejectUnauthorized: true }
      : env.NODE_ENV === 'production'
        ? { rejectUnauthorized: true }
        : false,
  });

  globalWithPool._kyPool.on('error', (err) => {
    if (env.NODE_ENV !== 'production') {
      console.error('[pg pool] Idle client error:', err.message);
    }
  });
}

export const pool = globalWithPool._kyPool;

// ------------------------------------------------------------------
// Tenant context — must be set inside an explicit transaction so that
// SET LOCAL persists across all queries in the same transaction block.
// ------------------------------------------------------------------
export interface TenantContext {
  userId:  string;
  groupId: string;
  role:    string;
  ngoId?:  string;
}

async function setTenantLocals(client: PoolClient, ctx: TenantContext): Promise<void> {
  // set_config(name, value, is_local=TRUE) is transaction-scoped, equivalent to SET LOCAL.
  // Using the function form lets us pass values as parameterised arguments instead of
  // string-interpolating them into SQL, eliminating any injection risk.
  await client.query('SELECT set_config($1, $2, TRUE)', ['app.current_user_id',  ctx.userId]);
  await client.query('SELECT set_config($1, $2, TRUE)', ['app.current_group_id', ctx.groupId]);
  await client.query('SELECT set_config($1, $2, TRUE)', ['app.current_role',     ctx.role]);
  if (ctx.ngoId) {
    await client.query('SELECT set_config($1, $2, TRUE)', ['app.current_ngo_id', ctx.ngoId]);
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
  const client = await pool.connect();
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
