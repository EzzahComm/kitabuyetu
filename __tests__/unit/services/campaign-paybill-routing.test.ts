jest.mock('@/lib/db', () => ({ withAdminDb: jest.fn() }));
jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/services/daraja.service', () => ({
  registerC2BUrls: jest.fn(),
  getC2BUrls: jest.fn(),
  assertSafaricomIp: jest.fn(),
}));
jest.mock('@/lib/services/mpesa-payment-accounts.service', () => ({
  lookupPaymentAccount: jest.fn(),
  isPaymentEligible: jest.fn(),
}));
jest.mock('@/lib/services/mpesa-spine.service', () => ({
  IS_SANDBOX: false,
  emitPaymentReceiptEvent: jest.fn(),
  logPaymentEvent: jest.fn(),
  emitOutbox: jest.fn(),
  spinePaymentId: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/services/mpesa-allocation.service', () => ({
  dispatchProduct: jest.fn(),
  applyWelfareFromC2B: jest.fn(),
  applyContributionFromC2B: jest.fn(),
  c2bToUnrouted: jest.fn(),
  resolveProductForMembership: jest.fn(),
  eligibilityGate: jest.fn(),
  hasDueInstallments: jest.fn(),
  applyLoanRepayment: jest.fn(),
}));
jest.mock('@/lib/services/campaign-donation-ledger.service', () => ({ creditCampaignDonation: jest.fn() }));

import { withAdminDb } from '@/lib/db';
import { handleC2BConfirmation, parseCampaignAccountCode, validateC2BAccount } from '@/lib/services/mpesa-c2b.service';
import { creditCampaignDonation } from '@/lib/services/campaign-donation-ledger.service';
import { c2bToUnrouted } from '@/lib/services/mpesa-allocation.service';

const mockQuery = jest.fn();
const body = {
  TransactionType: 'Pay Bill',
  TransID: 'RCP123',
  TransTime: '20260929120000',
  TransAmount: '750.00',
  BusinessShortCode: '4044141',
  BillRefNumber: 'ch4k7m-2q',
  MSISDN: '254712345678',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn({ query: mockQuery }));
});

describe('parseCampaignAccountCode', () => {
  it('normalises case, spaces and hyphens', () => {
    expect(parseCampaignAccountCode('ch4k7m-2q')).toBe('CH4K7M2Q');
    expect(parseCampaignAccountCode(' CH 4K7M2Q ')).toBe('CH4K7M2Q');
  });
  it('rejects anything that is not CH + 6 alphanumerics', () => {
    expect(parseCampaignAccountCode('BG102534')).toBeNull();
    expect(parseCampaignAccountCode('CH12345')).toBeNull();
    expect(parseCampaignAccountCode('CH1234567')).toBeNull();
    expect(parseCampaignAccountCode(null)).toBeNull();
  });
});

describe('handleC2BConfirmation → campaign account', () => {
  it('credits an active campaign found by account code', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // idempotency
      .mockResolvedValueOnce({ rows: [{ id: 'camp-1', group_id: 'g-1', status: 'active', ends_at: null }] })
      .mockResolvedValue({ rows: [{ id: 'txn-1' }] }); // recordC2BInbound
    await handleC2BConfirmation(body, '1.2.3.4', { skipIpCheck: true });
    expect(mockQuery.mock.calls[1][1]).toEqual(['CH4K7M2Q']);
    expect(creditCampaignDonation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        campaignId: 'camp-1',
        groupId: 'g-1',
        amount: 750,
        receipt: 'RCP123',
        channel: 'paybill',
      }),
    );
    expect(c2bToUnrouted).not.toHaveBeenCalled();
  });

  it('parks money for an ended campaign instead of crediting it', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'camp-1', group_id: 'g-1', status: 'active', ends_at: '2020-01-01' }] })
      .mockResolvedValue({ rows: [{ id: 'txn-1' }] });
    await handleC2BConfirmation(body, '1.2.3.4', { skipIpCheck: true });
    expect(creditCampaignDonation).not.toHaveBeenCalled();
    expect(c2bToUnrouted).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ groupId: 'g-1' }), 'other');
  });

  it('does not credit a receipt that already has a payment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'pay-1' }] });
    await handleC2BConfirmation(body, '1.2.3.4', { skipIpCheck: true });
    expect(creditCampaignDonation).not.toHaveBeenCalled();
  });
});

describe('validateC2BAccount → campaign account', () => {
  it('accepts a known campaign code even when it looks like a membership number', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    await expect(validateC2BAccount('CH234567')).resolves.toEqual({ accept: true });
  });
});
