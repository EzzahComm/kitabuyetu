import { NextRequest } from 'next/server';

/**
 * POST /api/v1/mpesa/b2c?type=balance_result reached handleBalanceResult with
 * no authenticity check at all. That handler runs
 *
 *   UPDATE mpesa_transactions SET status=$1, ... WHERE originator_conversation_id=$3 OR conversation_id=$4
 *
 * with no transaction_type restriction, so an anonymous POST carrying a guessed
 * or observed Daraja ConversationID could flip an arbitrary M-Pesa transaction
 * to 'completed'. proxy.ts treats anything under /api/v1/mpesa/b2c as a
 * callback: JWT bypassed and excluded from rate limiting entirely.
 *
 * The sibling result/timeout branch in the same file always called
 * isValidCallbackToken, and daraja.service.ts's own header records that Phase 4
 * extended the shared-secret mechanism to Account Balance — this branch simply
 * never got it. assertSafaricomIp is not a substitute: it is advisory by design
 * and logs rather than throws.
 *
 * These tests pin that a forged balance callback is dropped before it touches
 * any money state, and that a correctly-tokenised one still gets through.
 */

const ENV_KEYS = ['MPESA_ENV', 'MPESA_CALLBACK_TOKEN'] as const;
const originalEnv: Record<string, string | undefined> = {};

const handleBalanceResult = jest.fn();
const handleB2CResult = jest.fn();

jest.mock('@/lib/services/mpesa.service', () => ({
  handleBalanceResult: (...args: unknown[]) => handleBalanceResult(...args),
  handleB2CResult: (...args: unknown[]) => handleB2CResult(...args),
}));
jest.mock('@/lib/services/disbursements.service', () => ({ disbursementsService: {} }));
jest.mock('@/lib/services/settlement-callbacks.service', () => ({ handleVendorPaymentResult: jest.fn() }));
jest.mock('@/lib/services/membership-guard', () => ({ assertAuthFresh: jest.fn() }));
jest.mock('@/lib/db', () => ({ withAdminDb: jest.fn(async () => ({ rows: [] })) }));

// `after()` defers work past the response in production; run it inline so the
// assertions can observe whether the handler was reached at all.
jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  return { ...actual, after: (fn: () => unknown) => fn() };
});

beforeEach(() => {
  jest.resetModules();
  handleBalanceResult.mockClear();
  handleB2CResult.mockClear();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.MPESA_ENV = 'production';
  process.env.MPESA_CALLBACK_TOKEN = 'correct-horse-battery-staple';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function balanceReq(query: string) {
  return new NextRequest(new URL(`http://localhost/api/v1/mpesa/b2c${query}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ Result: { ResultCode: 0, ConversationID: 'AG_20260920_stolen' } }),
  });
}

describe('b2c balance callback authenticity', () => {
  it('drops a balance_result carrying no token, without touching money state', async () => {
    const { POST } = require('@/app/api/v1/mpesa/b2c/route');
    const res = await POST(balanceReq('?type=balance_result'));

    // Acked, so a prober learns nothing from the response...
    expect(res.status).toBe(200);
    // ...but the financial write never runs.
    expect(handleBalanceResult).not.toHaveBeenCalled();
  });

  it('drops a balance_result carrying a wrong token', async () => {
    const { POST } = require('@/app/api/v1/mpesa/b2c/route');
    const res = await POST(balanceReq('?type=balance_result&token=guessed'));

    expect(res.status).toBe(200);
    expect(handleBalanceResult).not.toHaveBeenCalled();
  });

  it('drops an untokenised balance_timeout too', async () => {
    const { POST } = require('@/app/api/v1/mpesa/b2c/route');
    await POST(balanceReq('?type=balance_timeout'));

    expect(handleBalanceResult).not.toHaveBeenCalled();
  });

  it('still processes a correctly-tokenised balance_result', async () => {
    const { POST } = require('@/app/api/v1/mpesa/b2c/route');
    const res = await POST(balanceReq('?type=balance_result&token=correct-horse-battery-staple'));

    expect(res.status).toBe(200);
    expect(handleBalanceResult).toHaveBeenCalledTimes(1);
  });
});
