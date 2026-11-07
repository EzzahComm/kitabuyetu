import { withTransaction } from '@/lib/db';
import { resolveUnrouted } from '@/lib/services/mpesa-unrouted.service';
import { ValidationError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
}));

const ctx = { groupId: 'grp-1', userId: 'treasurer-1', role: 'treasurer' as const };

describe('unrouted M-Pesa receipts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not allow an unrouted receipt to be manually allocated as a contribution', async () => {
    await expect(
      resolveUnrouted(ctx, 'unrouted-1', 'allocate', { memberId: 'member-1' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
