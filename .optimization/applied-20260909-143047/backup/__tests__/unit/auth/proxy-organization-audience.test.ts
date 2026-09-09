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

/**
 * proxy.ts's checkRateLimit() does a REAL fetch() to Upstash whenever
 * process.env.REDIS_URL is set — and next/jest loads .env*, so it always is.
 * Every proxy() call below would otherwise make a live network round-trip:
 * slow, and a genuine source of CI flakes (two tests in this file timed out at
 * jest's 5s default on 2026-08-05, passing again on re-run).
 *
 * Rate limiting is not what this file tests. Deleting the variable makes
 * checkRateLimit take its documented "not configured → allow" branch
 * deterministically, with no network.
 *
 * It has to be deleted here rather than in the environment because lib/env.ts
 * requires REDIS_URL and validates at import time (via lib/auth/jwt.ts above) —
 * unsetting it before the run fails the whole suite. checkRateLimit reads
 * process.env at call time, so removing it after import is both safe and
 * sufficient.
 */
const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

beforeAll(() => {
  delete process.env.REDIS_URL;
});

afterAll(() => {
  if (ORIGINAL_REDIS_URL !== undefined) process.env.REDIS_URL = ORIGINAL_REDIS_URL;
});

/**
 * The organization API tree is BACKOFFICE-audience, at /api/admin/organization/*.
 *
 * This file used to assert a carve-out that let a backoffice token reach
 * /api/v1/organization/* by reshaping its claims to look tenant-ish —
 * including `x-group-id: ''`, which it asserted explicitly. That carve-out
 * never actually worked: getAuthContext guards with `!groupId`, and '' is
 * falsy, so every organization request threw "Missing authentication context"
 * and the enterprise Portfolio dashboard could not load at all.
 *
 * The old test passed anyway, because it only ever checked what the proxy
 * stamped — never that a route could USE those headers. Worth remembering:
 * asserting the mechanics of a workaround is not the same as asserting the
 * outcome it exists to produce.
 */
describe('proxy: organization API audience', () => {
  it('lets an organization_coordinator backoffice token reach /api/admin/organization/* as backoffice', async () => {
    const token = signBackofficeAccessToken({
      sub: 'coordinator-1', aud: 'backoffice', platformRole: 'organization_coordinator', organizationId: 'org-1',
    });
    const res = await proxy(bearerReq('/api/admin/organization/profile', token));

    expect(res.status).not.toBe(403);
    // Stamped as what it really is — no more pretending a backoffice token is
    // a tenant one, and no empty-string group sentinel.
    expect(downstreamHeader(res, 'x-aud')).toBe('backoffice');
    expect(downstreamHeader(res, 'x-platform-role')).toBe('organization_coordinator');
    expect(downstreamHeader(res, 'x-organization-id')).toBe('org-1');
  });

  it('lets super_admin reach the organization tree too', async () => {
    const token = signBackofficeAccessToken({ sub: 'admin-1', aud: 'backoffice', platformRole: 'super_admin' });
    const res = await proxy(bearerReq('/api/admin/organization/dashboard', token));

    expect(res.status).not.toBe(403);
    expect(downstreamHeader(res, 'x-platform-role')).toBe('super_admin');
  });

  it('rejects a backoffice token on /api/v1/* — the carve-out is gone', async () => {
    const token = signBackofficeAccessToken({
      sub: 'coordinator-1', aud: 'backoffice', platformRole: 'organization_coordinator', organizationId: 'org-1',
    });
    // The old carve-out path specifically: it must no longer be special.
    expect((await proxy(bearerReq('/api/v1/organization/profile', token))).status).toBe(403);
    expect((await proxy(bearerReq('/api/v1/loans', token))).status).toBe(403);
  });

  it('rejects a TENANT token on the organization tree — it is not a group-scoped surface', async () => {
    const token = signAccessToken({
      sub: 'member-1', groupId: 'group-1', role: 'organization_coordinator', organizationId: 'org-1',
    });
    const res = await proxy(bearerReq('/api/admin/organization/profile', token));

    expect(res.status).toBe(403);
  });
});
