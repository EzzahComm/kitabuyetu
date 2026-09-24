import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/marketing/page-shell';
import { CampaignDonateForm } from '@/components/marketing/campaign-donate-form';
import { campaignsService } from '@/lib/services/campaigns.service';
import { marketingMetadata } from '@/components/marketing/page-metadata';

export const dynamic = 'force-dynamic';

interface CampaignPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CampaignPageProps): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await campaignsService.getPublicCampaignBySlug(slug);
  if (!campaign) return { title: 'Changi$ha' };
  return marketingMetadata({
    path: `/fundraise/${slug}`,
    title: `${campaign.title} — Changi$ha`,
    description: campaign.story.slice(0, 160),
    image: campaign.cover_image_url,
  });
}

export default async function CampaignPage({ params }: CampaignPageProps) {
  const { slug } = await params;
  const campaign = await campaignsService.getPublicCampaignBySlug(slug);
  if (!campaign) notFound();

  const donationCount = await campaignsService.getPublicDonationCount(campaign.id);
  const pct = Math.min(
    100,
    Math.round((parseFloat(campaign.amount_raised) / parseFloat(campaign.target_amount)) * 100),
  );

  return (
    <PageShell
      title={campaign.title}
      description={campaign.beneficiary_name ? `Benefiting ${campaign.beneficiary_name}` : undefined}
    >
      {campaign.cover_image_url && (
        <div className="not-prose relative mb-8 aspect-[16/9] w-full overflow-hidden rounded-lg bg-paper-deep">
          <Image
            src={campaign.cover_image_url}
            alt={campaign.title}
            fill
            className="object-cover"
            sizes="(min-width: 768px) 768px, 100vw"
            priority
          />
        </div>
      )}

      <div className="not-prose grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5 text-base leading-relaxed text-brand-blue-900/75">
          <p style={{ whiteSpace: 'pre-wrap' }}>{campaign.story}</p>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-brand-blue-900/10 bg-white p-6">
            <p className="font-display text-2xl font-normal text-brand-blue-900">
              KES {parseFloat(campaign.amount_raised).toLocaleString()}
            </p>
            <p className="text-sm text-brand-blue-900/60">
              raised of KES {parseFloat(campaign.target_amount).toLocaleString()} target
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-brand-blue-900/[0.08]">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xs font-medium text-brand-blue-900/50">
              {pct}% funded · {donationCount} {donationCount === 1 ? 'supporter' : 'supporters'}
            </p>
          </div>

          <CampaignDonateForm slug={campaign.slug} />
        </div>
      </div>
    </PageShell>
  );
}
