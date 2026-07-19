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

function mockRows(minEntryDate: string | null, defaultPartitionCount: string) {
  mockQuery.mockImplementation((sql: string) => {
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
});
