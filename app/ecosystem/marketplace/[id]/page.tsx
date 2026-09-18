import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/marketing/page-shell';
import { OpportunityApplicationForm } from '@/components/ecosystem/opportunity-application-form';
import { withAdminDb } from '@/lib/db';
import { getOpportunityById, getPartnerById } from '@/lib/services/ecosystem.service';

interface OpportunityDetailPageProps {
  params: Promise<{ id: string }>;
}

const TYPE_LABELS: Record<string, string> = {
  grant: 'Grant',
  loan: 'Loan',
  insurance: 'Insurance',
  training: 'Training',
  service: 'Service',
};

async function getPublishedOpportunity(id: string) {
  const opportunity = await withAdminDb((db) => getOpportunityById(db, id));
  return opportunity && opportunity.status === 'published' ? opportunity : null;
}

export async function generateMetadata({ params }: OpportunityDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const opportunity = await getPublishedOpportunity(id);

  if (!opportunity) return { title: 'Opportunity not found' };

  return {
    title: `${opportunity.title} — Marketplace`,
    description: opportunity.description,
  };
}

async function OpportunityDetailPage({ params }: OpportunityDetailPageProps) {
  const { id } = await params;
  const opportunity = await getPublishedOpportunity(id);

  if (!opportunity) notFound();

  const partner = await getPartnerById(opportunity.partner_id);

  const amountDisplay =
    opportunity.amount_min && opportunity.amount_max
      ? `${opportunity.currency} ${opportunity.amount_min.toLocaleString()} – ${opportunity.amount_max.toLocaleString()}`
      : opportunity.amount_min
        ? `From ${opportunity.currency} ${opportunity.amount_min.toLocaleString()}`
        : 'Variable amount';

  return (
    <PageShell
      title={opportunity.title}
      description={`${TYPE_LABELS[opportunity.opportunity_type] || opportunity.opportunity_type}${partner ? ` · Offered by ${partner.name}` : ''}`}
    >
      <div className="not-prose grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="prose prose-sm max-w-none text-brand-blue-900/75">
            <p>{opportunity.description}</p>
          </div>

          {opportunity.terms_summary && (
            <div>
              <h2 className="font-display text-xl font-normal text-brand-blue-900">Terms</h2>
              <p className="mt-2 text-sm text-brand-blue-900/70">{opportunity.terms_summary}</p>
            </div>
          )}

          {partner && (
            <div className="rounded-lg border border-brand-blue-900/10 p-6">
              <h2 className="font-display text-xl font-normal text-brand-blue-900">About {partner.name}</h2>
              {partner.description && (
                <p className="mt-2 text-sm text-brand-blue-900/70">{partner.description}</p>
              )}
              {partner.website_url && (
                <a
                  href={partner.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline"
                >
                  Visit website →
                </a>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="sticky top-4 space-y-4 rounded-lg border border-brand-blue-900/10 p-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-blue-900/50">Amount</p>
              <p className="mt-1 text-lg font-semibold text-brand-blue-900">{amountDisplay}</p>
            </div>

            {opportunity.application_url ? (
              <a
                href={opportunity.application_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-md bg-brand-700 px-5 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-800"
              >
                Apply on partner site
              </a>
            ) : (
              <div>
                <p className="mb-3 text-sm text-brand-blue-900/60">
                  Applying requires a group official to be logged in.
                </p>
                <OpportunityApplicationForm opportunityId={opportunity.id} />
              </div>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

export default OpportunityDetailPage;
