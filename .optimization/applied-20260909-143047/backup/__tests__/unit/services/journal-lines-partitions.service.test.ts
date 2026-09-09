/**
 * journal_lines partition maintenance (ACCOUNTING_ARCHITECTURE_AUDIT.md
 * §17/§19 Phase 2, migrations 094/095) — verifies the monthly partition
 * range computed from journal_entries' earliest entry_date through 3 months
 * ahead of "now", and that each partition gets its own constraint-trigger
 * DDL (the one thing that doesn't auto-clone from the partitioned parent).
 */
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ensureJournalLinesPartitions } from '@/lib/services/journal-lines-partitions.service';

jest.mock('@/lib/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const mockQuery = pool.query as jest.Mock;

/**
 * `relkind` defaults to 'p' (partitioned) because that is the state every
 * pre-existing test here assumes. Production is currently 'r' — migrations
 * 094/095 were never applied — which is what the last test in this file
 * covers.
 */
function mockRows(
  minEntryDate: string | null,
  defaultPartitionCount: string,
  relkind: 'p' | 'r' = 'p',
) {
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes('pg_class')) return Promise.resolve({ rows: [{ relkind }] });
    if (sql.includes('MIN(entry_date)')) return Promise.resolve({ rows: [{ min: minEntryDate }] });
    if (sql.includes('journal_lines_default')) return Promise.resolve({ rows: [{ count: defaultPartitionCount }] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  (logger.warn as jest.Mock).mockReset();
  jest.useFakeTimers().setSystemTime(new Date('2026-07-15T00:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ensureJournalLinesPartitions', () => {
  it('creates monthly partitions from the earliest entry_date through 3 months ahead, each with its constraint trigger', async () => {
    mockRows('2026-05-12', '0');

    const result = await ensureJournalLinesPartitions();

    expect(result.created).toEqual([
      'journal_lines_y2026m05', 'journal_lines_y2026m06', 'journal_lines_y2026m07',
      'journal_lines_y2026m08', 'journal_lines_y2026m09', 'journal_lines_y2026m10',
    ]);
    expect(result.defaultPartitionRowCount).toBe(0);

    const createCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('CREATE TABLE IF NOT EXISTS'));
    expect(createCalls).toHaveLength(6);
    expect(createCalls[0][0]).toContain('journal_lines_y2026m05');
    expect(createCalls[0][0]).toContain('PARTITION OF journal_lines');
    expect(createCalls[0][1]).toEqual(['2026-05-01', '2026-06-01']);

    const triggerCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('CREATE CONSTRAINT TRIGGER'));
    expect(triggerCalls).toHaveLength(6);
    expect(triggerCalls[0][0]).toContain('journal_lines_y2026m05');
    expect(triggerCalls[0][0]).toContain('assert_posted_entry_balance');
  });

  it('falls back to the current month when journal_entries has no rows yet', async () => {
    mockRows(null, '0');

    const result = await ensureJournalLinesPartitions();

    expect(result.created).toEqual([
      'journal_lines_y2026m07', 'journal_lines_y2026m08', 'journal_lines_y2026m09', 'journal_lines_y2026m10',
    ]);
  });

  it('warns when the default partition is non-empty (partition maintenance fell behind)', async () => {
    mockRows(null, '3');

    const result = await ensureJournalLinesPartitions();

    expect(result.defaultPartitionRowCount).toBe(3);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('fell behind'),
      expect.objectContaining({ rows: 3 }),
    );
  });

  /**
   * PRODUCTION_SCHEMA_DRIFT_AUDIT.md (M1/M2): production's journal_lines is
   * an ordinary table (relkind 'r'), so `CREATE TABLE ... PARTITION OF` and
   * the journal_lines_default row count both raise. This job is scheduled on
   * the 1st of the month at 09:00 UTC and had never run; without this guard
   * its first execution would simply fail.
   */
  it('no-ops with a warning when journal_lines is not partitioned (094/095 unapplied)', async () => {
    mockRows('2026-05-12', '0', 'r');

    const result = await ensureJournalLinesPartitions();

    expect(result).toEqual({ created: [], defaultPartitionRowCount: 0, skipped: true });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not a partitioned table'),
    );

    // Critically: none of the DDL that would have thrown was attempted.
    const ddl = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('PARTITION OF') ||
      String(sql).includes('CREATE CONSTRAINT TRIGGER') ||
      String(sql).includes('journal_lines_default'),
    );
    expect(ddl).toHaveLength(0);
  });
});
