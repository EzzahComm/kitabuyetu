import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Check, HandCoins, Layers, MessageSquareText, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { signUpUrl } from '@/lib/app-links';
import { PLAN_MONTHLY_FEES } from '@/types/enums';
import bookkeeperImg from '@/public/img/bookkeeper.jpg';
import chamaReminderImg from '@/public/img/chama-reminder.jpg';
import fundraiseImg from '@/public/img/fundraise.jpg';
import enterpriseImg from '@/public/img/enterprise.jpg';
import bernardKisakaPhoto from '@/public/img/testimonials/bernard-kisaka.jpg';
import ezraWekesaPhoto from '@/public/img/testimonials/ezra-wekesa.jpg';
import founderPhoto from '@/public/img/team/polycap-wanyonyi.png';
import { CallbackForm } from './callback-form';
import { PRODUCT_PILLARS } from './content';
import {
  FactsBand,
  FinanzaHeading,
  FinanzaSection,
  Pill,
  btnOnPrimary,
  btnPrimary,
  patternBandStyle,
  type Fact,
} from './finanza';
import { ServiceTabs } from './finanza-tabs';
import { Container } from './primitives';
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
  { icon: Layers, value: PRODUCT_PILLARS.length, label: 'Products on one platform' },
  { icon: UsersRound, value: 6, label: 'Kinds of groups served' },
  {
    icon: HandCoins,
    value: PLAN_MONTHLY_FEES.kitabu_yetu.starter,
    prefix: 'KES ',
    label: 'Bookkeeper, per month, from',
  },
  {
    icon: MessageSquareText,
    value: PLAN_MONTHLY_FEES.chama_reminder.starter,
    prefix: 'KES ',
    label: 'Chama Reminder, per month, from',
  },
];

export function KitabuFacts() {
  return <FactsBand facts={KITABU_FACTS} />;
}

const PRODUCT_MEDIA = {
  Bookkeeper: {
    tagline: "Your group's financial record.",
    image: bookkeeperImg,
    imageAlt: 'Three men talking at a shared desk in an open-plan office',
  },
  'Chama Reminder': {
    tagline: 'Keep members engaged and contributions on track.',
    image: chamaReminderImg,
    imageAlt: 'One person points at a laptop screen while another uses the trackpad',
  },
  'Fundraise / Changi$ha': {
    tagline: 'Raise money for groups, projects and community initiatives.',
    image: fundraiseImg,
    imageAlt: 'A cashier smiles as a customer holds a phone over a payment reader',
  },
  Enterprise: {
    tagline: 'Manage many groups from one place.',
    image: enterpriseImg,
    imageAlt: 'Two women talking at a conference table, one taking notes beside a laptop',
  },
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
                src={media.image}
                alt={media.imageAlt}
                fill
                sizes="(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 33vw"
                className="object-cover"
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
        title="One platform. Four solutions."
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
        title="What our groups say"
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
              Request A Call-Back
            </h2>
            <p className="mt-4 text-finanza-text">
              Tell us about your group and we&apos;ll recommend the right solution.
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
}

/** Closing call to action on the template's primary pattern band. */
export function CtaBand({
  id,
  title = 'Ready to grow your group?',
  subtitle = 'Bring your members, money, records and investments together.',
  footnote = 'No lock-in period · Pay by M-Pesa · Built for Kenyan groups',
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
            <p className="mt-4 text-white/90">
              Bookkeeper from KES {PLAN_MONTHLY_FEES.kitabu_yetu.starter}/month · Chama Reminder from KES{' '}
              {PLAN_MONTHLY_FEES.chama_reminder.starter}/month ·{' '}
              <Link href={ROUTES.pricing} className="font-medium underline underline-offset-4 hover:text-white">
                View pricing
              </Link>
            </p>
          </div>
          <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row lg:flex-col xl:flex-row">
            <a href={signUpUrl()} className={btnOnPrimary}>
              Get Started
            </a>
            <Link
              href={ROUTES.contact}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white px-8 py-3 font-medium text-white transition-colors duration-500 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Talk to Us
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
