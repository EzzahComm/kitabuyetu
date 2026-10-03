import { NextRequest } from 'next/server';

/**
 * A Changi$ha payout to a paybill/till (migration 202) is a Daraja B2B
 * transaction, so Safaricom reports its result to /api/v1/mpesa/b2b - not the
 * B2C route the withdrawal flow was first wired into. If the B2B route never
 * calls handleCampaignWithdrawalResult, the withdrawal sits in 'processing'
 * forever with its funds reserved. These tests pin both halves: the route
 * reaches the handler, and the handler logs a failure under the right channel
 * and still releases the reservation.
 */

const handleCampaignWithdrawalResult = jest.fn();

describe('POST /api/v1/mpesa/b2b?type=result', () => {
  const ENV_KEYS = ['MPESA_ENV', 'MPESA_CALLBACK_TOKEN'] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    jest.resetModules();
    handleCampaignWithdrawalResult.mockClear();
    jest.doMock('@/lib/services/mpesa.service', () => ({ handleB2BResult: jest.fn() }));
    jest.doMock('@/lib/services/settlement-callbacks.service', () => ({
      handleSettlementB2BResult: jest.fn(),
      handleVendorPaymentResult: jest.fn(),
      handleCampaignWithdrawalResult: (...args: unknown[]) => handleCampaignWithdrawalResult(...args),
    }));
    jest.doMock('@/lib/db', () => ({ withAdminDb: jest.fn(async () => ({ rows: [] })) }));
    // `after()` defers work past the response in production; run it inline.
    jest.doMock('next/server', () => {
      const actual = jest.requireActual('next/server');
      return { ...actual, after: (fn: () => unknown) => fn() };
    });
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

  const body = { Result: { ResultCode: 0, OriginatorConversationID: 'orig-b2b' } };

  it('routes a tokenised B2B result to the campaign-withdrawal handler', async () => {
    const { POST } = await import('@/app/api/v1/mpesa/b2b/route');
    await POST(
      new NextRequest('https://kitabuyetu.co.ke/api/v1/mpesa/b2b?type=result&token=correct-horse-battery-staple', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
    // after() runs synchronously here, but the handler chain inside it is async.
    await new Promise((resolve) => setImmediate(resolve));
    expect(handleCampaignWithdrawalResult).toHaveBeenCalledWith(body, expect.any(String));
  });

  it('drops a B2B result without the callback token before any handler runs', async () => {
    const { POST } = await import('@/app/api/v1/mpesa/b2b/route');
    await POST(
      new NextRequest('https://kitabuyetu.co.ke/api/v1/mpesa/b2b?type=result', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(handleCampaignWithdrawalResult).not.toHaveBeenCalled();
  });
});

describe('handleCampaignWithdrawalResult - failure path by channel', () => {
  const mockQuery = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    mockQuery.mockReset();
    jest.dontMock('@/lib/services/settlement-callbacks.service');
    jest.doMock('@/lib/db', () => ({
      withAdminDb: jest.fn((fn: (db: unknown) => unknown) => fn({ query: mockQuery })),
    }));
    jest.doMock('@/lib/services/daraja.service', () => ({ assertSafaricomIp: jest.fn() }));
    jest.doMock('@/lib/services/posting-templates.service', () => ({
      postSettlementSweepJournal: jest.fn(),
      postVendorPaymentJournal: jest.fn(),
      postCampaignWithdrawalJournal: jest.fn(),
    }));
    jest.doMock('@/lib/queue/qstash', () => ({ notifyDisbursementCallback: jest.fn() }));
  });

  const failed = {
    Result: {
      ResultCode: 2001,
      ResultDesc: 'The initiator information is invalid.',
      OriginatorConversationID: 'orig-1',
    },
  };

  async function runFailure(payoutMethod: 'phone' | 'paybill' | 'till') {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'cw-1',
            group_id: 'grp-1',
            campaign_id: 'camp-1',
            payout_method: payoutMethod,
            gross_amount: '1000.00',
            platform_fee_amount: '40.00',
            mpesa_charge_amount: '22.00',
            net_amount: '938.00',
          },
        ],
      })
      .mockResolvedValue({ rows: [{ id: 'acct-1' }] });
    const { handleCampaignWithdrawalResult: handler } = await import('@/lib/services/settlement-callbacks.service');
    await handler(failed, '196.201.214.200');
  }

  it.each([
    ['paybill', 'b2b'],
    ['till', 'b2b'],
    ['phone', 'b2c'],
  ] as const)('logs a failed %s payout as %s and releases the gross reservation', async (method, channel) => {
    await runFailure(method);

    const log = mockQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO failed_payment_logs'));
    expect(log?.[1][1]).toBe(channel);

    const release = mockQuery.mock.calls.find((c) => String(c[0]).includes('adjust_account_reserved_amount'));
    expect(release?.[1]).toEqual(['acct-1', '-1000.00']);
  });
});
