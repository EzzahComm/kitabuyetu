import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { signAccessToken, signBackofficeAccessToken } from '@/lib/auth/jwt';

function bearerReq(path: string, token: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost'), {
    headers: { authorization: `Bearer ${token}` },
  });
}

/**
 * Reads a header proxy.ts asked Next.js to attach to the downstream request
 * via NextResponse.next({ request: { headers } }) — Next.js surfaces these
 * on the returned response under the `x-middleware-request-<name>` prefix.
 */
function downstreamHeader(res: Response, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`);
}

describe('proxy: /api/v1/organization/* backoffice carve-out', () => {
  it('lets an organization_coordinator backoffice token reach /organization/* and reshapes it as tenant', async () => {
    const token = signBackofficeAccessToken({
      sub: 'coordinator-1', aud: 'backoffice', platformRole: 'organization_coordinator', organizationId: 'org-1',
    });
    const res = await proxy(bearerReq('/api/v1/organization/profile', token));

    expect(res.status).not.toBe(403);
    expect(downstreamHeader(res, 'x-aud')).toBe('tenant');
    expect(downstreamHeader(res, 'x-role')).toBe('organization_coordinator');
    expect(downstreamHeader(res, 'x-organization-id')).toBe('org-1');
    expect(downstreamHeader(res, 'x-group-id')).toBe('');
  });

  it('still lets super_admin through the carve-out', async () => {
    const token = signBackofficeAccessToken({ sub: 'admin-1', aud: 'backoffice', platformRole: 'super_admin' });
    const res = await proxy(bearerReq('/api/v1/organization/dashboard', token));

    expect(res.status).not.toBe(403);
    expect(downstreamHeader(res, 'x-role')).toBe('super_admin');
  });

  it('does NOT extend the carve-out to other /api/v1/* routes — a backoffice token is still rejected there', async () => {
    const token = signBackofficeAccessToken({
      sub: 'coordinator-1', aud: 'backoffice', platformRole: 'organization_coordinator', organizationId: 'org-1',
    });
    const res = await proxy(bearerReq('/api/v1/loans', token));

    expect(res.status).toBe(403);
  });

  it('a real tenant token on /organization/* still behaves exactly as before (no regression)', async () => {
    const token = signAccessToken({
      sub: 'member-1', groupId: 'group-1', role: 'organization_coordinator', organizationId: 'org-1',
    });
    const res = await proxy(bearerReq('/api/v1/organization/profile', token));

    expect(res.status).not.toBe(403);
    expect(downstreamHeader(res, 'x-aud')).toBe('tenant');
    expect(downstreamHeader(res, 'x-group-id')).toBe('group-1');
  });
});
