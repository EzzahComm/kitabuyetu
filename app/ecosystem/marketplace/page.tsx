import type { Metadata } from 'next';
import { PageShell } from '@/components/marketing/page-shell';
import { OpportunityCard } from '@/components/ecosystem/opportunity-card';
import { withAdminDb } from '@/lib/db';
import { listPublishedOpportunities } from '@/lib/services/ecosystem.service';

export const metadata: Metadata = {
  title: 'Marketplace — Ecosystem',
  description: 'Grants, loans, insurance, training and services matched to groups on Kitabu Yetu.',
};

async function MarketplacePage() {
  const published = await withAdminDb((db) => listPublishedOpportunities(db));

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
