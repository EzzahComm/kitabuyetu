/**
 * Campaign digest content building (lib/services/newsletter-digest.service.ts).
 * Covers the two properties worth pinning:
 *  1. campaignCardHtml never trusts campaign title/story as HTML — both come
 *     from the public, unauthenticated self-serve form (register_campaign
 *     RPC), and the rendered card goes into an email every newsletter
 *     subscriber receives.
 *  2. composeDigestContent degrades to a "nothing active" draft rather than
 *     an empty/broken one when there are no active campaigns.
 */
import type { Campaign } from '@/lib/services/campaigns.service';

jest.mock('@/lib/services/campaigns.service', () => ({
  campaignsService: { listActiveCampaigns: jest.fn() },
}));

import { campaignsService } from '@/lib/services/campaigns.service';
import { campaignCardHtml, escapeHtml, composeDigestContent } from '@/lib/services/newsletter-digest.service';

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'c-1',
    group_id: 'g-1',
    title: 'Medical Appeal',
    slug: 'medical-appeal',
    account_code: 'CH1A2B3C',
    story: 'A story about a cause.',
    beneficiary_name: null,
    target_amount: '50000.00',
    amount_raised: '12500.00',
    currency: 'KES',
    cover_image_url: null,
    status: 'active',
    rejection_reason: null,
    created_by: 'm-1',
    reviewed_by: null,
    reviewed_at: null,
    ends_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    payout_method: 'phone',
    payout_phone: '254700000001',
    payout_shortcode: null,
    payout_account: null,
    payout_payee_name: null,
    ...overrides,
  } as Campaign;
}

describe('escapeHtml', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<script>alert('x')</script> & "quoted"`)).toBe(
      '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quoted&quot;',
    );
  });
});

describe('campaignCardHtml', () => {
  it('escapes a malicious title/story instead of embedding it verbatim', () => {
    const html = campaignCardHtml(
      campaign({ title: '<img src=x onerror=alert(1)>', story: '<script>steal()</script>'.repeat(20) }),
    );
    expect(html).not.toMatch(/<img src=x/);
    expect(html).not.toMatch(/<script>/);
    expect(html).toMatch(/&lt;img/);
  });

  it('computes a 0-100 progress percentage and links to the public campaign page', () => {
    const html = campaignCardHtml(campaign({ amount_raised: '25000.00', target_amount: '50000.00', slug: 'my-cause' }));
    expect(html).toMatch(/width:50%/);
    expect(html).toMatch(/\(50%\)/);
    expect(html).toMatch(/\/fundraise\/my-cause/);
  });

  it('never exceeds 100% even if amount_raised overshoots the target', () => {
    const html = campaignCardHtml(campaign({ amount_raised: '80000.00', target_amount: '50000.00' }));
    expect(html).toMatch(/width:100%/);
  });

  it('truncates a long story to a snippet', () => {
    const longStory = 'x'.repeat(500);
    const html = campaignCardHtml(campaign({ story: longStory }));
    expect(html).toMatch(/x{220}…/);
    expect(html).not.toMatch(/x{221}/);
  });
});

describe('composeDigestContent', () => {
  it('falls back to a "nothing active" draft when there are no active campaigns', async () => {
    (campaignsService.listActiveCampaigns as jest.Mock).mockResolvedValue([]);
    const result = await composeDigestContent();
    expect(result.campaignIds).toEqual([]);
    expect(result.htmlBody).toMatch(/no active campaigns/i);
  });

  it('builds one card per active campaign and lists all their ids', async () => {
    const campaigns = [
      campaign({ id: 'c-1' }),
      campaign({ id: 'c-2', title: 'School Fees Appeal', slug: 'school-fees' }),
    ];
    (campaignsService.listActiveCampaigns as jest.Mock).mockResolvedValue(campaigns);
    const result = await composeDigestContent();
    expect(result.campaignIds).toEqual(['c-1', 'c-2']);
    expect(result.htmlBody).toMatch(/Medical Appeal/);
    expect(result.htmlBody).toMatch(/School Fees Appeal/);
    expect(result.subject).toMatch(/2 causes/);
  });
});
