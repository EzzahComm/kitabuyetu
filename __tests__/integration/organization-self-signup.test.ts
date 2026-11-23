import { NextRequest } from 'next/server';
import { POST } from '@/app/api/v1/auth/register-organization/route';
import { POST as requestCode } from '@/app/api/v1/auth/register-organization/verification/route';
import { consumeOrganizationSignupCode, sendOrganizationSignupCode } from '@/lib/auth/organization-signup';
import { assignOrganizationPlanInTx } from '@/lib/services/organization-plan.service';
import { proxy } from '@/proxy';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

jest.mock('@/lib/auth/organization-signup', () => ({
  ...jest.requireActual('@/lib/auth/organization-signup'),
  consumeOrganizationSignupCode: jest.fn(),
  sendOrganizationSignupCode: jest.fn(),
}));

jest.mock('@/lib/services/organization-plan.service', () => {
  const actual = jest.requireActual('@/lib/services/organization-plan.service');
  return { ...actual, assignOrganizationPlanInTx: jest.fn(actual.assignOrganizationPlanInTx) };
});

const signup = {
  organizationName: 'Enterprise Signup Test',
  organizationType: 'ngo',
  firstName: 'Test',
  lastName: 'Coordinator',
  phone: '0700118997',
  email: 'enterprise-test@example.invalid',
  password: 'EnterpriseTest123',
  verificationCode: '123456',
};

function request(payload: object, path = '') {
  return new NextRequest(`http://localhost/api/v1/auth/register-organization${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(consumeOrganizationSignupCode).mockResolvedValue(true);
  await resetDatabase();
});

it('routes an anonymous visitor to both signup handlers and sends a code to the normalized address', async () => {
  const fetch = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 }));
  try {
    const codeRequest = request({ email: signup.email.toUpperCase() }, '/verification');
    expect((await proxy(codeRequest)).status).toBe(200);
    expect((await proxy(request(signup))).status).toBe(200);
    expect((await requestCode(codeRequest)).status).toBe(200);
    expect(sendOrganizationSignupCode).toHaveBeenCalledWith(signup.email, 'unknown');
  } finally {
    fetch.mockRestore();
  }
});

it('creates the verified coordinator, lead membership and Starter subscription together', async () => {
  expect((await POST(request(signup))).status).toBe(201);
  const rows = await rawQuery(
    `SELECT m.email_verified, o.org_role, p.plan_type
     FROM members m JOIN organization_members o ON o.member_id=m.id
     JOIN organization_subscriptions p ON p.organization_id=o.organization_id WHERE m.email=$1`,
    [signup.email],
  );
  expect(rows).toEqual([{ email_verified: true, org_role: 'lead', plan_type: 'starter' }]);
  expect((await POST(request({ ...signup, email: signup.email.toUpperCase() }))).status).toBe(409);
});

it('requires a valid code and rejects plans that award bundled credits', async () => {
  jest.mocked(consumeOrganizationSignupCode).mockResolvedValueOnce(false);
  expect((await POST(request(signup))).status).toBe(422);
  expect((await POST(request({ ...signup, planType: 'premium' }))).status).toBe(422);
  expect(await rawQuery('SELECT id FROM organizations WHERE name=$1', [signup.organizationName])).toEqual([]);
});

it('rolls back the organization and coordinator if plan assignment fails', async () => {
  jest.mocked(assignOrganizationPlanInTx).mockRejectedValueOnce(new Error('plan unavailable'));
  expect((await POST(request(signup))).status).toBe(500);
  expect(await rawQuery('SELECT id FROM organizations WHERE name=$1', [signup.organizationName])).toEqual([]);
  expect(await rawQuery('SELECT id FROM members WHERE email=$1', [signup.email])).toEqual([]);
  expect((await POST(request(signup))).status).toBe(201);
});
