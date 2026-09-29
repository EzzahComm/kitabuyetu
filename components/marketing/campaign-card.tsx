import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Campaign } from '@/lib/services/campaigns.service';
import { fallbackPhoto } from './photos';

/** Only the public fields a card needs — never pass payout_phone or review fields to a render. */
export type CampaignSummary = Pick<
  Campaign,
  'slug' | 'title' | 'story' | 'cover_image_url' | 'amount_raised' | 'target_amount' | 'beneficiary_name'
>;

export function campaignProgress(campaign: Pick<Campaign, 'amount_raised' | 'target_amount'>): number {
  const target = parseFloat(campaign.target_amount);
  if (!(target > 0)) return 0;
  return Math.min(100, Math.round((parseFloat(campaign.amount_raised) / target) * 100));
}

const kes = (value: string) => `KES ${Math.round(parseFloat(value)).toLocaleString()}`;

/** A Changi$ha campaign card for /fundraise and the home page. `ended` switches the badge and call to action. */
export function CampaignCard({ campaign, ended = false }: { campaign: CampaignSummary; ended?: boolean }) {
  const pct = campaignProgress(campaign);
  const photo = fallbackPhoto(campaign.slug);

  return (
    <Link
      href={`/fundraise/${campaign.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-brand-100 bg-white transition-colors duration-300 hover:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-brand-50">
        {/* alt="" — the card link already carries the title. Campaigns without a cover get a registry photo. */}
        {campaign.cover_image_url ? (
          <Image
            src={campaign.cover_image_url}
            alt=""
            fill
            className={cn(
              'object-cover transition-transform duration-500 group-hover:scale-105',
              ended && 'grayscale-[40%]',
            )}
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          />
        ) : (
          <Image
            src={photo.src}
            alt=""
            fill
            className={cn(
              'object-cover transition-transform duration-500 group-hover:scale-105',
              ended && 'grayscale-[40%]',
            )}
            style={{ objectPosition: photo.position }}
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            placeholder="blur"
          />
        )}
        <span
          className={cn(
            'absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide',
            ended ? 'bg-finanza-dark text-white' : 'bg-brand-500 text-white',
          )}
        >
          {ended ? (pct >= 100 ? 'Funded' : 'Ended') : 'Live'}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-6">
        <h3 className="font-display text-xl font-semibold leading-snug text-finanza-dark">{campaign.title}</h3>
        {campaign.beneficiary_name && <p className="mt-1 text-sm text-finanza-text">For {campaign.beneficiary_name}</p>}
        <p className="mt-2 line-clamp-2 leading-relaxed text-finanza-text">{campaign.story}</p>
        <div className="mt-auto pt-5">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-brand-100"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${pct}% of target raised`}
          >
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 flex justify-between gap-2 text-sm text-finanza-text">
            <span>
              <strong className="font-semibold text-finanza-dark">{kes(campaign.amount_raised)}</strong> of{' '}
              {kes(campaign.target_amount)}
            </span>
            <span className="font-medium">{pct}%</span>
          </p>
          <span className="mt-4 inline-flex items-center gap-1.5 font-medium text-brand-500">
            {ended ? 'See the result' : 'Support this campaign'}
            <ArrowRight
              aria-hidden="true"
              className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </span>
        </div>
      </div>
    </Link>
  );
}
