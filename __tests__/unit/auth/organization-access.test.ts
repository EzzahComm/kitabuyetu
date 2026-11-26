import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';

const query = jest.fn();
jest.mock('@/lib/db', () => ({
  withAdminDb: (run: (client: { query: typeof query }) => Promise<unknown>) => run({ query }),
}));

const userId = '00000000-0000-4000-8000-000000000001';
const organizationId = '00000000-0000-4000-8000-000000000002';

function organizationRequest() {
  return new NextRequest('https://kitabuyetu.co.ke/api/admin/organization/plan', {
    headers: {
      'x-aud': 'backoffice',
      'x-user-id': userId,
      'x-platform-role': 'organization_coordinator',
      'x-organization-id': organizationId,
    },
  });
}

beforeEach(() => query.mockReset());

it('passes the verified organization context to the handler for current staff', async () => {
  query.mockResolvedValueOnce({ rows: [{ allowed: true }] });
  const handler = jest.fn(async () => new Response(null, { status: 204 }));

  const response = await withOrganizationAccess(organizationRequest(), 'organization.plan.view', handler);

  expect(response.status).toBe(204);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("om.status = 'active'"), [userId, organizationId]);
  expect(handler).toHaveBeenCalledWith(expect.objectContaining({ organizationId, userId }));
});

it('denies a coordinator whose signed session no longer has a current membership', async () => {
  query.mockResolvedValueOnce({ rows: [{ allowed: false }] });
  const handler = jest.fn(async () => new Response(null, { status: 204 }));

  const response = await withOrganizationAccess(organizationRequest(), 'organization.plan.view', handler);

  expect(response.status).toBe(403);
  expect(handler).not.toHaveBeenCalled();
});
