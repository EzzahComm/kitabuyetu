import { NextRequest } from 'next/server';
import { GET as executive } from '@/app/api/v1/analytics/executive/route';
import { GET as risk } from '@/app/api/v1/analytics/risk/route';
import { cached } from '@/lib/redis';

jest.mock('@/lib/db', () => ({ withDb: jest.fn() }));
jest.mock('@/lib/auth/subscription-gate', () => ({ assertSubscriptionActive: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/redis', () => ({
  cached: jest.fn(),
  keys: { cache: (name: string, scope: string) => `${name}:${scope}` },
}));

const cache = jest.mocked(cached);

function request(path: string, permissions?: string, overrides?: Record<string, string>) {
  const headers = {
    'x-user-id': 'officer',
    'x-group-id': 'group-a',
    'x-role': 'secretary',
    'x-aud': 'tenant',
    ...(permissions ? { 'x-permissions': permissions } : {}),
    ...overrides,
  };
  return new NextRequest(`https://example.test/api/v1/analytics/${path}`, { headers });
}

describe.each([
  ['executive', executive],
  ['risk', risk],
] as const)('%s analytics authorization', (path, handler) => {
  let results: Map<string, object>;

  beforeEach(() => {
    results = new Map();
    cache.mockReset();
    cache.mockImplementation(async <T>(key: string) => {
      if (!results.has(key)) results.set(key, { key });
      return results.get(key) as T;
    });
  });

  it('rejects access before checking either a cold or a warm cache', async () => {
    expect((await handler(request(path, 'dashboard.view', { 'x-role': 'member' }))).status).toBe(403);
    expect(cache).not.toHaveBeenCalled();

    expect((await handler(request(path, 'analytics.view'))).status).toBe(200);
    expect((await handler(request(path))).status).toBe(403);
    expect(cache).toHaveBeenCalledTimes(1);
  });

  it('uses the same cache entry only for the same tenant database context', async () => {
    expect((await handler(request(path, 'analytics.view'))).status).toBe(200);
    expect((await handler(request(path, 'analytics.view'))).status).toBe(200);
    for (const overrides of [
      { 'x-user-id': 'another-officer' },
      { 'x-role': 'treasurer' },
      { 'x-group-id': 'group-b' },
      { 'x-organization-id': 'organization-b' },
    ] as Record<string, string>[]) {
      expect((await handler(request(path, 'analytics.view', overrides))).status).toBe(200);
    }
    expect(cache).toHaveBeenCalledTimes(6);
    expect(results.size).toBe(5);
  });
});
