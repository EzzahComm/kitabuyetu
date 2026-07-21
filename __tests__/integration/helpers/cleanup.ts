import { readFileSync } from 'fs';
import path from 'path';
import { execScript } from './db';

const CLEAR_TENANT_DATA_SQL = readFileSync(
  path.join(process.cwd(), 'scripts', 'clear-tenant-data.sql'),
  'utf-8',
);

/**
 * Wipes all tenant + organization test data between integration test files.
 * Reuses the app's own scripts/clear-tenant-data.sql (stays in sync
 * automatically if that table list changes) plus one extra sweep for
 * `organizations`, which that script deliberately preserves in production
 * (donor-organization records shouldn't vanish on a tenant reset there).
 * Safe here: this suite only ever targets a disposable local/CI Postgres
 * instance, never production.
 */
export async function resetDatabase(): Promise<void> {
  await execScript(CLEAR_TENANT_DATA_SQL);
  await execScript('TRUNCATE TABLE public.organizations CASCADE;');
}
