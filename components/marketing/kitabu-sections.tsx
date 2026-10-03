import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Check, ChevronDown, HandCoins, Layers, MessageSquareText, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { signUpUrl } from '@/lib/app-links';
import { PLAN_MONTHLY_FEES } from '@/types/enums';
import bernardKisakaPhoto from '@/public/img/testimonials/bernard-kisaka.jpg';
import ezraWekesaPhoto from '@/public/img/testimonials/ezra-wekesa.jpg';
import founderPhoto from '@/public/img/team/polycap-wanyonyi.png';
import { CallbackForm } from './callback-form';
import { CONTROLS, CUSTOMER_PATHS, HOME_FAQS, MEMBER_BENEFITS, PRODUCT_PILLARS } from './content';
import {
  FactsBand,
  FinanzaHeading,
  FinanzaSection,
  IconBadge,
  Pill,
  btnOnPrimary,
  btnOutline,
  btnPrimary,
  patternBandStyle,
  type Fact,
} from './finanza';
import { ServiceTabs } from './finanza-tabs';
import { JsonLd, faqPageJsonLd } from './json-ld';
import { PHOTOS, PRODUCT_PHOTOS, type Photo } from './photos';
import { PostCard } from './post-card';
import { CampaignCard } from './campaign-card';
import type { Campaign } from '@/lib/services/campaigns.service';
import { getPosts } from '@/lib/cms/sanity';
import { Container } from './primitives';
import { Reveal } from './reveal';
import { FOUNDER_SOCIAL_LINKS, ROUTES } from './routes';
import { SocialLinks } from './social-links';
import { TestimonialCarousel, type Testimonial } from './testimonial-carousel';

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

/** Real quotes from real groups; photos only where the person supplied one. */
export const TESTIMONIALS: Testimonial[] = [
  {
    quote: 'Kitabu Yetu has been a game changer for accountability and transparency in our group.',
    name: 'Ezra Wekesa',
    title: 'Coordinator, Munyali Ukulima Self Help Group',
    image: ezraWekesaPhoto,
  },
  {
    quote: 'It has made mobilizing our members much easier and managing the group more efficient.',
    name: 'Bernard Kisaka',
    title: 'Musikoma Home Owners Welfare Association',
    image: bernardKisakaPhoto,
  },
  {
    quote: 'Manually updating contributions is a thing of the past.',
    name: 'Britney Mideva',
    title: 'Treasurer, The Fionas',
  },
  {
    quote: 'Meeting attendance has improved and timely contributions are becoming the norm.',
    name: 'Joseph Bienda',
    title: 'Chairperson, Capital Point Chama',
  },
];

export function TestimonialsSection() {
  return (
    <FinanzaSection labelledBy="testimonials-heading">
      <FinanzaHeading
        id="testimonials-heading"
        align="center"
        pill="Testimonials"
        title="Trusted by treasurers and chairs"
        className="mb-10"
      />
      <TestimonialCarousel items={TESTIMONIALS} />
    </FinanzaSection>
  );
}

/**
 * Finanza's `.callback`: a white form card straddling a primary band that
 * fills the top half of the section.
 */
export function CallbackSection({ id = 'contact' }: { id?: string }) {
  return (
    <section id={id} aria-labelledby="callback-heading" className="relative isolate my-12 scroll-mt-28 pt-16">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-1/2" style={patternBandStyle} />
      <Container>
        <div className="mx-auto max-w-3xl rounded-lg border border-brand-100 bg-white p-6 shadow-sm sm:p-12">
          <div className="mx-auto mb-10 max-w-xl text-center">
            <Pill>Get In Touch</Pill>
            <h2
              id="callback-heading"
              className="font-display text-[2rem] font-bold leading-tight text-finanza-dark sm:text-[2.5rem]"
            >
              Get a free call-back
            </h2>
            <p className="mt-4 text-finanza-text">
              Tell us about your group. We&apos;ll call and recommend the right plan.
            </p>
          </div>
          <CallbackForm variant="callback" />
        </div>
      </Container>
    </section>
  );
}

interface CtaBandProps {
  id?: string;
  title?: string;
  subtitle?: string;
  footnote?: string;
  /** Show the subscription starting prices under the subtitle. Off for pages about another product. */
  showPlanPrices?: boolean;
  /** Primary button; defaults to group sign-up. */
  primary?: { label: string; href: string };
}

