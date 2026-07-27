/**
 * organizationService.listGroupSummaries — was fully unbounded (no LIMIT at
 * all), returning every group linked to an organization in one query
 * (audit/04-performance-findings.md #1). Now bounded by a default/max page
 * size while preserving every consumer's "give me everything for
 * client-side search/sort" UX at realistic org sizes.
 */
import { withDb } from '@/lib/db';
import { organizationService } from '@/lib/services/organization.service';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
  withAdminDb: jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'coord-1', role: 'organization_coordinator', organizationId: 'org-1' };

describe('organizationService.listGroupSummaries', () => {
  it('defaults to page 1, limit 200 and always includes a LIMIT/OFFSET in the query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '3' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await organizationService.listGroupSummaries(ctx);

    const itemsCall = mockQuery.mock.calls[1];
    expect(itemsCall[0]).toContain('LIMIT $2 OFFSET $3');
    expect(itemsCall[1]).toEqual(['org-1', 200, 0]);
    expect(result).toEqual({ items: [], total: 3, page: 1, pageSize: 200, totalPages: 1 });
  });

  it('computes the correct OFFSET for page 2', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '250' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await organizationService.listGroupSummaries(ctx, { page: 2, limit: 100 });

    const itemsCall = mockQuery.mock.calls[1];
    expect(itemsCall[1]).toEqual(['org-1', 100, 100]);
  });

  it('caps an oversized limit at 500 rather than passing it through unbounded', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await organizationService.listGroupSummaries(ctx, { limit: 100_000 });

    const itemsCall = mockQuery.mock.calls[1];
    expect(itemsCall[1]).toEqual(['org-1', 500, 0]);
  });

  it('clamps a non-positive page to 1', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await organizationService.listGroupSummaries(ctx, { page: 0 });

    const itemsCall = mockQuery.mock.calls[1];
    expect(itemsCall[1]).toEqual(['org-1', 200, 0]);
  });
});
