export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/marketing/page-shell';
import { ProgramProgressCard } from '@/components/ecosystem/program-progress-card';
import { CampaignDonateForm } from '@/components/marketing/campaign-donate-form';
import { campaignsService, type Campaign } from '@/lib/services/campaigns.service';
import { marketingMetadata } from '@/components/marketing/page-metadata';

interface ProgramDetailPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Reads the live Changi$ha campaign behind this slug — see the listing page
 * for why the `programs` table this used to query is not the source.
 *
 * Donations go through the same CampaignDonateForm /fundraise/[slug] uses, so
 * there is one donation path rather than a second one to keep in step.
 */
export async function generateMetadata({ params }: ProgramDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await campaignsService.getPublicCampaignBySlug(slug);

  if (!campaign) return { title: 'Program not found' };

  return marketingMetadata({
    // Same campaign /fundraise/[slug] renders, so that URL is the canonical one.
    path: `/fundraise/${slug}`,
    title: `${campaign.title} — Support`,
    description: campaign.story?.slice(0, 160) || 'Support this program and make an impact.',
    image: campaign.cover_image_url,
  });
}

export default async function ProgramDetailPage({ params }: ProgramDetailPageProps) {
  const { slug } = await params;
  const campaign = await campaignsService.getPublicCampaignBySlug(slug);

  if (!campaign) notFound();

  return (
    <PageShell title={campaign.title} description={campaign.beneficiary_name ?? ''}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {campaign.story && (
            <div className="prose prose-sm max-w-none mb-8">
              <p className="whitespace-pre-line">{campaign.story}</p>
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="sticky top-4 space-y-6">
            <ProgramProgressCard program={toProgramProgress(campaign)} showCta={false} />
            <CampaignDonateForm slug={campaign.slug} />
          </div>
        </div>
      </div>
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
