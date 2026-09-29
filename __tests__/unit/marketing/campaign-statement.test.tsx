import { renderToStaticMarkup } from 'react-dom/server';
import { CampaignStatement } from '@/components/marketing/campaign-statement';
import type { PublicCampaignStatement } from '@/lib/services/campaign-statement.service';

const statement: PublicCampaignStatement = {
  donationCount: 2,
  totalDonated: 8000,
  totalReleased: 4000,
  pendingRelease: 1000,
  heldBalance: 3000,
  supporters: [
    { name: 'Amina', amount: 5000, message: 'Pole sana', givenAt: '2026-09-02T10:00:00Z' },
    { name: null, amount: 3000, message: null, givenAt: '2026-09-01T10:00:00Z' },
  ],
  releases: [
    {
      releasedAt: '2026-09-05T10:00:00Z',
      grossAmount: 3000,
      platformFee: 120,
      mpesaCharge: 33,
      netAmount: 2847,
      method: 'paybill',
      payeeName: 'Kakamega County Hospital',
    },
    {
      releasedAt: '2026-09-06T10:00:00Z',
      grossAmount: 1000,
      platformFee: 40,
      mpesaCharge: 11,
      netAmount: 949,
      method: 'phone',
      payeeName: null,
    },
  ],
};

describe('CampaignStatement', () => {
  const html = renderToStaticMarkup(<CampaignStatement statement={statement} />);

  it('shows the totals, releases and supporters', () => {
    expect(html).toContain('Campaign statement');
    expect(html).toContain('KES 8,000');
    expect(html).toContain('Kakamega County Hospital (paybill)');
    expect(html).toContain('M-Pesa number');
    expect(html).toContain('Amina');
    expect(html).toContain('Anonymous supporter');
  });

  it('renders empty states without data', () => {
    const empty = renderToStaticMarkup(
      <CampaignStatement statement={{ ...statement, supporters: [], releases: [], donationCount: 0 }} />,
    );
    expect(empty).toContain('No funds have been released yet.');
    expect(empty).toContain('Be the first to support this campaign.');
  });
});
