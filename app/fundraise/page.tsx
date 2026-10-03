import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { FinanzaHeading, FinanzaSection } from '@/components/marketing/finanza';
import { CtaBand } from '@/components/marketing/kitabu-sections';
import { ROUTES } from '@/components/marketing/routes';
import { CHANGISHA_PRICING } from '@/types/enums';
import { campaignsService, type Campaign } from '@/lib/services/campaigns.service';
import { CampaignCard } from '@/components/marketing/campaign-card';
import { marketingMetadata } from '@/components/marketing/page-metadata';

export const metadata: Metadata = marketingMetadata({
  path: '/fundraise',
  title: 'Support Harambees & Community Causes in Kenya',
  description:
    'Give by M-Pesa to harambees and community campaigns reviewed by Kitabu Yetu: medical appeals, school fees, weddings and local projects across Kenya.',
});

export const dynamic = 'force-dynamic';

/**
 * Mirrors the real money flow: donations are STK-pushed to the platform
 * paybill (daraja.service SHORTCODE) and held on the group's 4006 Changi$ha
 * account; withdrawals go to the campaign's payout destination (phone, paybill
 * or till - lib/campaigns/payout-destination.ts) after maker-checker approval
 * by two group officials and then Kitabu Yetu's own sign-off
 * (campaign-withdrawals.service, migration 203).
 */
const STEPS = [
  {
    title: 'Create it',
    body: 'Tell the story, set a target and choose where funds go: an M-Pesa number, PayBill or till.',
  },
  {
    title: 'We check it',
    body: 'Every campaign is checked before it goes public, so donors know it's genuine.',
  },
  {
    title: 'Share and release',
    body: 'Donations show on the page as they arrive. Funds are released after two officials and Kitabu Yetu approve.',
  },
];

/**
 * Real listing of live and past Changi$ha campaigns (migration 182) - was a static
 * "coming soon" page until the product actually existed. Reads via
 * campaignsService.listActiveCampaigns(), which goes through withAdminDb with
 * an explicit `status = 'active'` filter rather than any anon/PostgREST
 * grant - see that migration's header for why.
 *
 * Marked dynamic to avoid prerender failures when DB is unavailable at build time.
 */
export default async function FundraisePage() {
  let campaigns: Campaign[] = [];
  let past: Campaign[] = [];
  try {
    [campaigns, past] = await Promise.all([
      campaignsService.listActiveCampaigns(),
      campaignsService.listPastCampaigns(6),
    ]);
  } catch {
    // During build time in CI, the database may not be accessible. Gracefully
    // fall back to an empty list - the page will render the "no campaigns" state.
    // At runtime in production, the database will be available.
  }

  return (
    <PageShell
      title="Changi$ha"
      description="Raise it together. Track every shilling. By M-Pesa, in the open."
      layout="sections"
    >
      <FinanzaSection labelledBy="campaigns-heading" className="pt-4 lg:pt-8">
        <FinanzaHeading id="campaigns-heading" pill="Live Campaigns" title="Give to a campaign" className="mb-10" />
        {campaigns.length === 0 ? (
          <div className="rounded-lg border border-brand-100 bg-brand-50 px-6 py-10 text-center">
            <p className="font-display text-xl font-semibold text-finanza-dark">No active campaigns right now.</p>
            <p className="mt-2 text-finanza-text">
              Check back soon, or{' '}
              <Link href={ROUTES.contact} className="font-medium text-brand-500 hover:underline">
                talk to us
              </Link>{' '}
              about starting one for your group.
            </p>
          </div>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((c) => (
              <li key={c.slug}>
                <CampaignCard campaign={c} />
              </li>
            ))}
          </ul>
        )}
      </FinanzaSection>

      {past.length > 0 && (
        <FinanzaSection labelledBy="past-heading" className="pt-0 lg:pt-0">
          <FinanzaHeading
            id="past-heading"
            pill="Past Fundraisers"
            title="What communities have raised"
            lede="Finished campaigns stay on record - every shilling."
            className="mb-10 max-w-3xl"
          />
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {past.map((c) => (
              <li key={c.slug}>
                <CampaignCard campaign={c} ended />
              </li>
            ))}
          </ul>
        </FinanzaSection>
      )}

      <FinanzaSection labelledBy="how-changisha-heading" className="bg-brand-50/60">
        <FinanzaHeading
          id="how-changisha-heading"
          align="center"
          pill="How It Works"
          title="Start a campaign in three steps"
          className="mb-12"
        />
        <ol className="grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-lg border border-brand-100 bg-white p-7">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-500 font-display text-xl font-bold text-white">
                {i + 1}
              </span>
              <h3 className="mt-5 font-display text-xl font-semibold text-finanza-dark">{step.title}</h3>
              <p className="mt-2 leading-relaxed text-finanza-text">{step.body}</p>
            </li>
          ))}
        </ol>
      </FinanzaSection>

      <CtaBand
        title="Raising money for a cause?"
        subtitle={`No monthly fee. ${CHANGISHA_PRICING.platformFeePct}% plus the M-Pesa charge - only when you withdraw.`}
        footnote="Donors pay nothing extra - Every campaign checked before it goes live"
        showPlanPrices={false}
        primary={{ label: 'Start a campaign', href: '/start-campaign' }}
      />
      <p className="pb-12 text-center text-sm text-finanza-text">
        Already running a group?{' '}
        <Link href={ROUTES.pricing + '#changisha'} className="font-medium text-brand-500 hover:underline">
          See pricing
        </Link>{' '}
        or sign in to create a campaign from your dashboard.
      </p>
    </PageShell>
  );
}
