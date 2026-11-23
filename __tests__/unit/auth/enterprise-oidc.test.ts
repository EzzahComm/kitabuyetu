import { createHash } from 'node:crypto';
import { createLocalJWKSet, createRemoteJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { withAdminDb } from '@/lib/db';
import { redis } from '@/lib/redis';
import { verifyMfaChallenge } from '@/lib/auth/jwt';
import {
  consumeEnterpriseOidcHandoff,
  finishEnterpriseOidc,
  startEnterpriseOidc,
} from '@/lib/enterprise-integration/oidc';

jest.mock('jose', () => ({ ...jest.requireActual('jose'), createRemoteJWKSet: jest.fn() }));
jest.mock('@/lib/db', () => ({ withAdminDb: jest.fn() }));
jest.mock('@/lib/redis', () => ({ redis: { set: jest.fn(), getdel: jest.fn() } }));

const organizationId = '00000000-0000-4000-8000-000000000001';
const memberId = '00000000-0000-4000-8000-000000000002';
const issuer = 'https://identity.example.com/';
const clientId = 'enterprise-oidc-test';

it('binds PKCE, nonce and state to a single-use transaction and issues an organization-locked MFA handoff', async () => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://kitabuyetu.example';
  process.env.ENTERPRISE_OIDC_CONNECTIONS = JSON.stringify([
    {
      name: 'subira',
      organizationId,
      issuer,
      clientId,
      clientSecret: 'test-only',
      authorizationUrl: issuer + 'authorize',
      tokenUrl: issuer + 'token',
      jwksUrl: issuer + 'keys',
      members: { 'staff-subject': memberId },
    },
  ]);
  const cache = new Map<string, unknown>();
  jest.mocked(redis.set).mockImplementation(async (key, value) => {
    cache.set(key, value);
    return 'OK';
  });
  jest.mocked(redis.getdel).mockImplementation(async (key) => {
    const value = cache.get(key);
    cache.delete(key);
    return value as never;
  });
  jest.mocked(withAdminDb).mockResolvedValue(true);
  const keys = await generateKeyPair('RS256');
  jest
    .mocked(createRemoteJWKSet)
    .mockReturnValue(
      createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] }) as ReturnType<typeof createRemoteJWKSet>,
    );

  const wrong = await startEnterpriseOidc('subira');
  await expect(finishEnterpriseOidc(wrong.id, 'invalid', 'test-code')).rejects.toThrow('state');
  const { destination, id } = await startEnterpriseOidc('subira');
  expect(destination.searchParams.get('code_challenge_method')).toBe('S256');
  const state = destination.searchParams.get('state')!;
  const nonce = destination.searchParams.get('nonce')!;
  const idToken = await new SignJWT({ nonce })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(issuer)
    .setAudience(clientId)
    .setSubject('staff-subject')
    .setIssuedAt()
    .setExpirationTime('5 minutes')
    .sign(keys.privateKey);
  const exchange = jest.spyOn(global, 'fetch').mockResolvedValueOnce(Response.json({ id_token: idToken }));
  try {
    const handoff = await finishEnterpriseOidc(id, state, 'test-code');
    expect(exchange.mock.calls[0][0]).toBe(issuer + 'token');
    const body = exchange.mock.calls[0][1]?.body as URLSearchParams;
    const verifier = body.get('code_verifier')!;
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      destination.searchParams.get('code_challenge'),
    );
    const { challenge } = await consumeEnterpriseOidcHandoff(handoff);
    expect(verifyMfaChallenge(challenge)).toMatchObject({
      sub: memberId,
      kind: 'verify',
      lockedOrganizationId: organizationId,
    });
    await expect(consumeEnterpriseOidcHandoff(handoff)).rejects.toMatchObject({ statusCode: 401 });
    await expect(finishEnterpriseOidc(id, state, 'test-code')).rejects.toThrow();
  } finally {
    exchange.mockRestore();
  }
});
