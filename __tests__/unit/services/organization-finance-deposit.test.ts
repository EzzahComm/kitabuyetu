/**
 * organizationFinanceService.deposit — now also posts DR 1001 Cash and Bank /
 * CR 4001 Donor Contributions to the organization's own ledger (migration 085),
 * closing the gap where deposits only ever touched organization_wallets with
 * no GL trace (ACCOUNTING_ARCHITECTURE_AUDIT.md §9).
 */
import { withTransaction } from '@/lib/db';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
  withAdminDb: jest.fn(),
}));
jest.mock(
  './organization.service',
  () => ({
    organizationService: { assertOrganizationCoordinator: jest.fn() },
  }),
  { virtual: true },
);

const mockQuery = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'coord-1', role: 'organization_coordinator', organizationId: 'org-1' };

describe('organizationFinanceService.deposit', () => {
  it('rejects manual wallet deposits until provider-confirmed inbound payments exist', async () => {
    await expect(organizationFinanceService.deposit(ctx, { amount: 5000, source: 'typed reference' }))
      .rejects.toThrow(/disabled until an inbound M-Pesa provider-confirmation flow is connected/i);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
