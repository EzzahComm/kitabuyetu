import { POST as verifyMfa } from '@/app/api/v1/auth/admin/login/verify/route';
import { POST as switchOrganization } from '@/app/api/admin/auth/switch-org/route';
import { GET as listOrganizations } from '@/app/api/admin/auth/my-organizations/route';
import { signMfaChallenge, verifyAccessToken } from '@/lib/auth/jwt';
import { backofficeHeaders, buildRequest } from './helpers/request';
import { createHmac, randomUUID } from 'node:crypto';
import { getEnterpriseIntegrations, type EnterpriseIntegrationClient } from '@/lib/enterprise-integration/config';
import { readEnterpriseGroupProducts, readEnterprisePlan } from '@/lib/enterprise-integration/reads';
import { deliverEnterpriseWebhook } from '@/lib/enterprise-integration/webhooks';
import { assignOrganizationPlan } from '@/lib/services/organization-plan.service';
import { createTestGroup, createTestOrganization, subscribeTestGroup } from './helpers/fixtures';
import { rawQuery } from './helpers/db';
import { resetDatabase } from './helpers/cleanup';

jest.mock('@/lib/enterprise-integration/config');
jest.mock('@/lib/auth/mfa', () => ({ verifyTotp: jest.fn((code: string) => code === '123456') }));
jest.mock('@/lib/redis', () => ({
  ...jest.requireActual('@/lib/redis'),
  isAccountLocked: jest.fn().mockResolvedValue(false),
  storeRefreshToken: jest.fn().mockResolvedValue(undefined),
}));
const config = jest.mocked(getEnterpriseIntegrations);

beforeEach(async () => {
  config.mockReturnValue({ clients: [], webhooks: [] });
  await resetDatabase();
});

it('requires a live organization, an approved link and a matching product grant', async () => {
  const { organizationId, coordinatorId } = await createTestOrganization();
  const { organizationId: otherOrganization } = await createTestOrganization();
  const { groupId } = await createTestGroup();
  const client: EnterpriseIntegrationClient = {
    organizationId,
    issuer: 'https://example.invalid',
    audience: 'test',
    jwksUrl: 'https://example.invalid/keys',
    clientId: 'a',
    subject: 'a',
    scopes: ['billing.read', 'products.read'],
    products: ['chama_reminder'],
  };
  await expect(readEnterprisePlan(client)).resolves.toMatchObject({ organization_id: organizationId });
  await rawQuery(
    `INSERT INTO organization_group_access
     (organization_id, group_id, access_level, granted_by, is_active, status)
     VALUES ($1,$2,'read',$3,true,'approved')`,
    [organizationId, groupId, coordinatorId],
  );
  await subscribeTestGroup(groupId, 'starter', 'chama_reminder');
  await expect(readEnterpriseGroupProducts(client, groupId)).resolves.toMatchObject({
    group_id: groupId,
    products: [{ product: 'chama_reminder' }],
  });
  await expect(
    readEnterpriseGroupProducts({ ...client, organizationId: otherOrganization }, groupId),
  ).rejects.toMatchObject({ statusCode: 404 });
  await rawQuery('UPDATE organizations SET is_active=false WHERE id=$1', [organizationId]);
  await expect(readEnterprisePlan(client)).rejects.toMatchObject({ statusCode: 404 });
  await expect(readEnterpriseGroupProducts(client, groupId)).rejects.toMatchObject({ statusCode: 404 });
});

it('queues a committed plan event and signs retry attempts with the same event identifier', async () => {
  const { organizationId, coordinatorId } = await createTestOrganization();
  const hook = {
    organizationId,
    endpointId: randomUUID(),
    url: 'https://example.invalid/hook',
    secret: 'af'.repeat(32),
  };
  config.mockReturnValue({ clients: [], webhooks: [hook] });

  const sub = await assignOrganizationPlan(organizationId, 'starter', coordinatorId);
  const [{ payload }] = await rawQuery(
    `SELECT payload FROM job_queue
     WHERE type='enterprise_webhook_delivery' AND payload->'event'->>'subscriptionId'=$1`,
    [sub.id],
  );
  const post = jest
    .spyOn(global, 'fetch')
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  try {
    await expect(deliverEnterpriseWebhook(payload)).rejects.toThrow('503');
    await expect(deliverEnterpriseWebhook(payload)).resolves.toMatchObject({ message: 'Enterprise webhook delivered' });
    for (const [url, options] of post.mock.calls) {
      const headers = new Headers(options?.headers);
      expect(url).toBe(hook.url);
      expect(options?.redirect).toBe('error');
      expect(headers.get('Webhook-Id')).toBe(sub.id);
      const signature = createHmac('sha256', Buffer.from(hook.secret, 'hex'))
        .update(`${sub.id}.${headers.get('Webhook-Timestamp')}.${options?.body}`)
        .digest('base64');
      expect(headers.get('Webhook-Signature')).toBe('v1,' + signature);
    }

    config.mockReturnValue({ clients: [], webhooks: [{ ...hook, url: 'https://example.invalid/replacement' }] });
    await expect(deliverEnterpriseWebhook(payload)).resolves.toMatchObject({
      message: 'Enterprise webhook endpoint disabled or replaced',
    });
    expect(post).toHaveBeenCalledTimes(2);
  } finally {
    post.mockRestore();
  }
});

it('keeps an OIDC-authenticated staff session in its approved organization after MFA', async () => {
  const { organizationId, coordinatorId } = await createTestOrganization();
  const { organizationId: otherOrganization } = await createTestOrganization();
  await rawQuery(
    `INSERT INTO organization_members (organization_id, member_id, org_role, status)
     VALUES ($1,$3,'lead','active'),($2,$3,'lead','active')`,
    [organizationId, otherOrganization, coordinatorId],
  );
  await rawQuery('INSERT INTO member_mfa_secrets (member_id, secret_encrypted) VALUES ($1,$2)', [
    coordinatorId,
    'test-encrypted-secret',
  ]);
  const challenge = signMfaChallenge({ sub: coordinatorId, kind: 'verify', lockedOrganizationId: organizationId });
  const response = await verifyMfa(
    buildRequest('/api/v1/auth/admin/login/verify', {
      method: 'POST',
      body: { challenge, code: '123456', organizationId: otherOrganization },
    }),
  );
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(verifyAccessToken(data.accessToken)).toMatchObject({ organizationId, organizationLocked: true });
  const headers = {
    ...backofficeHeaders({ userId: coordinatorId, platformRole: 'organization_coordinator', organizationId }),
    'x-organization-locked': 'true',
  };
  const outcome = await switchOrganization(
    buildRequest('/api/admin/auth/switch-org', {
      method: 'POST',
      headers,
      body: { organizationId: otherOrganization },
    }),
  );
  expect(outcome.status).toBe(403);
  const choices = await listOrganizations(buildRequest('/api/admin/auth/my-organizations', { headers }));
  expect((await choices.json()).data.items).toEqual([expect.objectContaining({ organizationId })]);
});
