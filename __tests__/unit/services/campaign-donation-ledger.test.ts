/**
 * Changi$ha donation ledger — money-accuracy properties shared by STK and
 * PayBill (C2B) settlement paths:
 *   - a Safaricom receipt is booked at most once (UNIQUE + ON CONFLICT)
 *   - amount_raised and the system journal move together
 *   - target-reached fires only on the donation that crosses the line
 */
import type { PoolClient } from 'pg';
import { postSystemJournal } from '@/lib/services/accounting.service';
import { recordActivityInTx, ActivityEventType } from '@/lib/notifications';
import { creditCampaignDonation } from '@/lib/services/campaign-donation-ledger.service';

jest.mock('@/lib/services/accounting.service', () => ({
  postSystemJournal: jest.fn().mockResolvedValue('je-1'),
}));
jest.mock('@/lib/notifications', () => ({
  recordActivityInTx: jest.fn().mockResolvedValue(undefined),
  ActivityEventType: {
    CAMPAIGN_DONATION_RECEIVED: 'CAMPAIGN_DONATION_RECEIVED',
    CAMPAIGN_TARGET_REACHED: 'CAMPAIGN_TARGET_REACHED',
  },
}));
jest.mock('@/lib/services/mpesa-spine.service', () => ({
  IS_SANDBOX: false,
}));

const mockQuery = jest.fn();
const client = { query: mockQuery } as unknown as PoolClient;

const baseInput = {
  campaignId: 'camp-1',
  groupId: 'group-1',
  donorName: 'Amina',
  donorPhone: '254712345678',
  amount: 750,
  message: 'For school fees',
  isAnonymous: false,
  receipt: 'RCP123',
  channel: 'paybill' as const,
};

/** Route by SQL so assertions describe behaviour, not call order. */
function scenario(opts: {
  donationId?: string | null;
  title?: string;
  target?: string;
  raisedAfter?: string;
  journalId?: string | null;
}) {
  const donationId = opts.donationId === undefined ? 'don-1' : opts.donationId;
  mockQuery.mockImplementation(async (sql: string) => {
    if (/INSERT INTO campaign_donations/.test(sql)) {
      return { rows: donationId ? [{ id: donationId }] : [] };
    }
    if (/UPDATE campaigns/.test(sql) && /amount_raised/.test(sql)) {
      return {
        rows: [
          {
            title: opts.title ?? 'School fees',
            target_amount: opts.target ?? '10000.00',
            amount_raised: opts.raisedAfter ?? '750.00',
          },
        ],
      };
    }
    if (/UPDATE campaign_donations SET journal_entry_id/.test(sql)) {
      return { rows: [] };
    }
    if (/INSERT INTO audit_logs/.test(sql)) {
      return { rows: [] };
    }
    return { rows: [] };
  });
  (postSystemJournal as jest.Mock).mockResolvedValue(opts.journalId === undefined ? 'je-1' : opts.journalId);
}

beforeEach(() => {
  mockQuery.mockReset();
  (postSystemJournal as jest.Mock).mockReset().mockResolvedValue('je-1');
  (recordActivityInTx as jest.Mock).mockReset().mockResolvedValue(undefined);
});

