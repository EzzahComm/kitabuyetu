import bcrypt from 'bcryptjs';
import { POST as startLogin } from '@/app/api/v1/auth/admin/login/route';
import { POST as finishLogin } from '@/app/api/v1/auth/admin/login/verify/route';
import { issueStaffSmsCode, verifyStaffSmsCode } from '@/lib/auth/staff-sms-mfa';
import { buildRequest } from './helpers/request';
import { createTestOrganization } from './helpers/fixtures';
import { rawQuery } from './helpers/db';
import { resetDatabase } from './helpers/cleanup';

jest.mock('@/lib/auth/mfa', () => ({ generateTotpSecret: jest.fn() }));
jest.mock('@/lib/auth/staff-sms-mfa', () => ({
  issueStaffSmsCode: jest.fn().mockResolvedValue({ status: 'sent', nonce: 'test-nonce' }),
  verifyStaffSmsCode: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/lib/redis', () => ({
  ...jest.requireActual('@/lib/redis'),
  isAccountLocked: jest.fn().mockResolvedValue(false),
  clearLoginAttempts: jest.fn().mockResolvedValue(undefined),
  storeRefreshToken: jest.fn().mockResolvedValue(undefined),
}));

beforeAll(resetDatabase);
afterAll(resetDatabase);
afterEach(() => jest.restoreAllMocks());

it('uses the recorded phone for the first SMS sign-in and verifies it after the code', async () => {
  jest.replaceProperty(process, 'env', { ...process.env, ENTERPRISE_SMS_MFA_ENABLED: 'true' });
  const { organizationId, coordinatorId } = await createTestOrganization();
  const email = 'sms-staff@example.test';
  const password = 'LocalTestPassword1';
  await rawQuery('UPDATE members SET email=$2, password_hash=$3, phone_verified=FALSE WHERE id=$1', [
    coordinatorId,
    email,
    await bcrypt.hash(password, 4),
  ]);

  const request = () =>
    buildRequest('/api/v1/auth/admin/login', {
      method: 'POST',
      body: { surface: 'organization', email, password },
    });
  const initial = await startLogin(request());
  expect(initial.status).toBe(200);
  const { data } = await initial.json();
  expect(data.method).toBe('sms');
  expect(issueStaffSmsCode).toHaveBeenCalledWith(expect.objectContaining({ id: coordinatorId, email }));

  const complete = await finishLogin(
    buildRequest('/api/v1/auth/admin/login/verify', {
      method: 'POST',
      body: { challenge: data.challenge, code: '123456' },
    }),
  );
  expect(complete.status).toBe(200);
  expect((await complete.json()).data.member.organizationId).toBe(organizationId);
  expect(verifyStaffSmsCode).toHaveBeenCalledWith(
    expect.objectContaining({ id: coordinatorId }),
    'test-nonce',
    '123456',
    true,
  );
  expect(await rawQuery('SELECT phone_verified FROM members WHERE id=$1', [coordinatorId])).toEqual([
    { phone_verified: true },
  ]);

  await rawQuery("UPDATE organization_members SET status='archived' WHERE member_id=$1", [coordinatorId]);
  expect((await startLogin(request())).status).toBe(403);
});
