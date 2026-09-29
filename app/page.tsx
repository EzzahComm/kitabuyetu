import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Banknote,
  Check,
  FileText,
  GraduationCap,
  ShieldCheck,
  Smartphone,
  Store,
  Unlock,
  UsersRound,
  X,
} from 'lucide-react';

import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { displayFont } from '@/components/marketing/display-font';
import { JsonLd } from '@/components/marketing/json-ld';
import { HOME_DESCRIPTION, HOME_TITLE, SITE_URL } from '@/components/marketing/page-metadata';
import { CONTACT, ROUTES, SECTION_IDS } from '@/components/marketing/routes';
import { HeroCarousel } from '@/components/marketing/hero-carousel';
import { Container } from '@/components/marketing/primitives';
import { Reveal } from '@/components/marketing/reveal';
import { PHOTOS } from '@/components/marketing/photos';
import {
  FinanzaHeading,
  FinanzaSection,
  IconBadge,
  Pill,
  btnOutline,
  btnPrimary,
} from '@/components/marketing/finanza';
import {
  CallbackSection,
  CommunitiesSection,
  CtaBand,
  CustomerPathsSection,
  FaqSection,
  LatestPostsSection,
  LiveCampaignsSection,
  KitabuFacts,
  MemberBenefitsSection,
  ProductTabsSection,
  TestimonialsSection,
  TrustSection,
} from '@/components/marketing/kitabu-sections';

import ezzahcommLogo from '../public/img/partners/ezzahcomm.jpg';
import ezzahcommIntelligentSystemsLogo from '../public/img/partners/ezzahcomm-intelligent-systems.png';
import nexusLogo from '../public/img/partners/nexus-by-ezzahcomm.png';

// No page-level openGraph/twitter: they would replace the og:image app/opengraph-image.tsx attaches here.
// Social title/description for `/` come from the root layout; every other indexable page sets its own.
export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/` },
};

/** Re-render at most every 5 minutes so live campaigns and new blog posts appear without a deploy. */
export const revalidate = 300;

const ORGANIZATION_ID = `${SITE_URL}/#organization`;

const SITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': ORGANIZATION_ID,
      name: 'Kitabu Yetu',
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/icons/icon-512.png`,
      contactPoint: CONTACT.phones.map((telephone) => ({
        '@type': 'ContactPoint',
        contactType: 'customer service',
        telephone,
        email: CONTACT.email,
      })),
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: 'Kitabu Yetu',
      url: `${SITE_URL}/`,
      publisher: { '@id': ORGANIZATION_ID },
    },
  ],
};

const PARTNER_LOGOS = [
  { id: 'ezzahcomm', name: 'EzzahComm', image: ezzahcommLogo },
  {
    id: 'ezzahcomm-intelligent-systems',
    name: 'EzzahComm Intelligent Systems',
    image: ezzahcommIntelligentSystemsLogo,
  },
  { id: 'nexus', name: 'NEXUS by EzzahComm', image: nexusLogo },
] as const;

const PROMISES = [
  { icon: Unlock, title: 'No lock-in period', body: 'Pay month to month, with no contract to break.' },
  { icon: Smartphone, title: 'Pay by M-Pesa', body: 'Your subscription and your members’ contributions.' },
  { icon: UsersRound, title: 'Built for Kenyan groups', body: 'Not a generic business tool adapted to fit.' },
];

/** Matched 1:1 by index, so the two columns read as a direct correction. */
const TODAY = [
  'Notebooks that only one person can read',
  'Spreadsheets nobody trusts after a meeting argument',
  "M-Pesa messages scattered across officials' phones",
  'Manual calculations redone at every meeting',
  'Reports that take days to put together',
  'Balances members have to take on faith',
];
const WITH_KITABU = [
  'One organized digital record everyone in office can see',
  'Transparent finances the whole group can trust',
  'Payments matched to members automatically',
  'Calculations the system does for you',
  'Reports ready in minutes, not days',
  'Balances every member can check for themselves',
];

const PAYMENT_STEPS = [
  { title: 'Members pay through M-Pesa', body: 'Contributions arrive the way members already send money.' },
  { title: 'Payments are matched', body: 'Kitabu Yetu helps match each payment to the member who made it.' },
  { title: 'Your books update', body: "The group's records reflect the payment — no evening of reconciliation." },
];

const ECOSYSTEM = [
  {
    icon: Banknote,
    title: 'Funding',
    body: 'Donors, development partners and funding for group projects.',
  },
  {
    icon: ShieldCheck,
    title: 'Financial products',
    body: 'Loans, insurance and other products for groups and members.',
  },
  {
    icon: GraduationCap,
    title: 'Professional knowledge',
    body: 'Practical guidance on finance, farming, investment and governance.',
  },
  {
    icon: Store,
    title: 'Markets & services',
    body: "Markets, suppliers and services for your group's activities.",
  },
  {
    icon: FileText,
    title: 'Build your track record',
    body: 'Clean records show what your group has built — and what it can do next.',
  },
];

/** The one-line takeaway that closes a section. */
function Emphasis({ children }: { children: ReactNode }) {
  return <p className="border-l-4 border-brand-500 pl-4 text-lg font-semibold text-finanza-dark">{children}</p>;
}

export default function Home() {
  return (
    <div className={`${displayFont.variable} bg-white`}>
      <SiteHeader />

      <main id="main">
        <HeroCarousel />

        {/* Partners */}
        <section aria-label="Partners" className="border-b border-brand-100 py-10">
          <Container className="flex flex-col items-center gap-6 lg:flex-row lg:justify-between">
            <p className="text-center font-display text-xl font-semibold text-finanza-dark">
              Built for Kenyan groups, on <span className="text-brand-500">Kenyan rails</span>
            </p>
            <ul className="flex flex-wrap items-center justify-center gap-5">
              {PARTNER_LOGOS.map((partner) => (
                <li
                  key={partner.id}
                  className="flex h-16 items-center justify-center rounded-lg border border-brand-100 bg-white px-6 py-3"
                >
                  <Image src={partner.image} alt={partner.name} className="h-10 w-auto object-contain" sizes="200px" />
                </li>
              ))}
            </ul>
          </Container>
        </section>

        <CustomerPathsSection id={SECTION_IDS.paths} />

        {/* About */}
        <FinanzaSection id={SECTION_IDS.solution} labelledBy="about-heading">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <Reveal>
              <Image
                src={PHOTOS.vslaRecords.src}
                alt={PHOTOS.vslaRecords.alt}
                className="aspect-[4/3] w-full rounded-lg object-cover"
                sizes="(max-width: 1023px) 100vw, 50vw"
                placeholder="blur"
              />
            </Reveal>
            <Reveal delay={150}>
              <Pill>About Us</Pill>
              <h2
                id="about-heading"
                className="mb-5 font-display text-[2rem] font-bold leading-[1.15] text-finanza-dark sm:text-[2.5rem] xl:text-5xl"
              >
                Built for the groups Kenyans already organize.
              </h2>
              <p className="mb-4 leading-relaxed text-finanza-text">
                Most groups already keep good records. The trouble is where they live: one cash book in one
                person&apos;s handwriting, and an M-Pesa statement matched to names the night before a meeting.
              </p>
              <p className="mb-8 leading-relaxed text-finanza-text">
                Kitabu Yetu puts members, money and payments in one place, on a ledger that has to balance before it
                saves.
              </p>
              <ul className="space-y-5">
                {PROMISES.map((promise) => (
                  <li key={promise.title} className="flex gap-4">
                    <IconBadge icon={promise.icon} />
                    <div>
                      <h3 className="font-display text-lg font-semibold text-finanza-dark">{promise.title}</h3>
                      <p className="text-finanza-text">{promise.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </FinanzaSection>

        <KitabuFacts />

        {/* The problem, and what changes */}
        <FinanzaSection labelledBy="problem-heading" className="bg-brand-50/60">
          <FinanzaHeading
            id="problem-heading"
            align="center"
            pill="The Problem"
            title="Your group already keeps records, but they aren't reliable."
            className="mb-12"
          />
          <div className="grid gap-6 md:grid-cols-2">
            <Reveal className="rounded-lg border border-brand-100 bg-white p-8">
              <h3 className="mb-5 font-display text-xl font-semibold text-finanza-dark">Today</h3>
              <ul className="space-y-4">
                {TODAY.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-finanza-text">
                    <X aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-finanza-orange-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={150} className="rounded-lg border border-brand-500 bg-brand-500 p-8 text-white">
              <h3 className="mb-5 font-display text-xl font-semibold text-white">With Kitabu Yetu</h3>
              <ul className="space-y-4">
                {WITH_KITABU.map((item) => (
                  <li key={item} className="flex items-start gap-3 font-medium">
                    <Check aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </FinanzaSection>

        <ProductTabsSection id={SECTION_IDS.showcase} />

        <CommunitiesSection id={SECTION_IDS.communities} />

        {/* How it works */}
        <FinanzaSection id={SECTION_IDS.howItWorks} labelledBy="how-heading" className="bg-brand-50/60">
          <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.2fr]">
            <div id={SECTION_IDS.payments} className="scroll-mt-28">
              <FinanzaHeading
                id="how-heading"
                pill="How It Works"
                title="From M-Pesa to your books."
                lede="Payments and records work together. Members pay through M-Pesa and Kitabu Yetu helps match payments to members and update the group's records."
              />
              <div className="my-8">
                <Emphasis>Less reconciling and guessing, more confidence.</Emphasis>
              </div>
              <Link href="/how-it-works" className={btnPrimary}>
                See How It Works
              </Link>
            </div>
            <ol className="space-y-5">
              {PAYMENT_STEPS.map((step, i) => (
                <Reveal
                  as="li"
                  key={step.title}
                  delay={i * 120}
                  className="flex gap-5 rounded-lg border border-brand-100 bg-white p-6"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-500 font-display text-xl font-bold text-white">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-display text-xl font-semibold text-finanza-dark">{step.title}</h3>
                    <p className="mt-1 text-finanza-text">{step.body}</p>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </FinanzaSection>

        <MemberBenefitsSection />

        <TrustSection id={SECTION_IDS.trust} />

        {/* Ecosystem */}
        <FinanzaSection id={SECTION_IDS.ecosystem} labelledBy="ecosystem-heading">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="lg:order-2">
              <Reveal>
                <Image
                  src={PHOTOS.youthTech.src}
                  alt={PHOTOS.youthTech.alt}
                  className="aspect-[4/3] w-full rounded-lg object-cover"
                  sizes="(max-width: 1023px) 100vw, 50vw"
                  placeholder="blur"
                />
              </Reveal>
            </div>
            <div>
              <FinanzaHeading
                id="ecosystem-heading"
                pill="Ecosystem"
                title="From managing your group to growing it."
                lede="The Kitabu Yetu Ecosystem connects organized groups to opportunities, knowledge and resources beyond their own savings."
              />
              <ul className="mt-8 space-y-6">
                {ECOSYSTEM.map((item) => (
                  <li key={item.title} className="flex gap-4">
                    <IconBadge icon={item.icon} />
                    <div>
                      <h3 className="font-display text-xl font-semibold text-finanza-dark">{item.title}</h3>
                      <p className="mt-1 text-finanza-text">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="my-8">
                <Emphasis>Manage your group, build its track record and unlock its potential.</Emphasis>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href={ROUTES.ecosystemMarketplace} className={btnPrimary}>
                  Browse the Marketplace
                </Link>
                <Link href={ROUTES.ecosystem} className={btnOutline}>
                  Explore the Ecosystem
                </Link>
              </div>
            </div>
          </div>
        </FinanzaSection>

        <LiveCampaignsSection id={SECTION_IDS.campaigns} />

        <CallbackSection />

        <TestimonialsSection />

        <LatestPostsSection id={SECTION_IDS.blog} />

        <FaqSection id={SECTION_IDS.faq} />

        <CtaBand id={SECTION_IDS.pricing} />
      </main>

      <SiteFooter />
      <JsonLd data={SITE_JSON_LD} />
    </div>
  );
}
