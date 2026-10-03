import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

/**
 * POST /api/v1/campaigns/<slug>/donate describes itself as "the ONE public,
 * unauthenticated endpoint on this platform that can trigger a real M-Pesa STK
 * push", and carries its own per-phone and per-IP rate limits for exactly that
 * reason — but it was never added to proxy.ts's public-path allowlist, so this
 * file answered 401 before the handler ever ran. Every anonymous Changi$ha
 * donation failed from the day the route shipped.
 *
 * The allowlist is an exact-match Set and the slug is dynamic, so the fix is an
 * anchored pattern. These tests pin both halves of that: the donate leaf is
 * open, and the sibling campaign routes stay closed — a prefix rule would have
 * silently exposed /campaigns/<id> and /campaigns/<id>/donations, which are
 * committee-only.
 *
 * proxy.ts applies the public-path bypass in TWO separate places (rate limiting
 * and JWT verification) that do not share a predicate, so a fix applied to only
 * one of them still 401s. The 'reaches the handler' assertions below are what
 * actually catch that.
 */

function anonReq(path: string, method = 'POST', ip = '41.90.1.1'): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost'), {
    method,
    headers: { 'x-forwarded-for': ip },
  });
}

beforeEach(() => {
  // Fake the Upstash REST pipeline with a real in-memory INCR, same shape the
  // sibling proxy rate-limit test uses.
  const counters = new Map<string, number>();
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.endsWith('/pipeline')) throw new Error(`unexpected fetch in test: ${url}`);
    const commands = JSON.parse(String(init?.body)) as string[][];
    const [, key] = commands[0];
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return new Response(JSON.stringify([{ result: next }, { result: 1 }]), { status: 200 });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('proxy: public Changi$ha donation endpoint', () => {
  it('lets an anonymous donation reach the handler instead of 401ing it', async () => {
    const res = await proxy(anonReq('/api/v1/campaigns/school-fees-appeal/donate'));
    expect(res.status).not.toBe(401);
  });

  it('accepts any campaign slug shape, since the slug is user-generated', async () => {
    for (const slug of ['a', 'medical-appeal-2026', 'GROUP-99-x']) {
      const res = await proxy(anonReq(`/api/v1/campaigns/${slug}/donate`));
      expect(res.status).not.toBe(401);
    }
  });

  it('still requires a session for the sibling campaign routes', async () => {
    // These must NOT have been opened up by the fix — a prefix rule would have.
    for (const path of [
      '/api/v1/campaigns',
      '/api/v1/campaigns/some-id',
      '/api/v1/campaigns/some-id/donations',
      '/api/v1/campaigns/some-id/submit',
    ]) {
      const res = await proxy(anonReq(path, 'GET'));
      expect(res.status).toBe(401);
    }
  });

  it('does not open a deeper path that merely contains /donate', async () => {
    const res = await proxy(anonReq('/api/v1/campaigns/some-id/donate/extra', 'GET'));
    expect(res.status).toBe(401);
  });
});
