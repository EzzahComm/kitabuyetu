/**
 * journal_lines partition maintenance (ACCOUNTING_ARCHITECTURE_AUDIT.md
 * §17/§19 Phase 2, migrations 094/095). Ensures monthly partitions exist
 * 3 months ahead of today, idempotently — a missed scheduled run just means
 * the next run creates more months at once, not a gap.
 *
 * Also (re-)creates the deferred balance-check constraint trigger on every
 * partition: unlike ordinary row-level triggers, which Postgres
 * automatically clones from a partitioned parent to every partition,
 * constraint triggers do not get that treatment and must be created on each
 * partition individually.
 *
 * IMPORTANT — migrations 094/095 are NOT applied to production. Verified
 * 2026-07-30 against the live database: `journal_lines` has
 * pg_class.relkind = 'r' (ordinary table), and neither
 * journal_lines_partitioned, journal_lines_default, nor journal_lines_legacy
 * exists. `ensureJournalLinesPartitions` therefore no-ops (see the relkind
 * guard below) rather than throwing on `CREATE TABLE ... PARTITION OF` and
 * on the missing journal_lines_default.
 *
 * A previous version of this comment claimed the constraint-trigger
 * behaviour had been "confirmed against a scratch Postgres 17 container...
 * not just documentation". That is not accurate and has been corrected:
 * Docker was unreachable in the session that wrote migrations 094/095, so
 * the partitioning SQL has never been executed against any real Postgres
 * instance. The claim is sourced from PostgreSQL's documentation only. Do
 * not treat 094/095 as verified — see
 * docs/audits/PRODUCTION_SCHEMA_DRIFT_AUDIT.md (M2).
 */
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';

const MONTHS_AHEAD = 3;

function monthPartitionName(monthStart: Date): string {
  const y = monthStart.getUTCFullYear();
  const m = String(monthStart.getUTCMonth() + 1).padStart(2, '0');
  return `journal_lines_y${y}m${m}`;
}

async function ensurePartition(monthStart: Date, monthEnd: Date): Promise<string> {
  const name = monthPartitionName(monthStart);
  // Table/trigger names can't be bound as query parameters, so this goes
  // into the SQL string directly — name is fully computed from Date fields
  // above, never external input, but this guard is cheap insurance against
  // that changing under a future refactor.
  if (!/^journal_lines_y\d{4}m\d{2}$/.test(name)) {
    throw new Error(`Refusing to create partition with unexpected name: ${name}`);
  }
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF journal_lines FOR VALUES FROM ($1) TO ($2)`,
    [monthStart.toISOString().slice(0, 10), monthEnd.toISOString().slice(0, 10)],
  );
  // CREATE CONSTRAINT TRIGGER has no IF NOT EXISTS form, so drop-then-create
  // (this repo's established idiom, e.g. migration 081) keeps this idempotent.
  await pool.query(`DROP TRIGGER IF EXISTS trg_assert_posted_balance_deferred ON public.${name}`);
  await pool.query(
    `CREATE CONSTRAINT TRIGGER trg_assert_posted_balance_deferred
       AFTER INSERT ON public.${name}
       DEFERRABLE INITIALLY DEFERRED
       FOR EACH ROW EXECUTE FUNCTION public.assert_posted_entry_balance()`,
  );
  return name;
}

/**
 * True only when journal_lines is an actual partitioned table (relkind 'p').
 * Everything below — CREATE TABLE ... PARTITION OF, and the
 * journal_lines_default row count — is invalid against an ordinary table and
 * raises rather than returning an empty result, so this has to be checked
 * before any of it runs.
 */
async function isJournalLinesPartitioned(): Promise<boolean> {
  const { rows } = await pool.query<{ relkind: string }>(
    `SELECT c.relkind FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'journal_lines'`,
  );
  return rows[0]?.relkind === 'p';
}

export async function ensureJournalLinesPartitions(): Promise<{
  created: string[]; defaultPartitionRowCount: number; skipped?: true;
}> {
  // Migrations 094/095 are unapplied in production (see the file header).
  // Without this guard the job's first-ever run — 1st of the month, 09:00
  // UTC — fails outright. A no-op with a warning is the honest behaviour:
  // there are no partitions to maintain on a non-partitioned table, and
  // that is a deployment-state fact to surface, not an error to retry.
  if (!(await isJournalLinesPartitioned())) {
    logger.warn(
      '[journal-lines-partitions] journal_lines is not a partitioned table — ' +
      'migrations 094/095 are not applied. Skipping partition maintenance.',
    );
    return { created: [], defaultPartitionRowCount: 0, skipped: true };
  }

  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + MONTHS_AHEAD + 1, 1));

  const { rows } = await pool.query<{ min: string | null }>(
    `SELECT MIN(entry_date)::text AS min FROM journal_entries`,
  );
  const earliest = rows[0]?.min ? new Date(rows[0].min) : now;
  let cursor = new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1));

  const created: string[] = [];
  while (cursor < end) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    created.push(await ensurePartition(cursor, monthEnd));
    cursor = monthEnd;
  }

  // A non-empty default partition means partition creation fell behind at
  // some point — a real signal to investigate, not something to leave silent.
  const { rows: defaultRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM journal_lines_default`,
  );
  const defaultPartitionRowCount = parseInt(defaultRows[0]?.count ?? '0', 10);
  if (defaultPartitionRowCount > 0) {
    logger.warn('[journal-lines-partitions] journal_lines_default is non-empty — partition maintenance fell behind', {
      rows: defaultPartitionRowCount,
    });
  }

  return { created, defaultPartitionRowCount };
}
