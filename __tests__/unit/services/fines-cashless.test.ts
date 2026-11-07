import { withTransaction } from '@/lib/db';
import { finesService } from '@/lib/services/fines.service';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
}));

describe('cashless fine settlement', () => {
  it('rejects collection requests and manual mark-paid actions until a verified M-Pesa callback exists', async () => {
    await expect(
      finesService.initiateCollection(
        { userId: 'officer-1', groupId: 'group-1', role: 'chairperson' } as never,
        'fine-1',
      ),
    ).rejects.toThrow(/collection and settlement are disabled until a verified M-Pesa callback flow is connected/i);
    await expect(
      finesService.markPaid(
        { userId: 'officer-1', groupId: 'group-1', role: 'chairperson' } as never,
        'fine-1',
      ),
    ).rejects.toThrow(/collection and settlement are disabled until a verified M-Pesa callback flow is connected/i);

    expect(withTransaction).not.toHaveBeenCalled();
  });
});
