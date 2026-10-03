import { pool, withAdminDb } from '@/lib/db';

/** Fixture-only raw query — bypasses tenant context on purpose (test setup). */
export async function rawQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  return withAdminDb(async (client) => {
    const { rows } = await client.query<T>(sql, params);
    return rows;
  });
}

/**
 * Executes a raw (possibly multi-statement) SQL script with no outer
 * transaction wrapper — for scripts/clear-tenant-data.sql, which manages its
 * own BEGIN/COMMIT. Wrapping it in withAdminDb's own transaction would nest
 * transactions unnecessarily.
 */
export async function execScript(sql: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(sql);
  } catch (err) {
    // If the script's own BEGIN/COMMIT was interrupted mid-transaction, the
    // connection comes back to the pool still aborted — every later query
    // on it (even from an unrelated test file) fails with "current
    // transaction is aborted" instead of the real error. ROLLBACK is a
    // no-op if there's no open transaction, so this is always safe.
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
