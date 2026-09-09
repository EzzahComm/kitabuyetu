import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { signAccessToken } from '@/lib/auth/jwt';

/**
 * proxy.ts used to rate-limit every /api/ request by IP alone: one shared
 * 120-req/60s bucket for every authenticated user behind the same public
 * address. The dashboard's own ~10 parallel calls on a single page load,
 * combined with Kenyan mobile carriers commonly putting many subscribers
 * behind one CGNAT address, made that budget easy to exhaust on entirely
 * legitimate traffic — surfacing to real users as "Some dashboard data
 * couldn't load ... Too many requests."
 *
 * Fix: authenticated tenant/backoffice traffic is now keyed by the JWT's
 * verified `sub` instead of IP (RL_LIMIT_USER, 240/60s); IP-keyed limiting
 * (RL_LIMIT_IP, 120/60s) is reserved for surfaces with no verified identity
 * — anonymous auth endpoints, webhooks, and requests that fail
 * authentication entirely on a protected route.
 *
 * These tests fake the Upstash REST pipeline endpoint with a real in-memory
 * INCR counter (keyed exactly like production: `rl:api:<key>`) rather than
 * hardcoding a single "over limit" response, so the assertions exercise the
 * actual fixed-window counting behaviour, not just a mocked verdict.
 */

function bearerReq(path: string, token: string, ip = '41.90.1.1'): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost'), {
    headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': ip },
  });
}

function anonReq(path: string, ip = '41.90.1.1'): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost'), {
    headers: { 'x-forwarded-for': ip },
  });
}

let counters: Map<string, number>;
let lastRequestedKeys: string[];

beforeEach(() => {
  counters = new Map();
  lastRequestedKeys = [];

  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.endsWith('/pipeline')) {
      throw new Error(`unexpected fetch in test: ${url}`);
    }
    const commands = JSON.parse(String(init?.body)) as string[][];
    const [, key] = commands[0]; // ['INCR', key]
    lastRequestedKeys.push(key);
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return new Response(
      JSON.stringify([{ result: next }, { result: 1 }]),
      { status: 200 },
    );
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('proxy: rate limiting keyed by user, not shared IP', () => {
  it('keys an authenticated tenant request by user id, not by IP', async () => {
    const token = signAccessToken({ sub: 'member-1', groupId: 'group-1', role: 'chairperson' });
    const res = await proxy(bearerReq('/api/v1/members', token));

    expect(res.status).not.toBe(429);
    expect(lastRequestedKeys).toEqual(['rl:api:user:member-1']);
  });

  it('gives two different users on the same IP independent budgets', async () => {
    // Same IP for both — this is exactly the CGNAT / shared-office scenario
    // that used to trip one user's dashboard load against a neighbour's.
    const tokenA = signAccessToken({ sub: 'member-a', groupId: 'group-1', role: 'chairperson' });
    const tokenB = signAccessToken({ sub: 'member-b', groupId: 'group-1', role: 'chairperson' });

    // Drive member-a to just under their own limit...
    for (let i = 0; i < 239; i++) {
      await proxy(bearerReq('/api/v1/members', tokenA));
    }
    const aAt239 = await proxy(bearerReq('/api/v1/members', tokenA));
    expect(aAt239.status).not.toBe(429); // 240th request for member-a: still allowed

    const aOver = await proxy(bearerReq('/api/v1/members', tokenA));
    expect(aOver.status).toBe(429); // 241st: over member-a's own budget

    // member-b, same IP, fresh session — untouched by member-a's usage.
    const bFirst = await proxy(bearerReq('/api/v1/members', tokenB));
    expect(bFirst.status).not.toBe(429);
  });

  it('returns RATE_LIMITED with a Retry-After header once a user is over budget', async () => {
    const token = signAccessToken({ sub: 'member-heavy', groupId: 'group-1', role: 'chairperson' });
    for (let i = 0; i < 240; i++) {
      await proxy(bearerReq('/api/v1/members', token));
    }
    const res = await proxy(bearerReq('/api/v1/members', token));

    expect(res.status).toBe(429);
    const json = await res.json() as { success: boolean; code: string };
    expect(json.success).toBe(false);
    expect(json.code).toBe('RATE_LIMITED');
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('keys an anonymous auth surface (login) by IP, never by user', async () => {
    const res = await proxy(anonReq('/api/v1/auth/login'));

    expect(res.status).not.toBe(429);
    expect(lastRequestedKeys).toEqual(['rl:api:ip:41.90.1.1']);
  });

  it('falls back to IP limiting for a protected route with no Authorization header', async () => {
    for (let i = 0; i < 120; i++) {
      await proxy(anonReq('/api/v1/members', '41.90.2.2'));
    }
    const res = await proxy(anonReq('/api/v1/members', '41.90.2.2'));

    // Over the IP budget before ever reaching the "missing header" 401 —
    // otherwise a flood of headerless requests against a protected route
    // would face no rate limit from this proxy at all.
    expect(res.status).toBe(429);
  });

  it('does not let unauthenticated floods on one IP consume an authenticated user’s own budget', async () => {
    // Exhaust the IP bucket with headerless requests against a protected route...
    for (let i = 0; i < 121; i++) {
      await proxy(anonReq('/api/v1/members', '41.90.3.3'));
    }
    // ...then a real, authenticated user on that SAME IP should be unaffected,
    // since they are keyed by `sub`, not by `ip:41.90.3.3`.
    const token = signAccessToken({ sub: 'member-real', groupId: 'group-1', role: 'chairperson' });
    const res = await proxy(bearerReq('/api/v1/members', token, '41.90.3.3'));

    expect(res.status).not.toBe(429);
  });
});
