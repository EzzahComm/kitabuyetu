import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { signUpUrl } from '@/lib/app-links';
import { CUSTOMER_PATHS, MEMBER_BENEFITS } from '../content';
import { FinanzaHeading, FinanzaSection, IconBadge, btnOutline, btnPrimary } from '../finanza';
import { PHOTOS, type Photo } from '../photos';
import { Reveal } from '../reveal';

/**
 * The self-selection fork: a group runs its own book, an organization
 * oversees many. Both destinations are real public pages (see CUSTOMER_PATHS).
 */
export function CustomerPathsSection({ id }: { id?: string }) {
  return (
    <FinanzaSection id={id} labelledBy="paths-heading" className="bg-brand-50/60">
      <FinanzaHeading
        id="paths-heading"
        align="center"
        pill="Who It's For"
        title="Pick your path."
        lede="One group or a hundred — there's a plan built for you."
        className="mb-12"
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {CUSTOMER_PATHS.map((path, i) => (
          <Reveal
            key={path.eyebrow}
            delay={i * 150}
            className="flex flex-col rounded-lg border border-brand-100 bg-white p-8 transition-colors duration-500 hover:border-brand-500"
          >
            <div className="mb-6 flex items-center gap-4">
              <IconBadge icon={path.icon} />
              <p className="font-medium uppercase tracking-wide text-brand-500">{path.eyebrow}</p>
            </div>
            <h3 className="font-display text-2xl font-semibold leading-snug text-finanza-dark lg:text-[1.75rem]">
              {path.title}
            </h3>
            <p className="mt-4 leading-relaxed text-finanza-text">{path.body}</p>
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Built for">
              {path.audience.map((audience) => (
                <li
                  key={audience}
                  className="rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-sm font-medium text-finanza-dark"
                >
                  {audience}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex-1" />
            <Link href={path.href} className={cn(i === 0 ? btnPrimary : btnOutline, 'self-start')}>
              {path.linkText} <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </Reveal>
        ))}
      </div>
    </FinanzaSection>
  );
}

/** What a member sees in their own portal (app/(member)/me) — see MEMBER_BENEFITS. */
export function MemberBenefitsSection() {
  return (
    <FinanzaSection labelledBy="members-heading">
      <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="lg:sticky lg:top-32">
          <FinanzaHeading
            id="members-heading"
            pill="For Every Member"
            title="No more “nisaidie na balance yangu.”"
            lede="Members check their own savings, loans and statements. Fewer questions at meetings. Treasurers get their evenings back."
          />
          <a href={signUpUrl()} className={cn(btnPrimary, 'mt-8')}>
            Give your members access
          </a>
        </div>
        <ul className="grid gap-6 sm:grid-cols-2">
          {MEMBER_BENEFITS.map((benefit, i) => (
            <Reveal
              as="li"
              key={benefit.title}
              delay={(i % 2) * 120}
              className="rounded-lg border border-brand-100 p-6"
            >
              <benefit.icon aria-hidden="true" className="mb-4 h-9 w-9 text-brand-500" />
              <h3 className="font-display text-xl font-semibold text-finanza-dark">{benefit.title}</h3>
              <p className="mt-2 leading-relaxed text-finanza-text">{benefit.body}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </FinanzaSection>
  );
}

interface CommunityCard {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  photo: Photo;
}

/**
 * Every point is a shipped behaviour already stated elsewhere on the site
 * (support FAQ, MEMBER_BENEFITS, CONTROLS). VSLAs and youth groups register as
 * an ordinary group type — there is no special mode for either, so none is claimed.
 */
const COMMUNITIES: CommunityCard[] = [
  {
    eyebrow: "Women's savings groups & VSLAs",
    title: 'The savings, the loans and the social fund — in one ledger.',
    body: 'Meet the way you always have. The record lives in one shared book.',
    points: [
      'Record cash by hand — M-Pesa payments record themselves',
      'Loans, repayments and welfare tracked member by member',
      'Every member checks her own balance',
    ],
    photo: PHOTOS.vslaReading,
  },
  {
    eyebrow: 'Youth groups & young members',
    title: 'For groups that already run on their phones.',
    body: 'Pay by M-Pesa, get SMS reminders, check your balance. No chasing the treasurer.',
    points: [
      'An M-Pesa prompt to contribute or repay, straight to the phone',
      'Contribution reminders that go out on their own, by SMS',
      'Officials manage the group — members see only their own record',
    ],
    photo: PHOTOS.memberPhone,
  },
];

/** Photo-led section naming the two communities the site's art direction centres on. */
export function CommunitiesSection({ id }: { id?: string }) {
  return (
    <FinanzaSection id={id} labelledBy="communities-heading">
      <FinanzaHeading
        id="communities-heading"
        align="center"
        pill="Our Communities"
        title="Made for how your group already works."
        lede="From a VSLA meeting under a tree to a youth group that lives on WhatsApp."
        className="mb-12"
      />
      <div className="grid gap-8 lg:grid-cols-2">
        {COMMUNITIES.map((community, i) => (
          <Reveal
            key={community.eyebrow}
            delay={i * 150}
            className="flex flex-col overflow-hidden rounded-lg border border-brand-100 bg-white"
          >
            <div className="relative aspect-16/10">
              <Image
                src={community.photo.src}
                alt={community.photo.alt}
                fill
                sizes="(max-width: 1023px) 100vw, 50vw"
                className="object-cover"
                style={{ objectPosition: community.photo.position }}
                placeholder="blur"
              />
            </div>
            <div className="flex flex-1 flex-col p-7 sm:p-8">
              <p className="mb-3 font-medium uppercase tracking-wide text-brand-500">{community.eyebrow}</p>
              <h3 className="font-display text-2xl font-semibold leading-snug text-finanza-dark">{community.title}</h3>
              <p className="mt-3 leading-relaxed text-finanza-text">{community.body}</p>
              <ul className="mt-5 space-y-3">
                {community.points.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-finanza-text">
                    <Check aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>
    </FinanzaSection>
  );
}
