import { createHmac, randomInt } from 'node:crypto';
import { sendEmailWithFallback } from '@/lib/email/provider';
import { env } from '@/lib/env';
import { redis } from '@/lib/redis';
import { AppError, ValidationError } from '@/lib/utils/errors';

const CODE_TTL = 600;
const CODE_ATTEMPTS = 5;
const PREFIX = `${process.env.REDIS_PREFIX ?? 'ky:'}enterprise-signup:`;

function digest(value: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(PREFIX).update(value).digest('hex');
}

export async function readOrganizationSignupJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ValidationError('Request body is required.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        throw new AppError('Request is too large.', 'PAYLOAD_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('Send a valid JSON request.');
  }
}

export async function sendOrganizationSignupCode(email: string, ip: string): Promise<void> {
  const addressKey = digest(email);
  const code = String(randomInt(100000, 1000000));
  const accepted = await redis.eval<Array<string | number>, number>(
    `local ip_total = redis.call('INCR', KEYS[1])
     if ip_total == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
     if ip_total > 15 then return 0 end
     if not redis.call('SET', KEYS[2], '1', 'EX', 60, 'NX') then return 0 end
     local email_total = redis.call('INCR', KEYS[3])
     if email_total == 1 then redis.call('EXPIRE', KEYS[3], 3600) end
     if email_total > 3 then return 0 end
     redis.call('HSET', KEYS[4], 'hash', ARGV[1], 'attempts', ARGV[2])
     redis.call('EXPIRE', KEYS[4], ARGV[3])
     return 1`,
    [
      PREFIX + 'ip:' + digest(ip),
      PREFIX + 'cooldown:' + addressKey,
      PREFIX + 'email:' + addressKey,
      PREFIX + addressKey,
    ],
    [digest(email + ':' + code), CODE_ATTEMPTS, CODE_TTL],
  );
  if (!accepted) throw new AppError('Wait before requesting another code.', 'SIGNUP_CODE_RATE_LIMIT', 429);

  const text = `Your Kitabu Yetu Enterprise verification code is ${code}. It expires in 10 minutes.`;
  const sent = await sendEmailWithFallback({
    to: email,
    subject: 'Your Kitabu Yetu Enterprise verification code',
    text,
    html: `<p>${text}</p>`,
    templateKey: 'enterprise_signup_verification',
  });
  if (!sent.success || sent.dryRun) {
    throw new AppError('Verification email is temporarily unavailable.', 'SIGNUP_EMAIL_UNAVAILABLE', 503);
  }
}

export async function consumeOrganizationSignupCode(email: string, code: string): Promise<boolean> {
  const accepted = await redis.eval<Array<string | number>, number>(
    `local expected = redis.call('HGET', KEYS[1], 'hash')
     if not expected then return 0 end
     if expected == ARGV[1] then
       redis.call('DEL', KEYS[1])
       return 1
     end
     if redis.call('HINCRBY', KEYS[1], 'attempts', -1) <= 0 then redis.call('DEL', KEYS[1]) end
     return 0`,
    [PREFIX + digest(email)],
    [digest(email + ':' + code)],
  );
  return accepted === 1;
}