describe('creditCampaignDonation', () => {
  it('returns null when the M-Pesa receipt was already booked (idempotent retry)', async () => {
    scenario({ donationId: null });
    const id = await creditCampaignDonation(client, baseInput);
    expect(id).toBeNull();
    expect(postSystemJournal).not.toHaveBeenCalled();
    expect(recordActivityInTx).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE campaigns/.test(sql))).toBe(false);
  });

  it('books the donation, bumps amount_raised, and posts debit 1001 / credit 4006', async () => {
    scenario({ raisedAfter: '750.00', target: '10000.00' });
    const id = await creditCampaignDonation(client, baseInput);
    expect(id).toBe('don-1');

    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO campaign_donations/.test(sql));
    expect(insert?.[1]).toEqual([
      'camp-1',
      'group-1',
      'Amina',
      '254712345678',
      '750.00',
      'For school fees',
      false,
      'RCP123',
    ]);

    const bump = mockQuery.mock.calls.find(([sql]) => /UPDATE campaigns/.test(sql) && /amount_raised/.test(sql));
    expect(bump?.[1]).toEqual(['camp-1', '750.00']);

    expect(postSystemJournal).toHaveBeenCalledWith(
      client,
      'group-1',
      null,
      'Changi$ha donation — School fees',
      [
        { accountCode: '1001', debit: 750 },
        { accountCode: '4006', credit: 750 },
      ],
      { reference: 'RCP123', isTest: false },
    );

    const journalLink = mockQuery.mock.calls.find(([sql]) =>
      /UPDATE campaign_donations SET journal_entry_id/.test(sql),
    );
    expect(journalLink?.[1]).toEqual(['je-1', 'don-1']);

    const audit = mockQuery.mock.calls.find(([sql]) => /INSERT INTO audit_logs/.test(sql));
    expect(audit?.[1]?.[2]).toBe('campaign_donation.settle');
    expect(JSON.parse(audit?.[1]?.[5] as string)).toEqual({
      amount: '750.00',
      mpesa_receipt_number: 'RCP123',
      campaign_id: 'camp-1',
      channel: 'paybill',
    });

    expect(recordActivityInTx).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        type: ActivityEventType.CAMPAIGN_DONATION_RECEIVED,
        dedupKey: 'donation:RCP123',
        metadata: { campaign: 'School fees', channel: 'paybill' },
      }),
    );
  });

  it('skips the journal_entry_id link when postSystemJournal returns null', async () => {
    scenario({ journalId: null, raisedAfter: '750.00', target: '10000.00' });
    await creditCampaignDonation(client, baseInput);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE campaign_donations SET journal_entry_id/.test(sql))).toBe(
      false,
    );
  });

  it('emits CAMPAIGN_TARGET_REACHED only when this donation crosses the target', async () => {
    // Was 9,500; +750 → 10,250. Crossing happens here.
    scenario({ raisedAfter: '10250.00', target: '10000.00' });
    await creditCampaignDonation(client, { ...baseInput, amount: 750 });

    const types = (recordActivityInTx as jest.Mock).mock.calls.map((c) => c[1].type);
    expect(types).toEqual([ActivityEventType.CAMPAIGN_DONATION_RECEIVED, ActivityEventType.CAMPAIGN_TARGET_REACHED]);
    expect(recordActivityInTx).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        type: ActivityEventType.CAMPAIGN_TARGET_REACHED,
        dedupKey: 'campaign:camp-1:target-reached',
        metadata: { campaign: 'School fees', raised: 10250 },
      }),
    );
  });

  it('does not re-fire target-reached when the campaign was already over target', async () => {
    // Was already 10,500; +250 → 10,750. Prior raised was past target.
    scenario({ raisedAfter: '10750.00', target: '10000.00' });
    await creditCampaignDonation(client, { ...baseInput, amount: 250, receipt: 'RCP999' });

    const types = (recordActivityInTx as jest.Mock).mock.calls.map((c) => c[1].type);
    expect(types).toEqual([ActivityEventType.CAMPAIGN_DONATION_RECEIVED]);
  });

  it('does not fire target-reached while still under the goal', async () => {
    scenario({ raisedAfter: '8000.00', target: '10000.00' });
    await creditCampaignDonation(client, { ...baseInput, amount: 500, receipt: 'RCP500' });

    const types = (recordActivityInTx as jest.Mock).mock.calls.map((c) => c[1].type);
    expect(types).toEqual([ActivityEventType.CAMPAIGN_DONATION_RECEIVED]);
  });

  it('fires target-reached when the donation lands exactly on the target', async () => {
    scenario({ raisedAfter: '10000.00', target: '10000.00' });
    await creditCampaignDonation(client, { ...baseInput, amount: 1000, receipt: 'RCP-EQ' });

    const types = (recordActivityInTx as jest.Mock).mock.calls.map((c) => c[1].type);
    expect(types).toContain(ActivityEventType.CAMPAIGN_TARGET_REACHED);
  });
});
