import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
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
      crumbs={[{ label: 'Changi$ha', href: '/fundraise' }]}
      description={campaign.beneficiary_name ? `Benefiting ${campaign.beneficiary_name}` : undefined}
    >
      {campaign.cover_image_url && (
        <div className="not-prose relative mb-8 aspect-[16/9] w-full overflow-hidden rounded-lg bg-brand-50">
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
        <div className="space-y-5 text-base leading-relaxed text-finanza-text">
          <p style={{ whiteSpace: 'pre-wrap' }}>{campaign.story}</p>
        </div>

        <div className="space-y-5 lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-lg border border-brand-100 bg-white p-6">
            <p className="font-display text-3xl font-bold text-finanza-dark">
              KES {parseFloat(campaign.amount_raised).toLocaleString()}
            </p>
            <p className="text-sm text-finanza-text">
              raised of KES {parseFloat(campaign.target_amount).toLocaleString()} target
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-brand-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-sm font-medium text-finanza-text">
              {pct}% funded · {donationCount} {donationCount === 1 ? 'supporter' : 'supporters'}
            </p>
          </div>

          <CampaignDonateForm slug={campaign.slug} />

          <ul className="space-y-2 rounded-lg bg-brand-50 p-5 text-sm text-finanza-text">
            {[
              'Reviewed by Kitabu Yetu before going live',
              'You give by M-Pesa and pay nothing extra',
              'Every donation is recorded against the campaign',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </PageShell>
  );
}
