import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { FinanzaHeading, FinanzaSection } from '@/components/marketing/finanza';
import { CtaBand } from '@/components/marketing/kitabu-sections';
import { ROUTES } from '@/components/marketing/routes';
import { CHANGISHA_PRICING } from '@/types/enums';
import { campaignsService, type Campaign } from '@/lib/services/campaigns.service';
import { marketingMetadata } from '@/components/marketing/page-metadata';

export const metadata: Metadata = marketingMetadata({
  path: '/fundraise',
  title: 'Support Harambees & Community Causes in Kenya',
  description:
    'Give by M-Pesa to harambees and community campaigns reviewed by Kitabu Yetu: medical appeals, school fees, weddings and local projects across Kenya.',
});

export const dynamic = 'force-dynamic';

/** Mirrors the real lifecycle in campaigns.service: draft → review → active → withdraw. */
const STEPS = [
  {
    title: 'Create it',
    body: "From your group's account, write the story, set a target and the M-Pesa number that will receive the funds.",
  },
  {
    title: 'We review it',
    body: 'Kitabu Yetu checks every campaign before it goes public, so donors know it is genuine.',
  },
  {
    title: 'Share and withdraw',
    body: 'Share the link. Donations arrive by M-Pesa and show on the page; withdraw to M-Pesa as funds come in.',
  },
];

/**
 * Real listing of live Changi$ha campaigns (migration 182) — was a static
 * "coming soon" page until the product actually existed. Reads via
 * campaignsService.listActiveCampaigns(), which goes through withAdminDb with
 * an explicit `status = 'active'` filter rather than any anon/PostgREST
 * grant — see that migration's header for why.
 *
 * Marked dynamic to avoid prerender failures when DB is unavailable at build time.
 */
export default async function FundraisePage() {
  let campaigns: Campaign[] = [];
  try {
    campaigns = await campaignsService.listActiveCampaigns();
  } catch (err) {
    // During build time in CI, the database may not be accessible. Gracefully
    // fall back to an empty list — the page will render the "no campaigns" state.
    // At runtime in production, the database will be available.
  }

  return (
    <PageShell
      title="Changi$ha"
      description="Raise money for a cause, a project or a member in need — by M-Pesa, in the open, with every shilling recorded."
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
            {campaigns.map((c) => {
              const pct = Math.min(100, Math.round((parseFloat(c.amount_raised) / parseFloat(c.target_amount)) * 100));
              return (
                <li key={c.slug}>
                  <Link
                    href={`/fundraise/${c.slug}`}
                    className="group flex h-full flex-col overflow-hidden rounded-lg border border-brand-100 bg-white transition-colors duration-300 hover:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    {c.cover_image_url && (
                      <div className="relative aspect-[16/9] w-full overflow-hidden bg-brand-50">
                        {/* alt="" — the card link already carries the title. */}
                        <Image
                          src={c.cover_image_url}
                          alt=""
                          fill
                          className="object-cover transition-transform duration-500 group-hover:scale-105"
                          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        />
                      </div>
                    )}
                    <div className="flex flex-1 flex-col p-6">
                      <h3 className="font-display text-xl font-semibold text-finanza-dark">{c.title}</h3>
                      <p className="mt-2 line-clamp-2 leading-relaxed text-finanza-text">{c.story}</p>
                      <div className="mt-auto pt-5">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-brand-100">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-2 text-sm text-finanza-text">
                          <strong className="font-semibold text-finanza-dark">
                            KES {parseFloat(c.amount_raised).toLocaleString()}
                          </strong>{' '}
                          raised of KES {parseFloat(c.target_amount).toLocaleString()}
                        </p>
                        <span className="mt-4 inline-flex items-center gap-1.5 font-medium text-brand-500">
                          Support this campaign
                          <ArrowRight
                            aria-hidden="true"
                            className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                          />
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </FinanzaSection>

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
        title="Raising money for your group?"
        subtitle={`No monthly fee. A standard ${CHANGISHA_PRICING.platformFeePct}% platform fee plus the M-Pesa charge, only when you withdraw.`}
        footnote="Donors pay nothing extra · Every campaign reviewed before it goes live"
        showPlanPrices={false}
        primary={{ label: 'See Pricing', href: `${ROUTES.pricing}#changisha` }}
      />
    </PageShell>
  );
}