/** Closing call to action on the template's primary pattern band. */
export function CtaBand({
  id,
  title = 'Walk into your next meeting with the books already balanced.',
  subtitle = 'Set up in minutes. Bring your old records with you.',
  footnote = 'Month to month · Pay by M-Pesa · Cancel anytime',
  showPlanPrices = true,
  primary,
}: CtaBandProps) {
  return (
    <section id={id} aria-labelledby="cta-heading" className="scroll-mt-28 py-12">
      <Container>
        <div
          className="flex flex-col items-center gap-8 rounded-lg px-6 py-12 text-center text-white sm:px-12 lg:flex-row lg:justify-between lg:text-left"
          style={patternBandStyle}
        >
          <div className="max-w-2xl">
            <h2
              id="cta-heading"
              className="font-display text-[2rem] font-bold leading-tight text-white sm:text-[2.5rem]"
            >
              {title}
            </h2>
            <p className="mt-3 text-lg text-white/90">{subtitle}</p>
            {showPlanPrices && (
              <p className="mt-4 text-white/90">
                Bookkeeper from KES {PLAN_MONTHLY_FEES.kitabu_yetu.starter}/month · Chama Reminder from KES{' '}
                {PLAN_MONTHLY_FEES.chama_reminder.starter}/month ·{' '}
                <Link href={ROUTES.pricing} className="font-medium underline underline-offset-4 hover:text-white">
                  View pricing
                </Link>
              </p>
            )}
          </div>
          <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row lg:flex-col xl:flex-row">
            <a href={primary?.href ?? signUpUrl()} className={btnOnPrimary}>
              {primary?.label ?? `Start your group — from KES ${PLAN_MONTHLY_FEES.kitabu_yetu.starter}`}
            </a>
            <Link
              href={ROUTES.contact}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white px-8 py-3 font-medium text-white transition-colors duration-500 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Talk to us
            </Link>
          </div>
        </div>
        {footnote && <p className="mt-4 text-center text-sm text-finanza-text">{footnote}</p>}
      </Container>
    </section>
  );
}

const teamPanel =
  'absolute inset-x-8 inset-y-0 flex flex-col items-center justify-between rounded-lg border border-brand-100 p-4 transition-colors duration-500 group-hover:border-brand-500 group-hover:bg-brand-500 sm:inset-x-12';

/**
 * Finanza's `.team-item`: the photo framed by a bordered panel that floods
 * primary on hover. Only the founder is named — see app/about/team/page.tsx
 * for why no one else is, until they have an approved bio and photo.
 */
export function FounderCard() {
  return (
    <div className="group relative py-16">
      <div className={teamPanel}>
        <div className="text-center">
          <p className="font-display text-xl font-semibold text-finanza-dark transition-colors duration-500 group-hover:text-white">
            Polycap Wanyonyi
          </p>
          <p className="text-sm text-finanza-text transition-colors duration-500 group-hover:text-white/85">
            Founder, Kitabu Yetu
          </p>
        </div>
        <SocialLinks variant="card" links={FOUNDER_SOCIAL_LINKS} className="relative z-10" />
      </div>
      <div className="relative z-[2] mx-auto aspect-square w-full overflow-hidden rounded-lg bg-white">
        <Image
          src={founderPhoto}
          alt="Polycap Wanyonyi, Founder of Kitabu Yetu"
          fill
          sizes="(max-width: 767px) 90vw, (max-width: 1023px) 45vw, 30vw"
          className="object-cover object-top"
        />
      </div>
    </div>
  );
}

/** Stands where the template's second and third team members would be, pointing to real openings. */
export function JoinTeamCard() {
  return (
    <div className="group relative py-16">
      <div className={teamPanel}>
        <p className="font-display text-xl font-semibold text-finanza-dark transition-colors duration-500 group-hover:text-white">
          More profiles soon
        </p>
        <Link
          href={ROUTES.careers}
          className="relative z-10 inline-flex items-center gap-1.5 rounded-lg bg-brand-100 px-4 py-2 text-sm font-medium text-brand-500 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          See open roles <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
      <div className="relative z-[2] flex aspect-square w-full flex-col items-center justify-center gap-4 rounded-lg bg-brand-50 p-8 text-center">
        <UsersRound aria-hidden="true" className="h-14 w-14 text-brand-500" />
        <p className="max-w-xs leading-relaxed text-finanza-text">
          Engineers, accountants and designers building in Nairobi, close to the groups we serve. Want to join them?
        </p>
      </div>
    </div>
  );
}

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

