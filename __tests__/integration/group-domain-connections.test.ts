import { createHash, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createTestGroup, addGroupOfficer } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import type { AuthContext } from '@/types/api.types';
import {
  registerDomain,
  verifyDomain,
  disconnectDomain,
  exchange,
  consent,
  domainIdentity,
  connectedGroup,
} from '@/lib/group-domains/service';
import {
  callbackFor,
  connectionReturn,
  domainScopeFor,
  hostnameSchema,
  type DomainScope,
} from '@/lib/group-domains/protocol';
import { GET as entitlements } from '@/app/api/v1/billing/entitlements/route';
import { GET as identity } from '@/app/api/v1/auth/domain-identity/route';
import { POST as tokenEndpoint } from '@/app/api/connect/token/route';
import { GET as meetings, POST as createMeeting } from '@/app/api/v1/meetings/route';
import { GET as settings } from '@/app/api/v1/auth/group-domain/route';
import { proxy } from '@/proxy';
import { withAdminDb } from '@/lib/db';

const host = 'www.group-one.org';
const state = randomBytes(24).toString('base64url');
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
async function context(groupId: string, userId: string): Promise<AuthContext> {
  const [ctx] = await rawQuery<Pick<AuthContext, 'membershipId' | 'authVersion' | 'sessionVersion' | 'role'>>(
    `SELECT gm.id AS "membershipId", gm.auth_version AS "authVersion",
    gm.role, m.session_version AS "sessionVersion" FROM group_members gm JOIN members m ON m.id=gm.member_id
    WHERE gm.group_id=$1 AND gm.member_id=$2`,
    [groupId, userId],
  );
  return { ...ctx, groupId, userId };
}
async function group() {
  const { groupId, officerId } = await createTestGroup('chairperson');
  await rawQuery("UPDATE groups SET status='active' WHERE id=$1", [groupId]);
  return context(groupId, officerId);
}
async function verified(a: AuthContext) {
  const d = await registerDomain(a, host);
  await verifyDomain(a, host, async () => [['kitabuyetu=', d.challenge]]);
  return d;
}
async function authorize(a: AuthContext, scope: DomainScope = 'identity') {
  const result = await consent(a, host, { code_challenge: challenge, state, scope });
  const callback = new URL(result.redirect!);
  expect(callback.origin + callback.pathname).toBe(callbackFor(host));
  expect(callback.searchParams.get('state')).toBe(state);
  return callback.searchParams.get('code')!;
}
function request(path: string, token: string) {
  return new NextRequest('https://ky.example' + path, {
    headers: { authorization: 'Bearer ' + token, 'x-group-id': 'untrusted', 'x-role': 'super_admin' },
  });
}
beforeEach(resetDatabase);
afterAll(resetDatabase);

