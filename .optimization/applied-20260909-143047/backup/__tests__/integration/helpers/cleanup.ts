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
 * automatically if that table list changes) plus two extra sweeps:
 *
 *  - `organizations`, which that script deliberately preserves in production
 *    (donor-organization records shouldn't vanish on a tenant reset there).
 *
 *  - `job_queue`, which that script also leaves alone — and which, unlike
 *    almost every other table here, has NO foreign key into `groups`, so the
 *    script's TRUNCATE ... CASCADE never reaches it either. Rows inserted by
 *    one suite therefore survived into every later one. That is not
 *    hypothetical: job-stuck-sweep.test.ts asserts on resetStuckJobs()'s
 *    whole-table released/failed counts, so a leaked 'processing' row from an
 *    earlier suite silently joins its tally as soon as that row ages past the
 *    sweep threshold — a failure that only appears once the run is slow
 *    enough, in a suite that did nothing wrong.
 *
 * Safe here: this suite only ever targets a disposable local/CI Postgres
 * instance, never production.
 */
export async function resetDatabase(): Promise<void> {
  await execScript(CLEAR_TENANT_DATA_SQL);
  // One statement, not one per table: resetDatabase runs at the head of nearly
  // every test in this suite, and a second round trip is pure overhead against
  // Jest's 5s default budget.
  await execScript('TRUNCATE TABLE public.organizations, public.job_queue CASCADE;');
}
