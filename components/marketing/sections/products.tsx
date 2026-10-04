import Image from 'next/image';
import Link from 'next/link';
import { Check, HandCoins, Layers, MessageSquareText, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PLAN_MONTHLY_FEES } from '@/types/enums';
import { PRODUCT_PILLARS } from '../content';
import { FactsBand, FinanzaHeading, FinanzaSection, btnPrimary, type Fact } from '../finanza';
import { ServiceTabs } from '../finanza-tabs';
import { PRODUCT_PHOTOS } from '../photos';

/* ────────────────────────────────────────────────────────────────────────────
 * Kitabu Yetu content set into the Finanza sections. Shared by the home,
 * about, products and team pages so each fact is stated in one place.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The template's counters show invented totals ("1234 Happy Clients"). The
 * about page commits to publishing verified usage numbers only once they
 * exist, so these are facts the product can already stand behind — and the
 * prices are read from the billing constants, not retyped.
 */
export const KITABU_FACTS: Fact[] = [
  { icon: Layers, value: PRODUCT_PILLARS.length, label: 'Tools, one login' },
  { icon: UsersRound, value: 6, label: 'Types of groups served' },
  {
    icon: HandCoins,
    value: PLAN_MONTHLY_FEES.kitabu_yetu.starter,
    prefix: 'KES ',
    label: 'Bookkeeper from, per month',
  },
  {
    icon: MessageSquareText,
    value: PLAN_MONTHLY_FEES.chama_reminder.starter,
    prefix: 'KES ',
    label: 'Chama Reminder from, per month',
  },
];

export function KitabuFacts() {
  return <FactsBand facts={KITABU_FACTS} />;
}

const PRODUCT_MEDIA = {
  Bookkeeper: { tagline: "Your group's books, balanced.", photo: PRODUCT_PHOTOS.bookkeeper },
  'Chama Reminder / Kumbusha': {
    tagline: 'Members reminded, automatically.',
    photo: PRODUCT_PHOTOS.chamaReminder,
  },
  'Fundraise / Changi$ha': {
    tagline: 'Fundraising people can trust.',
    photo: PRODUCT_PHOTOS.fundraise,
  },
  Enterprise: { tagline: 'Oversight without overreach.', photo: PRODUCT_PHOTOS.enterprise },
} as const;

/** Finanza's "Our Services" tabs, carrying the four real products. */
export function ProductTabsSection({ id, headingAs = 'h2' }: { id?: string; headingAs?: 'h1' | 'h2' }) {
  const tabs = PRODUCT_PILLARS.map((product) => {
    const media = PRODUCT_MEDIA[product.title as keyof typeof PRODUCT_MEDIA];
    return {
      value: product.title.toLowerCase().replace(/[^a-z]+/g, '-'),
      label: (
        <span className="flex items-center gap-3">
          <product.icon
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-brand-500 transition-colors group-data-[state=active]:text-white"
          />
          {product.title}
        </span>
      ),
      content: (
        <div className="grid gap-6 md:grid-cols-2">
          {media && (
            <div className="relative min-h-[260px] overflow-hidden rounded-lg md:min-h-[350px]">
              <Image
                src={media.photo.src}
                alt={media.photo.alt}
                fill
                sizes="(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 33vw"
                className="object-cover"
                style={{ objectPosition: media.photo.position }}
                placeholder="blur"
              />
            </div>
          )}
          <div>
            {product.status === 'vision' && (
              <span className="mb-3 inline-block rounded-full bg-finanza-orange-50 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-finanza-orange-600">
                Coming soon
              </span>
            )}
            <h3 className="mb-4 font-display text-2xl font-semibold text-finanza-dark lg:text-[1.75rem]">
              {media?.tagline ?? product.title}
            </h3>
            <p className="mb-5 leading-relaxed text-finanza-text">{product.body}</p>
            <ul className="space-y-3">
              {product.points.map((point) => (
                <li key={point} className="flex items-start gap-3 text-finanza-text">
                  <Check aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
                  {point}
                </li>
              ))}
            </ul>
            <Link href={product.href} className={cn(btnPrimary, 'mt-7')}>
              {product.linkText}
            </Link>
          </div>
        </div>
      ),
    };
  });

  return (
    <FinanzaSection id={id} labelledBy="products-heading">
      <FinanzaHeading
        id="products-heading"
        as={headingAs}
        align="center"
        pill="Our Products"
        title="Four tools. One login."
        className="mb-12"
      />
      <ServiceTabs tabs={tabs} label="Kitabu Yetu products" />
    </FinanzaSection>
  );
}
