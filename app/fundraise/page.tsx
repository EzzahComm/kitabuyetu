import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { campaignsService, type Campaign } from '@/lib/services/campaigns.service';

const TITLE = 'Changi$ha — Fundraising';
const DESCRIPTION =
  'Support community fundraising campaigns on Kitabu Yetu — weddings, medical appeals, school fees, and community projects across Kenya.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.co.ke'}/fundraise`,
  },
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { title: TITLE, description: DESCRIPTION },
};

export const dynamic = 'force-dynamic';

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
      description="Community fundraising, in the same place your group already keeps its books."
    >
      {campaigns.length === 0 ? (
        <div className="not-prose rounded-lg border border-brand-100 bg-brand-50 px-4 py-6 text-center">
          <p className="font-semibold text-brand-700">No active campaigns right now.</p>
          <p className="mt-2 text-sm text-brand-blue-900/60">
            Check back soon, or{' '}
            <Link href="/contact" className="font-medium text-brand-700 hover:underline">
              talk to us
            </Link>{' '}
            about starting one for your group.
          </p>
        </div>
      ) : (
        <div className="not-prose grid gap-5 sm:grid-cols-2">
          {campaigns.map((c) => {
            const pct = Math.min(100, Math.round((parseFloat(c.amount_raised) / parseFloat(c.target_amount)) * 100));
            return (
              <Link
                key={c.slug}
                href={`/fundraise/${c.slug}`}
                className="group flex flex-col overflow-hidden rounded-lg border border-brand-blue-900/10 bg-white transition-colors hover:border-brand-500/40"
              >
                {c.cover_image_url && (
                  <div className="relative aspect-[16/9] w-full overflow-hidden bg-paper-deep">
                    <Image
                      src={c.cover_image_url}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="(min-width: 640px) 50vw, 100vw"
                    />
                  </div>
                )}
                <div className="flex flex-1 flex-col p-6">
                  <h2 className="font-display text-xl font-normal text-brand-blue-900">{c.title}</h2>
                  <p className="mt-2 line-clamp-2 text-[0.9375rem] leading-relaxed text-brand-blue-900/65">{c.story}</p>
                  <div className="mt-4">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-blue-900/[0.08]">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-2 text-xs font-medium text-brand-blue-900/60">
                      KES {parseFloat(c.amount_raised).toLocaleString()} raised of{' '}
                      {parseFloat(c.target_amount).toLocaleString()} target
                    </p>
                  </div>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                    Support this campaign
                    <ArrowRight
                      aria-hidden="true"
                      className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                    />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
