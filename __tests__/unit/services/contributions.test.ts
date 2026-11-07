/**
 * Contribution service tests — payment completion is provider-callback-only.
 * User-facing entry points may create pending obligations, never settled money.
 */
import { withTransaction } from '@/lib/db';
import { contributionsService } from '@/lib/services/contributions.service';
import { CreateContributionSchema, UpdateContributionSchema } from '@/lib/validators/contribution.schema';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
}));

const mockQuery = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'usr-1', role: 'treasurer' };
const baseContributionInput = {
  memberId: 'mem-1',
  amount: 1000,
  contributionDate: '2025-06-01',
} as const;
const membershipRow = { rows: [{ id: 'gm-1', member_code: 'KY000000100001' }] };

describe('callback-only contribution policy', () => {
  it('rejects a client-supplied M-Pesa receipt on create', () => {
    expect(
      CreateContributionSchema.safeParse({ ...baseContributionInput, mpesaReceiptNumber: 'QAB123XYZ' }).success,
    ).toBe(false);
  });

  it('rejects client attempts to mark a contribution completed', () => {
    expect(UpdateContributionSchema.safeParse({ status: 'completed' }).success).toBe(false);
  });

  it('rejects direct service attempts to complete a contribution', async () => {
    await expect(
      contributionsService.update(ctx, 'c-1', { status: 'completed' } as never),
    ).rejects.toThrow(/only a verified M-Pesa provider callback/i);
    expect(withTransaction).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('creates a pending obligation and never posts a journal', async () => {
    const pendingContribution = {
      id: 'c-1',
      group_id: 'grp-1',
      member_id: 'mem-1',
      amount: '1000.00',
      status: 'pending',
      payment_method: null,
      mpesa_receipt_number: null,
    };
    mockQuery.mockResolvedValueOnce(membershipRow);
    mockQuery.mockResolvedValueOnce({ rows: [pendingContribution] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit log

    const result = await contributionsService.create(ctx, baseContributionInput);

    expect(result.status).toBe('pending');
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery.mock.calls[1][0]).toContain("'pending'");
    expect(mockQuery.mock.calls[1][0]).toContain('NULL,NULL');
  });
});

describe('contributionsService.create', () => {
  it('rejects a member without active membership before writing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(contributionsService.create(ctx, baseContributionInput)).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('contributionsService.delete', () => {
  it('soft-deletes by setting status to cancelled (not a hard delete)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c-1', status: 'pending' }] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await contributionsService.delete(ctx, 'c-1');
    const [sql] = mockQuery.mock.calls[1] as [string, ...unknown[]];
    expect(sql.trim().toUpperCase()).toMatch(/^UPDATE/);
    expect(sql).toContain("'cancelled'");
    expect(sql.toUpperCase()).not.toContain('DELETE');
  });

  it('throws NotFoundError when contribution is not pending or does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(contributionsService.delete(ctx, 'non-existent')).rejects.toBeInstanceOf(NotFoundError);
  });
});
