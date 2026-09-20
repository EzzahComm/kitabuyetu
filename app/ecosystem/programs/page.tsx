export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { ProgramProgressCard } from '@/components/ecosystem/program-progress-card';
import { campaignsService, type Campaign } from '@/lib/services/campaigns.service';

export const metadata: Metadata = {
  title: 'Programs — Ecosystem',
  description: 'Browse active programs and support causes that matter to you.',
};

/**
 * Reads live Changi$ha campaigns, not the `programs` table this page used to
 * query. That table has never held a row: its only writer posted to
 * /api/v1/programs, which does not exist. The organization-side
 * `funding_programs` table is not an alternative here — it holds internal
 * financial-product configuration (budgets, interest rates, loss bearer) and
 * its RLS correctly admits only super admins and the owning organization, so
 * an anonymous visitor reads nothing from it and should not.
 *
 * campaignsService.listActiveCampaigns() is the same path /fundraise uses:
 * withAdminDb with an explicit `status = 'active'` filter, no anon grant.
 */
export default async function EcosystemProgramsPage() {
  let campaigns: Campaign[] = [];
  try {
    campaigns = await campaignsService.listActiveCampaigns();
  } catch {
    // The database may be unreachable at build time in CI — fall through to
    // the empty state rather than failing the prerender.
  }

  return (
    <PageShell title="Support Programs" description="Browse active programs and support causes that matter to you.">
      {campaigns.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-600 mb-4">No active programs yet.</p>
          <p className="text-sm text-gray-500">Check back soon for new opportunities to make an impact.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.map((campaign) => (
            <Link key={campaign.id} href={`/ecosystem/programs/${campaign.slug}`}>
              <div className="cursor-pointer">
                <ProgramProgressCard program={toProgramProgress(campaign)} showCta />
              </div>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}

/** Campaign money columns are numeric-as-string over the wire; the card wants numbers. */
function toProgramProgress(campaign: Campaign) {
  return {
    id: campaign.id,
    name: campaign.title,
    status: campaign.status,
    target_amount: Number(campaign.target_amount),
    current_amount: Number(campaign.amount_raised),
  };
}
