import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { env } from '@/lib/env';
import { redis } from '@/lib/redis';
import { sendServiceSms } from '@/lib/services/notifications.service';

const ttlSeconds = 300;
const retrySeconds = 60;

type StaffIdentity = { id: string; phone: string; email: string | null };

function digest(staff: StaffIdentity, nonce: string, code: string): string {
  return createHmac('sha256', env.JWT_SECRET)
    .update(JSON.stringify(['enterprise-sms-mfa', staff.id, staff.phone, staff.email, nonce, code]))
    .digest('hex');
}

function challengeKey(memberId: string) {
  return `${process.env.REDIS_PREFIX ?? 'ky:'}enterprise-sms-mfa:${memberId}:challenge`;
}

export async function issueStaffSmsCode(staff: StaffIdentity) {
  const cooldown = `${challengeKey(staff.id)}:cooldown`;
  if (!(await redis.set(cooldown, '1', { nx: true, ex: retrySeconds }))) {
    return { status: 'cooldown' } as const;
  }

  const nonce = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const key = challengeKey(staff.id);
  await redis.set(key, `${nonce}:${digest(staff, nonce, code)}:0`, { ex: ttlSeconds });
  const result = await sendServiceSms({
    phone: staff.phone,
    memberId: staff.id,
    notificationType: 'enterprise_sign_in',
    redactBody: true,
    body: `Your Kitabu Yetu sign-in code is ${code}. It expires in 5 minutes. Do not share it.`,
  });
  if (!result.sent) return { status: 'failed' } as const;
  return { status: 'sent', nonce } as const;
}

// Verify, count failures and consume in one operation so concurrent requests
// cannot use the same code twice or exceed the attempt limit.
const consumeCode = `
local state = redis.call('GET', KEYS[1])
if not state then return 0 end
local nonce, digest, attempts = string.match(state, '^([^:]+):([^:]+):(%d+)$')
if nonce ~= ARGV[1] then return 0 end
if digest == ARGV[2] then
  if ARGV[3] == '1' then redis.call('DEL', KEYS[1]) end
  return 1
end
attempts = tonumber(attempts) + 1
if attempts >= 5 then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], nonce .. ':' .. digest .. ':' .. attempts, 'KEEPTTL')
end
return 0
`;

export async function verifyStaffSmsCode(
  staff: StaffIdentity,
  nonce: string,
  code: string,
  consume = true,
): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  return (
    (await redis.eval<string[], number>(
      consumeCode,
      [challengeKey(staff.id)],
      [nonce, digest(staff, nonce, code), consume ? '1' : '0'],
    )) === 1
  );
}
