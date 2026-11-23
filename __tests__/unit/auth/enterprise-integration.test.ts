import { createLocalJWKSet, createRemoteJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { authenticateEnterpriseClient } from '@/lib/enterprise-integration/auth';
import { getEnterpriseIntegrations, type EnterpriseIntegrationClient } from '@/lib/enterprise-integration/config';
import { redis } from '@/lib/redis';

jest.mock('jose', () => ({ ...jest.requireActual('jose'), createRemoteJWKSet: jest.fn() }));
jest.mock('@/lib/enterprise-integration/config');
jest.mock('@/lib/redis', () => ({ redis: { eval: jest.fn() } }));

const client: EnterpriseIntegrationClient = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  issuer: 'https://identity.example.com/',
  audience: 'urn:kitabuyetu:partner',
  jwksUrl: 'https://identity.example.com/jwks',
  clientId: 'subira-backend',
  subject: 'subira-backend',
  scopes: ['billing.read'],
  products: ['kitabu_yetu'],
};

it('verifies machine identity and scope, checks both rate buckets, and fails closed', async () => {
  const key = await generateKeyPair('RS256');
  const publicKey = await exportJWK(key.publicKey);
  jest
    .mocked(createRemoteJWKSet)
    .mockReturnValue(createLocalJWKSet({ keys: [publicKey] }) as ReturnType<typeof createRemoteJWKSet>);
  jest.mocked(getEnterpriseIntegrations).mockReturnValue({ clients: [client], webhooks: [] });

  async function request(type = 'at+jwt', subject = client.subject) {
    const token = await new SignJWT({ client_id: client.clientId, scope: 'billing.read products.read' })
      .setProtectedHeader({ alg: 'RS256', typ: type })
      .setIssuer(client.issuer)
      .setAudience(client.audience)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime('10 minutes')
      .setJti('test-token')
      .sign(key.privateKey);
    return new Request('https://kitabuyetu.example/api/partner/v1/plan', {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  jest.mocked(redis.eval).mockResolvedValue([1, 1]);
  await expect(authenticateEnterpriseClient(await request(), 'billing.read')).resolves.toEqual(client);
  await expect(authenticateEnterpriseClient(await request(), 'products.read')).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(authenticateEnterpriseClient(await request('JWT'), 'billing.read')).rejects.toMatchObject({
    statusCode: 401,
  });
  await expect(
    authenticateEnterpriseClient(await request('at+jwt', 'another-client'), 'billing.read'),
  ).rejects.toMatchObject({ statusCode: 401 });

  jest.mocked(redis.eval).mockResolvedValue([121, 1]);
  await expect(authenticateEnterpriseClient(await request(), 'billing.read')).rejects.toMatchObject({
    statusCode: 429,
  });
  jest.mocked(redis.eval).mockResolvedValue([1, 31]);
  await expect(authenticateEnterpriseClient(await request(), 'billing.read')).rejects.toMatchObject({
    statusCode: 429,
  });
  jest.mocked(redis.eval).mockRejectedValue(new Error('offline'));
  await expect(authenticateEnterpriseClient(await request(), 'billing.read')).rejects.toMatchObject({
    statusCode: 503,
  });
});
