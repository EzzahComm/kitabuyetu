import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Banknote,
  BarChart3,
  Check,
  FileText,
  GraduationCap,
  MessagesSquare,
  ShieldCheck,
  Smartphone,
  Store,
  TrendingUp,
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
import { StoryTabs } from '@/components/marketing/finanza-tabs';
import { Container } from '@/components/marketing/primitives';
import { Reveal } from '@/components/marketing/reveal';
import { PHOTOS } from '@/components/marketing/photos';
import {
  FeatureBox,
  FinanzaHeading,
  FinanzaSection,
  IconBadge,
  Pill,
  btnPrimary,
} from '@/components/marketing/finanza';
import {
  CallbackSection,
  CommunitiesSection,
  CtaBand,
  CustomerPathsSection,
  FaqSection,
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

/**
 * The real organization types this platform already serves — matches
 * groups.type (migrations 001/154), grouped into plain-language categories
 * rather than listing the raw enum.
 */
const AUDIENCES = [
  'Chamas & VSLAs',
  'SACCOs & cooperatives',
  'Welfare & self-help groups',
  'Investment groups',
  'CBOs & community associations',
  'NGOs & organizations',
];

const PROMISES = [
  { icon: Unlock, title: 'No lock-in period', body: 'Pay month to month, with no contract to break.' },
  { icon: Smartphone, title: 'Pay by M-Pesa', body: 'Your subscription and your members’ contributions.' },
  { icon: UsersRound, title: 'Built for Kenyan groups', body: 'Not a generic business tool adapted to fit.' },
];

const MANAGE = [
  {
    icon: Banknote,
    title: 'Manage your money',
    body: 'Track members, contributions, savings, loans, welfare, shares, dividends, income and expenses from one reliable financial record.',
    href: ROUTES.bookkeeper,
  },
  {
    icon: TrendingUp,
    title: "Track what you're building",
    body: 'Manage farms, rentals, shops, businesses, projects and other investments. See what each activity costs, earns and contributes to the group.',
    href: ROUTES.bookkeeper,
  },
  {
    icon: MessagesSquare,
    title: 'Keep members informed',
    body: 'Send contribution reminders, payment confirmations, announcements and campaigns — while members access their own balances and statements.',
    href: ROUTES.chamaReminder,
  },
  {
    icon: BarChart3,
    title: 'Make every shilling visible',
    body: 'Know where group money comes from, where it goes and what it is building.',
    href: '/how-it-works',
  },
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
    body: 'Connect with potential donors, development partners and funding opportunities for groups and community projects.',
  },
  {
    icon: ShieldCheck,
    title: 'Financial products',
    body: 'Discover relevant loans, insurance and other financial products for groups and their members.',
  },
  {
    icon: GraduationCap,
    title: 'Professional knowledge',
    body: 'Information, training and practical guidance from professionals in finance, agriculture, investment, entrepreneurship and governance.',
  },
  {
    icon: Store,
    title: 'Markets & services',
    body: "Potential markets, suppliers, service providers and business opportunities that can support your group's activities.",
  },
  {
    icon: FileText,
    title: 'Build your track record',
    body: 'Better records give your group a clearer picture of its financial health, activities and impact.',
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
          <div className="mb-8 grid items-end gap-8 lg:grid-cols-2">
            <Reveal>
              <Image
                src={PHOTOS.vslaRecords.src}
                alt={PHOTOS.vslaRecords.alt}
                className="w-full rounded-lg"
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
              <p className="mb-6 leading-relaxed text-finanza-text">
                Chamas, SACCOs, welfare groups, investment groups, CBOs and the organizations that support them — not a
                generic business tool adapted to fit.
              </p>
              <StoryTabs
                label="About Kitabu Yetu"
                tabs={[
                  {
                    value: 'story',
                    label: 'Our Story',
                    content: (
                      <>
                        <p>
                          Most groups already keep good records. The trouble was never discipline — it was where the
                          records lived: one cash book in one person&apos;s handwriting, a spreadsheet three officers
                          all need at once, and an M-Pesa statement matched to a list of names the evening before a
                          meeting.
                        </p>
                        <p>
                          Kitabu Yetu puts the members, the money and the payments in one place, on a ledger that has to
                          balance before it saves.
                        </p>
                      </>
                    ),
                  },
                  {
                    value: 'audience',
                    label: "Who It's For",
                    content: (
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {AUDIENCES.map((audience) => (
                          <li key={audience} className="flex items-center gap-2">
                            <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-500" />
                            {audience}
                          </li>
                        ))}
                      </ul>
                    ),
                  },
                  {
                    value: 'problem',
                    label: 'The Problem',
                    content: (
                      <>
                        <p>
                          Every group tracks its money somehow. The problem is never effort — it&rsquo;s that notebooks,
                          spreadsheets and scattered M-Pesa messages don&rsquo;t add up the same way twice.
                        </p>
                        <p>
                          The group keeps doing what it already does. The book just stops being something one person
                          carries.
                        </p>
                      </>
                    ),
                  },
                ]}
              />
            </Reveal>
          </div>
          <Reveal className="rounded-lg border border-brand-100 p-6">
            <ul className="grid gap-6 lg:grid-cols-3">
              {PROMISES.map((promise, i) => (
                <li
                  key={promise.title}
                  className={
                    i < PROMISES.length - 1
                      ? 'flex gap-4 border-b border-brand-100 pb-6 lg:border-b-0 lg:border-r lg:pb-0'
                      : 'flex gap-4'
                  }
                >
                  <IconBadge icon={promise.icon} />
                  <div>
                    <h3 className="font-display text-xl font-semibold text-finanza-dark">{promise.title}</h3>
                    <p className="text-finanza-text">{promise.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        </FinanzaSection>

        <KitabuFacts />

        {/* Why Kitabu Yetu — the template's feature boxes */}
        <FinanzaSection labelledBy="why-heading">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <FinanzaHeading
                id="why-heading"
                pill="Why Kitabu Yetu"
                title="Everything your group needs, in one place."
                lede="No more switching between notebooks, spreadsheets, M-Pesa messages and WhatsApp to understand your group's finances."
              />
              <div className="my-8">
                <Emphasis>More visibility. More accountability. Better decisions.</Emphasis>
              </div>
              <Link href="/how-it-works" className={btnPrimary}>
                Explore More
              </Link>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              {MANAGE.map((item, i) => (
                // The stagger lives on an inner element: the reveal animation owns the outer transform.
                <Reveal key={item.title} delay={i * 120}>
                  <div className={i % 2 === 1 ? 'h-full sm:translate-y-10' : 'h-full'}>
                    <FeatureBox icon={item.icon} title={item.title} href={item.href} className="h-full">
                      {item.body}
                    </FeatureBox>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </FinanzaSection>

        {/* The problem, and what changes */}
        <FinanzaSection labelledBy="problem-heading" className="bg-brand-50/60">
          <FinanzaHeading
            id="problem-heading"
            align="center"
            pill="The Problem"
            title="Your group already keeps records. They just aren't reliable."
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
                <Emphasis>Less manual reconciliation. Less guessing. More confidence.</Emphasis>
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
                  className="w-full rounded-lg"
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
                <Emphasis>Manage your group. Build its track record. Unlock its potential.</Emphasis>
              </div>
              <Link href={ROUTES.ecosystem} className={btnPrimary}>
                Explore the Ecosystem
              </Link>
            </div>
          </div>
        </FinanzaSection>

        <CallbackSection />

        <TestimonialsSection />

        <FaqSection id={SECTION_IDS.faq} />

        <CtaBand id={SECTION_IDS.pricing} />
      </main>

      <SiteFooter />
      <JsonLd data={SITE_JSON_LD} />
    </div>
  );
}
