export const dynamic = 'force-dynamic';
import type { Metadata } from 'next';
import { PageShell } from '@/components/marketing/page-shell';
import { OpportunityCard } from '@/components/ecosystem/opportunity-card';
import { withAdminDb } from '@/lib/db';
import { listPublishedOpportunities, toPublicOpportunity } from '@/lib/services/ecosystem.service';
import { marketingMetadata } from '@/components/marketing/page-metadata';

export const metadata: Metadata = marketingMetadata({
  path: '/ecosystem/marketplace',
  title: 'Marketplace — Ecosystem',
  description: 'Grants, loans, insurance, training and services matched to groups on Kitabu Yetu.',
});

async function MarketplacePage() {
  const opportunities = await withAdminDb((db) => listPublishedOpportunities(db));
  // Anonymous, public page — strip internal-only fields (eligibility_rules)
  // before they cross into the 'use client' OpportunityCard below.
  const published = opportunities.map(toPublicOpportunity);

  return (
    <PageShell
      title="Marketplace"
      description="Financial partners, suppliers and service providers offering products matched to a group's real record — grants, loans, insurance, training and services."
    >
      {published.length === 0 ? (
        <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-8 text-center text-sm font-medium text-brand-700">
          No opportunities published yet. Check back soon.
        </div>
      ) : (
        <div className="not-prose grid grid-cols-1 gap-6 md:grid-cols-2">
          {published.map((opportunity) => (
            <OpportunityCard key={opportunity.id} opportunity={opportunity} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

export default MarketplacePage;
