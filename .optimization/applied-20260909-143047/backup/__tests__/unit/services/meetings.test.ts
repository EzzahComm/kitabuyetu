/**
 * Meeting resolution follow-through.
 *
 * `meeting_resolutions.implemented` / `implemented_at` have existed since
 * migration 023 with no write path anywhere in the app — `useAddResolution`
 * had zero callers, and nothing ever issued an UPDATE against this table, so
 * a resolution stayed "outstanding" forever and the meetings stats card
 * always read "0 implemented". This is the regression cover for the write
 * path (`meetingsService.updateResolution`) that closes that gap.
 */
import { withTransaction } from '@/lib/db';
import { meetingsService, UpdateResolutionSchema } from '@/lib/services/meetings.service';
import { NotFoundError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
  withAdminDb: jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: 'g1', userId: 'u1', role: 'secretary' };

const existingRow = {
  id: 'r1', meeting_id: 'm1', group_id: 'g1', implemented: false, implemented_at: null,
};

describe('meetingsService.updateResolution', () => {
  it('scopes the existence check by resolution, meeting, AND group', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [existingRow] });
    mockQuery.mockResolvedValueOnce({ rows: [{ ...existingRow, implemented: true }] });

    await meetingsService.updateResolution(ctx, 'm1', 'r1', { implemented: true });

    const [selectSql, selectArgs] = mockQuery.mock.calls[0];
    expect((selectSql as string).replace(/\s+/g, ' ')).toMatch(
      /WHERE id=\$1 AND meeting_id=\$2 AND group_id=\$3/,
    );
    expect(selectArgs).toEqual(['r1', 'm1', 'g1']);
  });

  it('throws NotFoundError when the resolution does not belong to this meeting/tenant', async () => {
    // A resolution id that is real but from another meeting or another
    // group's tenant must not be reachable through this route.
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      meetingsService.updateResolution(ctx, 'm1', 'not-mine', { implemented: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sets implemented_at=now() when marking implemented', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [existingRow] });
    mockQuery.mockResolvedValueOnce({ rows: [{ ...existingRow, implemented: true }] });

    await meetingsService.updateResolution(ctx, 'm1', 'r1', { implemented: true });

    const updateSql = (mockQuery.mock.calls[1][0] as string).replace(/\s+/g, ' ');
    expect(updateSql).toMatch(/implemented=\$1/);
    expect(updateSql).toMatch(/implemented_at=now\(\)/);
  });

  it('clears implemented_at when marking back to outstanding', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...existingRow, implemented: true, implemented_at: '2026-08-01' }] });
    mockQuery.mockResolvedValueOnce({ rows: [existingRow] });

    await meetingsService.updateResolution(ctx, 'm1', 'r1', { implemented: false });

    const updateSql = (mockQuery.mock.calls[1][0] as string).replace(/\s+/g, ' ');
    expect(updateSql).toMatch(/implemented_at=NULL/);
  });

  it('derives implemented_at server-side — the client cannot supply it directly', () => {
    // The schema has no `implementedAt` field at all; zod's default (strip)
    // mode drops it silently if a caller sends it, rather than erroring.
    const parsed = UpdateResolutionSchema.safeParse({ implemented: true, implementedAt: '2026-08-01' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect('implementedAt' in parsed.data).toBe(false);
  });

  it('is a no-op that skips the UPDATE query when no fields are given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [existingRow] });

    const result = await meetingsService.updateResolution(ctx, 'm1', 'r1', {});

    expect(mockQuery).toHaveBeenCalledTimes(1); // only the existence SELECT
    expect(result).toEqual(existingRow);
  });

  it('scopes the UPDATE itself by id AND group, not id alone', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [existingRow] });
    mockQuery.mockResolvedValueOnce({ rows: [existingRow] });

    await meetingsService.updateResolution(ctx, 'm1', 'r1', { notes: 'Paid via M-Pesa' });

    const [updateSql, updateArgs] = mockQuery.mock.calls[1];
    expect((updateSql as string).replace(/\s+/g, ' ')).toMatch(/WHERE id=\$2 AND group_id=\$3/);
    expect(updateArgs).toEqual(['Paid via M-Pesa', 'r1', 'g1']);
  });
});

describe('UpdateResolutionSchema', () => {
  it.each(['carried', 'defeated', 'tabled', 'deferred'])(
    'accepts %s, a real resolution status',
    (status) => {
      expect(UpdateResolutionSchema.safeParse({ status }).success).toBe(true);
    },
  );

  it('rejects a status outside the four real outcomes', () => {
    expect(UpdateResolutionSchema.safeParse({ status: 'approved' }).success).toBe(false);
  });

  it('requires implementationDeadline as YYYY-MM-DD, or accepts null to clear it', () => {
    expect(UpdateResolutionSchema.safeParse({ implementationDeadline: '2026-09-01' }).success).toBe(true);
    expect(UpdateResolutionSchema.safeParse({ implementationDeadline: null }).success).toBe(true);
    expect(UpdateResolutionSchema.safeParse({ implementationDeadline: '09/01/2026' }).success).toBe(false);
  });
});
