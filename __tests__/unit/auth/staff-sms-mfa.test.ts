import { issueStaffSmsCode, verifyStaffSmsCode } from '@/lib/auth/staff-sms-mfa';
import { redis } from '@/lib/redis';
import { sendServiceSms } from '@/lib/services/notifications.service';

jest.mock('@/lib/redis', () => ({ redis: { set: jest.fn(), eval: jest.fn() } }));
jest.mock('@/lib/services/notifications.service', () => ({ sendServiceSms: jest.fn() }));

const staff = { id: 'test-staff', phone: '254700000000', email: 'staff@example.test' };
const set = jest.mocked(redis.set);
const evaluate = jest.mocked(redis.eval);
const send = jest.mocked(sendServiceSms);

beforeEach(() => jest.clearAllMocks());

it('issues a short-lived challenge, hashes the code and redacts the SMS log', async () => {
  set.mockResolvedValue('OK');
  send.mockResolvedValue({ sent: true });

  const result = await issueStaffSmsCode(staff);
  expect(result.status).toBe('sent');
  if (result.status !== 'sent') throw new Error('Expected SMS to be sent');
  expect(set).toHaveBeenNthCalledWith(1, expect.stringContaining(':cooldown'), '1', { nx: true, ex: 60 });
  const { body } = send.mock.calls[0][0];
  const code = body.match(/is (\d{6})/)?.[1];
  if (!code) throw new Error('Expected a six-digit sign-in code');
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ phone: staff.phone, redactBody: true }));
  expect(set).toHaveBeenNthCalledWith(2, expect.any(String), expect.stringMatching(/^[a-f0-9-]+:[a-f0-9]{64}:0$/), {
    ex: 300,
  });
  const storedDigest = String(set.mock.calls[1][1]).split(':')[1];

  evaluate.mockResolvedValue(1);
  expect(await verifyStaffSmsCode(staff, result.nonce, code)).toBe(true);
  expect(evaluate).toHaveBeenLastCalledWith(
    expect.any(String),
    [expect.any(String)],
    [result.nonce, storedDigest, '1'],
  );

  await verifyStaffSmsCode(staff, result.nonce, code, false);
  expect(evaluate).toHaveBeenLastCalledWith(
    expect.any(String),
    [expect.any(String)],
    [result.nonce, storedDigest, '0'],
  );

  await verifyStaffSmsCode({ ...staff, email: 'changed@example.test' }, result.nonce, code);
  expect(evaluate.mock.calls.at(-1)?.[2]?.[1]).not.toBe(storedDigest);
});

it('does not send another message during the cooldown', async () => {
  set.mockResolvedValue(null);
  expect(await issueStaffSmsCode(staff)).toEqual({ status: 'cooldown' });
  expect(send).not.toHaveBeenCalled();
});
