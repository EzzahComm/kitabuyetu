/**
 * Donor/grant spend report — closes ACCOUNTING_ARCHITECTURE_AUDIT.md §12
 * ("no endpoint aggregates spend-by-donor into a report"). Verifies programs
 * roll up correctly by funding_source (including the null -> 'Unspecified'
 * bucket) and that per-group settled-spend breakdowns land in the right bucket.
 */
import { withDb } from '@/lib/db';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
}));
jest.mock('./organization.service', () => ({
  organizationService: { assertOrganizationCoordinator: jest.fn() },
}), { virtual: true });

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: null, userId: 'coord-1', role: 'organization_coordinator', organizationId: 'org-1' };

describe('organizationFinanceService.donorSpendReport', () => {
  it('rolls up programs by funding source and attaches per-group settled spend', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'prog-1', name: 'Water Access', funding_source: 'World Bank', budget: '100000.00', disbursed_total: '40000.00', reserved: '10000.00' },
        { id: 'prog-2', name: 'School Fees',  funding_source: 'World Bank', budget: '50000.00',  disbursed_total: '20000.00', reserved: '0' },
        { id: 'prog-3', name: 'Emergency Fund', funding_source: null,       budget: '20000.00',  disbursed_total: '5000.00',  reserved: '0' },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { funding_source: 'World Bank', group_id: 'grp-1', group_name: 'Umoja VSLA', amount: '40000.00' },
        { funding_source: 'World Bank', group_id: 'grp-2', group_name: 'Amani Chama', amount: '20000.00' },
        { funding_source: null,         group_id: 'grp-3', group_name: 'Tumaini SACCO', amount: '5000.00' },
      ],
    });

    const result = await organizationFinanceService.donorSpendReport(ctx);

    expect(result).toHaveLength(2);

    const worldBank = result.find((d) => d.fundingSource === 'World Bank')!;
    expect(worldBank.programCount).toBe(2);
    expect(worldBank.totalBudget).toBe(150000);
    expect(worldBank.totalDisbursed).toBe(60000);
    expect(worldBank.totalReserved).toBe(10000);
    expect(worldBank.remaining).toBe(80000);
    expect(worldBank.utilizationPct).toBeCloseTo((70000 / 150000) * 100);
    expect(worldBank.byGroup).toEqual([
      { groupId: 'grp-1', groupName: 'Umoja VSLA', amount: 40000 },
      { groupId: 'grp-2', groupName: 'Amani Chama', amount: 20000 },
    ]);

    const unspecified = result.find((d) => d.fundingSource === 'Unspecified')!;
    expect(unspecified.programCount).toBe(1);
    expect(unspecified.totalDisbursed).toBe(5000);
    expect(unspecified.byGroup).toEqual([{ groupId: 'grp-3', groupName: 'Tumaini SACCO', amount: 5000 }]);

    // Sorted by totalDisbursed descending.
    expect(result[0].fundingSource).toBe('World Bank');
  });

  it('returns an empty array when the organization has no funding programs', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await organizationFinanceService.donorSpendReport(ctx);
    expect(result).toEqual([]);
  });
});