test('the retired renderer is unavailable and private tables deny anonymous reads', async () => {
  await withAdminDb(async (db) => {
    expect(
      (await db.query("SELECT to_regprocedure('public.get_published_organization_website(text)') IS NULL AS retired"))
        .rows[0].retired,
    ).toBe(true);
    expect((await db.query("SELECT 1 FROM feature_flags WHERE key='websites_enabled'")).rows).toHaveLength(0);
    for (const table of ['group_domains', 'group_domain_grants', 'organization_website_enquiries']) {
      expect(
        (await db.query("SELECT has_table_privilege('anon',$1,'SELECT') AS allowed", [table])).rows[0].allowed,
      ).toBe(false);
    }
  });
});
test('requires live chair membership and DNS proof before enabling the exact site', async () => {
  const a = await group();
  const b = await group();
  const secretary = await context(a.groupId, await addGroupOfficer(a.groupId, a.userId, 'secretary'));
  await expect(registerDomain(secretary, host)).rejects.toThrow(/chairperson/);
  const d = await registerDomain(a, host);
  expect(await connectedGroup(host)).toBeNull();
  await expect(verifyDomain(a, host, async () => [['wrong']])).rejects.toThrow(/TXT/);
  await verifyDomain(a, host, async (name) => {
    expect(name).toBe('_kitabuyetu.' + host);
    return [['kitabuyetu=' + d.challenge]];
  });
  expect((await connectedGroup(host))?.group_id).toBe(a.groupId);
  expect(await connectedGroup('group-one.org')).toBeNull();
  await expect(consent(b, host)).rejects.toThrow(/connected/);
  const other = await registerDomain(b, host);
  await expect(verifyDomain(b, host, async () => [['kitabuyetu=' + other.challenge]])).rejects.toThrow(/Another group/);
  await expect(consent(secretary, host)).resolves.toEqual({ role: 'secretary' });
  await expect(consent({ ...a, sessionVersion: -1 }, host)).rejects.toThrow(/active officer/);
});
test('does not accept a regular group member or a suspended group', async () => {
  const a = await group();
  await verified(a);
  const member = await context(a.groupId, await addGroupOfficer(a.groupId, a.userId, 'member'));
  await expect(consent(member, host)).rejects.toThrow(/officer/);
  await rawQuery("UPDATE groups SET status='suspended' WHERE id=$1", [a.groupId]);
  expect(await connectedGroup(host)).toBeNull();
  await expect(consent(a, host)).rejects.toThrow(/officer/);
});
test('binds a two-minute code to its verified hostname and its PKCE verifier; simultaneous redemption succeeds once', async () => {
  const a = await group();
  await verified(a);
  const code = await authorize(a);
  await expect(exchange('another.org', code, verifier)).rejects.toThrow(/Invalid/);
  await expect(exchange(host, code, 'other-verifier')).rejects.toThrow(/Invalid/);
  const results = await Promise.allSettled([exchange(host, code, verifier), exchange(host, code, verifier)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  await expect(exchange(host, code, verifier)).rejects.toThrow();
});
test('serves verified identity through an opaque token and enforces approved scopes in real API routes', async () => {
  const a = await group();
  await verified(a);
  const code = await authorize(a);
  const response = await tokenEndpoint(
    new Request('https://ky.example/api/connect/token', {
      method: 'POST',
      body: JSON.stringify({ hostname: host, code, code_verifier: verifier }),
    }),
  );
  expect(response.headers.get('cache-control')).toBe('no-store');
  const { access_token } = await response.json();
  const who = await identity(request('/api/v1/auth/domain-identity', access_token));
  expect((await who.json()).data).toEqual({ memberId: a.userId, groupId: a.groupId, role: 'chairperson' });
  expect((await entitlements(request('/api/v1/billing/entitlements', access_token))).status).toBe(403);
  const read = (await exchange(host, await authorize(a, 'group.read'), verifier)).access_token;
  expect((await entitlements(request('/api/v1/billing/entitlements', read))).status).toBe(200);
  expect((await settings(request('/api/v1/auth/group-domain', read))).status).toBe(403);
  await expect(domainIdentity(read, 'meetings.write')).rejects.toThrow(/consent/);
  const edit = (await exchange(host, await authorize(a, 'meetings.write'), verifier)).access_token;
  expect((await domainIdentity(edit, 'meetings.write')).groupId).toBe(a.groupId);
  await rawQuery('DELETE FROM subscriptions WHERE group_id=$1', [a.groupId]);
  expect((await meetings(request('/api/v1/meetings', read))).status).toBe(402);
});
test('proxy strips inbound claims, denies cross-audience routes and limits tokens to supported methods', async () => {
  const bearer = 'kyd_' + randomBytes(32).toString('base64url');
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('[{"result":1}]'));
  try {
    const normal = await proxy(request('/api/v1/meetings', bearer));
    expect(normal.headers.get('x-middleware-request-x-group-id')).toBeNull();
    expect(normal.headers.get('x-middleware-next')).toBe('1');
    for (const path of [
      '/api/admin/organizations',
      '/api/v1/auth/switch-group',
      '/api/v1/auth/domain-consent',
      '/api/v1/treasury',
    ]) {
      expect((await proxy(request(path, bearer))).status).toBe(403);
    }
    expect(domainScopeFor('POST', '/api/v1/contributions')).toBeNull();
  } finally {
    fetchSpy.mockRestore();
  }
});
test('disconnect, membership revocation, expiry and session invalidation affect outstanding tokens', async () => {
  const a = await group();
  const d = await verified(a);
  const token = (await exchange(host, await authorize(a), verifier)).access_token;
  await rawQuery('UPDATE group_members SET auth_version=auth_version+1 WHERE id=$1', [a.membershipId]);
  await expect(domainIdentity(token, 'identity')).rejects.toThrow(/revoked/);
  const fresh = await context(a.groupId, a.userId);
  const pending = await authorize(fresh);
  await rawQuery("UPDATE group_domain_grants SET expires_at=now()-interval '1 second'");
  await expect(exchange(host, pending, verifier)).rejects.toThrow();
  const second = (await exchange(host, await authorize(fresh), verifier)).access_token;
  await rawQuery('UPDATE members SET session_version=session_version+1 WHERE id=$1', [a.userId]);
  await expect(domainIdentity(second, 'identity')).rejects.toThrow();
  const renewed = await context(a.groupId, a.userId);
  const third = (await exchange(host, await authorize(renewed), verifier)).access_token;
  await rawQuery("UPDATE group_domains SET verified_until=now()-interval '1 second' WHERE id=$1", [d.id]);
  await expect(domainIdentity(third, 'identity')).rejects.toThrow();
  expect(await connectedGroup(host)).toBeNull();
  await verifyDomain(renewed, host, async () => [['kitabuyetu=' + d.challenge]]);
  await expect(domainIdentity(third, 'identity')).rejects.toThrow();
  const open = await authorize(renewed);
  await disconnectDomain(renewed, d.id);
  await expect(exchange(host, open, verifier)).rejects.toThrow();
  await expect(domainIdentity(third, 'identity')).rejects.toThrow();
});
test('rejects host tricks and external login return paths', () => {
  for (const value of [
    '127.0.0.1',
    'localhost',
    'user@group.org',
    'group.org/path',
    'group.org:8080',
    'group..org',
    'group.org.',
    '-evil.org',
  ]) {
    expect(hostnameSchema.safeParse(value).success).toBe(false);
  }
  expect(connectionReturn('/connect/' + host + '?state=test')).toBe('/connect/' + host + '?state=test');
  for (const value of [
    'https://other.org/',
    '//evil.org',
    '/connect/group.org/../../other',
    '/connect/%2f%2fevil.org',
    '/connect/group.org#fragment',
  ]) {
    expect(connectionReturn(value)).toBeNull();
  }
});

test('renews an existing domain from DNS during use and bounds retries when the proof disappears', async () => {
  const a = await group();
  const d = await verified(a);
  await rawQuery(
    "UPDATE group_domains SET verified_until=now()+interval '2 days',next_dns_check=now()-interval '1 day' WHERE id=$1",
    [d.id],
  );
  const lookup = jest.fn(async () => [['kitabuyetu=' + d.challenge]]);
  expect((await connectedGroup(host, lookup))?.group_id).toBe(a.groupId);
  await connectedGroup(host, lookup);
  expect(lookup).toHaveBeenCalledTimes(1);
  await rawQuery("UPDATE group_domains SET verified_until=now()-interval '1 minute',next_dns_check=NULL WHERE id=$1", [
    d.id,
  ]);
  const missing = jest.fn(async () => []);
  expect(await connectedGroup(host, missing)).toBeNull();
  expect(await connectedGroup(host, missing)).toBeNull();
  expect(missing).toHaveBeenCalledTimes(1);
});

test('a delegated meeting is created in the leader’s group and accepts only that group’s officers', async () => {
  const a = await group();
  const other = await group();
  await verified(a);
  const token = (await exchange(host, await authorize(a, 'meetings.write'), verifier)).access_token;
  async function create(chairedBy: string) {
    return createMeeting(
      new NextRequest('https://ky.example/api/v1/meetings', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Programme review', scheduledAt: '2027-02-11T08:00:00Z', chairedBy }),
      }),
    );
  }
  const created = await create(a.userId);
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id;
  expect(await rawQuery('SELECT group_id,created_by FROM meetings WHERE id=$1', [id])).toEqual([
    { group_id: a.groupId, created_by: a.userId },
  ]);
  const declined = await create(other.userId);
  expect(declined.status).toBeGreaterThanOrEqual(400);
  expect(declined.status).toBeLessThan(500);
});
