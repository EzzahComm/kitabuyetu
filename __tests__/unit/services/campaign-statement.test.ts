jest.mock('@/lib/db', () => ({ withAdminDb: jest.fn() }));

import { withAdminDb } from '@/lib/db';
import { getPublicCampaignStatement } from '@/lib/services/campaign-statement.service';

const mockQuery = jest.fn();

beforeEach(() => {
  mockQuery.mockReset();
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn({ query: mockQuery }));
});

/** Queries run in a fixed order: totals, supporters, releases, pending. */
function stub({ totals, supporters, releases, pending }: Record<string, unknown[]>) {
  mockQuery
    .mockResolvedValueOnce({ rows: totals })
    .mockResolvedValueOnce({ rows: supporters })
    .mockResolvedValueOnce({ rows: releases })
    .mockResolvedValueOnce({ rows: pending });
}

describe('getPublicCampaignStatement', () => {
  it('never selects phone numbers, receipts or payout account details', async () => {
    stub({ totals: [{ count: '0', total: '0' }], supporters: [], releases: [], pending: [{ total: '0' }] });
    await getPublicCampaignStatement('camp-1');
    const sql = mockQuery.mock.calls.map(([q]) => String(q)).join('\n');
    for (const column of [
      'donor_phone',
      'mpesa_receipt_number',
      'payout_phone',
      'payout_shortcode',
      'payout_account',
    ]) {
      expect(sql).not.toContain(column);
    }
    expect(sql).not.toMatch(/SELECT\s+\*/);
  });

  it('hides the names of anonymous donors and computes the held balance', async () => {
    stub({
      totals: [{ count: '3', total: '10000.00' }],
      supporters: [
        {
          donor_name: 'Amina',
          is_anonymous: false,
          amount: '5000.00',
          message: ' Pole sana ',
          created_at: '2026-09-02',
        },
        { donor_name: 'Secret Giver', is_anonymous: true, amount: '3000.00', message: null, created_at: '2026-09-01' },
        { donor_name: '  ', is_anonymous: false, amount: '2000.00', message: null, created_at: '2026-08-31' },
      ],
      releases: [
        {
          completed_at: '2026-09-05',
          gross_amount: '4000.00',
          platform_fee_amount: '160.00',
          mpesa_charge_amount: '33.00',
          net_amount: '3807.00',
          payout_method: 'paybill',
          payout_payee_name: 'Kakamega County Hospital',
        },
        {
          completed_at: '2026-09-06',
          gross_amount: '1000.00',
          platform_fee_amount: '40.00',
          mpesa_charge_amount: '11.00',
          net_amount: '949.00',
          payout_method: 'phone',
          payout_payee_name: 'should never show',
        },
      ],
      pending: [{ total: '1500.00' }],
    });

    const statement = await getPublicCampaignStatement('camp-1');

    expect(statement.supporters.map((s) => s.name)).toEqual(['Amina', null, null]);
    expect(statement.supporters[0].message).toBe('Pole sana');
    expect(statement.releases.map((r) => r.payeeName)).toEqual(['Kakamega County Hospital', null]);
    expect(statement).toMatchObject({
      donationCount: 3,
      totalDonated: 10000,
      totalReleased: 5000,
      pendingRelease: 1500,
      heldBalance: 3500,
    });
  });

  it('only counts completed donations and completed releases', async () => {
    stub({ totals: [{ count: '0', total: '0' }], supporters: [], releases: [], pending: [{ total: '0' }] });
    await getPublicCampaignStatement('camp-1');
    const [totalsSql, supportersSql, releasesSql] = mockQuery.mock.calls.map(([q]) => String(q));
    expect(totalsSql).toContain("status = 'completed'");
    expect(supportersSql).toContain("status = 'completed'");
    expect(releasesSql).toContain("status = 'completed'");
  });
});
