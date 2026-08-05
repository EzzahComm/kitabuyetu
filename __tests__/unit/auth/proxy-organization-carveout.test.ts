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
