import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { CampaignDonateForm } from '@/components/marketing/campaign-donate-form';
import { campaignsService, isAcceptingDonations } from '@/lib/services/campaigns.service';
import { getPublicCampaignStatement, type PublicCampaignStatement } from '@/lib/services/campaign-statement.service';
import { CampaignStatement } from '@/components/marketing/campaign-statement';
import { fallbackPhoto } from '@/components/marketing/photos';
import { ROUTES } from '@/components/marketing/routes';
import Link from 'next/link';
import { marketingMetadata } from '@/components/marketing/page-metadata';

export const dynamic = 'force-dynamic';

const PAYBILL = process.env.NEXT_PUBLIC_MPESA_PAYBILL ?? '';

interface CampaignPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CampaignPageProps): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await campaignsService.getPublicCampaignForDisplay(slug);
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
  // Display read: live or finished. Donations are still gated separately by getPublicCampaignBySlug in the donate route.
  const campaign = await campaignsService.getPublicCampaignForDisplay(slug);
  if (!campaign) notFound();
  const accepting = isAcceptingDonations(campaign);
  const photo = fallbackPhoto(campaign.slug);

  const donationCount = await campaignsService.getPublicDonationCount(campaign.id);
  // The statement is supplementary: if it fails to load, the campaign page still renders.
  let statement: PublicCampaignStatement | null = null;
  try {
    statement = await getPublicCampaignStatement(campaign.id);
  } catch {
    statement = null;
  }
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
      <div className="not-prose relative mb-8 aspect-16/9 w-full overflow-hidden rounded-lg bg-brand-50">
        {campaign.cover_image_url ? (
          <Image
            src={campaign.cover_image_url}
            alt={campaign.title}
            fill
            className="object-cover"
            sizes="(min-width: 768px) 768px, 100vw"
            priority
          />
        ) : (
          // Illustrative stand-in until the campaign has its own photo; not the beneficiary.
          <Image
            src={photo.src}
            alt=""
            fill
            className="object-cover"
            style={{ objectPosition: photo.position }}
            sizes="(min-width: 768px) 768px, 100vw"
            placeholder="blur"
            priority
          />
        )}
        {!accepting && (
          <span className="absolute left-4 top-4 rounded-full bg-finanza-dark px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
            {pct >= 100 ? 'Funded' : 'Ended'}
          </span>
        )}
      </div>

      <div className="not-prose grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5 text-base leading-relaxed text-finanza-text">
          <p style={{ whiteSpace: 'pre-wrap' }}>{campaign.story}</p>
          {statement && <CampaignStatement statement={statement} />}
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

          {accepting ? (
            <>
              <CampaignDonateForm slug={campaign.slug} />
              {PAYBILL && (
                <div className="mt-4 rounded-lg border border-brand-100 bg-white p-5 text-sm text-finanza-text">
                  <p className="font-medium text-finanza-dark">Prefer to pay by M-Pesa PayBill?</p>
                  <p className="mt-1">
                    Go to Lipa na M-Pesa → Pay Bill. Business no.{' '}
                    <strong className="text-finanza-dark">{PAYBILL}</strong>, account no.{' '}
                    <strong className="text-finanza-dark">{campaign.account_code}</strong>.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-brand-100 bg-white p-6">
              <p className="font-display text-xl font-semibold text-finanza-dark">This campaign has ended</p>
              <p className="mt-2 text-finanza-text">
                It is no longer taking donations. Thank you to everyone who gave.
              </p>
              <Link href={ROUTES.fundraise} className="mt-4 inline-block font-medium text-brand-500 hover:underline">
                See live campaigns
              </Link>
            </div>
          )}

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