/** Shipped controls only — see the note on CONTROLS. Dark band so it reads as its own moment. */
export function TrustSection({ id }: { id?: string }) {
  return (
    <section id={id} aria-labelledby="trust-heading" className="scroll-mt-28 bg-finanza-dark py-16 lg:py-24">
      <Container>
        <div className="mb-12 grid items-end gap-8 lg:grid-cols-2">
          <Reveal>
            <Pill tone="dark">Security & Trust</Pill>
            <h2
              id="trust-heading"
              className="font-display text-[2rem] font-bold leading-[1.15] text-white sm:text-[2.5rem] xl:text-5xl"
            >
              Built for money that belongs to many.
            </h2>
          </Reveal>
          <Reveal delay={150}>
            <p className="text-lg leading-relaxed text-brand-100/85">
              Trust is the whole point. Every control below is live today.
            </p>
          </Reveal>
        </div>
        <ul className="grid gap-px overflow-hidden rounded-lg bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
          {CONTROLS.map((control) => (
            <li key={control.title} className="bg-finanza-dark p-7">
              <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-brand-500">
                <control.icon aria-hidden="true" className="h-5 w-5 text-white" />
              </span>
              <h3 className="font-display text-xl font-semibold text-white">{control.title}</h3>
              <p className="mt-2 leading-relaxed text-brand-100/80">{control.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/**
 * Native <details> accordion: works without JavaScript, and the FAQPage
 * JSON-LD is generated from the same HOME_FAQS array so the two cannot drift.
 */
export function FaqSection({ id }: { id?: string }) {
  return (
    <FinanzaSection id={id} labelledBy="faq-heading" className="bg-brand-50/60">
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <FinanzaHeading
            id="faq-heading"
            pill="FAQ"
            title="Questions groups ask us first."
            lede="Still unsure? Ask us on WhatsApp — we speak treasurer."
          />
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href={ROUTES.support} className={btnPrimary}>
              Visit Support
            </Link>
            <Link href={ROUTES.pricing} className={btnOutline}>
              See Pricing
            </Link>
          </div>
        </div>
        <div className="space-y-4">
          {HOME_FAQS.map(([question, answer], i) => (
            <details
              key={question}
              open={i === 0}
              className="group rounded-lg border border-brand-100 bg-white px-6 py-5 open:border-brand-500"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-display text-lg font-semibold text-finanza-dark [&::-webkit-details-marker]:hidden">
                {question}
                <ChevronDown
                  aria-hidden="true"
                  className="mt-1 h-5 w-5 shrink-0 text-brand-500 transition-transform duration-300 group-open:rotate-180"
                />
              </summary>
              <p className="mt-3 leading-relaxed text-finanza-text">{answer}</p>
            </details>
          ))}
        </div>
      </div>
      <JsonLd data={faqPageJsonLd(HOME_FAQS)} />
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
    title: 'The savings, the loans and the social fund — in one book.',
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
            <div className="relative aspect-[16/10]">
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

/** The three newest posts from the Sanity blog. Renders nothing when the CMS has none (or is unreachable). */
export async function LatestPostsSection({ id }: { id?: string }) {
  const posts = (await getPosts()).slice(0, 3);
  if (posts.length === 0) return null;
  return (
    <FinanzaSection id={id} labelledBy="blog-heading">
      <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <FinanzaHeading
          id="blog-heading"
          pill="From The Blog"
          title="Guides for the people who run groups."
          className="max-w-2xl"
        />
        <Link href={ROUTES.resources} className={cn(btnOutline, 'shrink-0 self-start sm:self-auto')}>
          All articles <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
      <ul className="grid gap-6 md:grid-cols-3">
        {posts.map((post) => (
          <li key={post.slug}>
            <PostCard post={post} />
          </li>
        ))}
      </ul>
    </FinanzaSection>
  );
}

/**
 * Live Changi$ha campaigns — or, when none are live, the most recent finished
 * ones. The service is imported lazily inside try/catch (as app/sitemap.ts
 * does): it validates DB env on load, and a build or preview without a
 * database must render the page without this section rather than fail.
 */
export async function LiveCampaignsSection({ id }: { id?: string }) {
  let live: Campaign[] = [];
  let past: Campaign[] = [];
  try {
    const { campaignsService } = await import('@/lib/services/campaigns.service');
    live = (await campaignsService.listActiveCampaigns()).slice(0, 3);
    if (live.length === 0) past = await campaignsService.listPastCampaigns(3);
  } catch {
    return null;
  }
  const shown = live.length > 0 ? live : past;
  if (shown.length === 0) return null;
  const ended = live.length === 0;

  return (
    <FinanzaSection id={id} labelledBy="live-campaigns-heading" className="bg-brand-50/60">
      <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <FinanzaHeading
          id="live-campaigns-heading"
          pill="Changi$ha"
          title={ended ? 'Recently funded by the community.' : 'Campaigns you can support today.'}
          lede="Checked by Kitabu Yetu. Give by M-Pesa. Donors pay nothing extra."
          className="max-w-2xl"
        />
        <Link href={ROUTES.fundraise} className={cn(btnOutline, 'shrink-0 self-start bg-white sm:self-auto')}>
          All campaigns <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
      <ul className="grid gap-6 md:grid-cols-3">
        {shown.map((campaign) => (
          <li key={campaign.slug}>
            <CampaignCard campaign={campaign} ended={ended} />
          </li>
        ))}
      </ul>
    </FinanzaSection>
  );
}
