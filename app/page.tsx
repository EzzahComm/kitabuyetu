import type { Metadata } from 'next';
import { Container } from '@/components/marketing/nextly/Container';
import { Navbar } from '@/components/marketing/nextly/Navbar';
import { Footer } from '@/components/marketing/nextly/Footer';
import { Hero } from '@/components/marketing/nextly/Hero';
import { SectionTitle } from '@/components/marketing/nextly/SectionTitle';
import { Benefits } from '@/components/marketing/nextly/Benefits';
import { Video } from '@/components/marketing/nextly/Video';
import { Testimonials } from '@/components/marketing/nextly/Testimonials';
import { Pricing } from '@/components/marketing/nextly/Pricing';
import { Faq } from '@/components/marketing/nextly/Faq';
import { Cta } from '@/components/marketing/nextly/Cta';
import { benefitOne, benefitTwo } from '@/components/marketing/nextly/data';
import { PLAN_MONTHLY_FEES } from '@/types/enums';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.co.ke';

const DESCRIPTION =
  'Kitabu Yetu helps chamas, SACCOs, welfare groups, investment clubs and community ' +
  'organizations manage members, savings, loans, welfare, shares and investments — with ' +
  'M-Pesa collection and a passbook for every member. For organizations managing many ' +
  'groups, Enterprise adds one connected view across every group you support.';

export const metadata: Metadata = {
  // `absolute` matters: the root layout sets a `%s | Kitabu Yetu` template, so
  // a plain string here rendered as "Kitabu Yetu — … | Kitabu Yetu".
  title: { absolute: 'Kitabu Yetu | Simple Books. Stronger Groups.' },
  description: DESCRIPTION,
  keywords: [
    'chama management software',
    'SACCO software Kenya',
    'welfare group accounting',
    'investment club bookkeeping',
    'M-Pesa reconciliation',
    'Daraja STK push',
    'PayBill collections',
    'table banking',
    'community group finance',
    'double-entry accounting Kenya',
  ],
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Kitabu Yetu',
    title: 'Kitabu Yetu | Simple Books. Stronger Groups.',
    description: DESCRIPTION,
    locale: 'en_KE',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kitabu Yetu | Simple Books. Stronger Groups.',
    description: DESCRIPTION,
  },
};

/**
 * Structured data. Prices come from the same fee table the billing API quotes
 * and the M-Pesa callback verifies against — a search result advertising a
 * price the product does not charge would be the same bug the pricing pages
 * already had once, just harder to notice.
 */
function StructuredData() {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Kitabu Yetu',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    url: SITE_URL,
    description: DESCRIPTION,
    areaServed: 'KE',
    offers: {
      '@type': 'Offer',
      price: PLAN_MONTHLY_FEES.kitabu_yetu.starter,
      priceCurrency: 'KES',
      category: 'Monthly subscription',
      url: `${SITE_URL}/pricing`,
    },
  };
  return (
    <script
      type="application/ld+json"
      // Static, locally-built object — no user input reaches this string.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <StructuredData />
      <Navbar />

      <main id="main" className="flex-1">
        <Container>
          <Hero />

          <SectionTitle
            preTitle="What Kitabu Yetu is"
            title="Your group&apos;s records. Finally in one place."
          >
            Members, money, payments and reports live together, instead of a
            notebook, a spreadsheet and an M-Pesa statement that somebody has to
            check against each other the night before every meeting.
          </SectionTitle>

          <Benefits data={benefitOne} />
          <Benefits imgPos="right" data={benefitTwo} />

          <SectionTitle
            preTitle="Payments"
            title="From M-Pesa to your books, in one motion"
          >
            A member pays by STK prompt or PayBill, Safaricom&apos;s callback is
            verified and matched to them, and the split into savings, welfare and
            loan repayment posts to the ledger — and a payment that arrives
            without a usable reference waits in a queue rather than being guessed
            at.
          </SectionTitle>

          <Video videoId="fZ0D0cnR88E" />

          <SectionTitle
            preTitle="Testimonials"
            title="What groups say about Kitabu Yetu"
          >
            Treasurers, chairpersons and NGO coordinators on what changed once
            the group&apos;s book moved online.
          </SectionTitle>

          <Testimonials />

          <div id="pricing">
            <SectionTitle
              preTitle="Pricing"
              title="One price a month, for the whole group"
            >
              Two products, one bill. Take the full book with Kitabu Yetu, or SMS
              reminders on their own with Chama Reminder. Every price below is
              the price the system actually charges.
            </SectionTitle>

            <Pricing />
          </div>

          <SectionTitle preTitle="FAQ" title="Frequently Asked Questions">
            What treasurers, chairpersons and NGO coordinators ask us most often.
          </SectionTitle>

          <Faq />
          <Cta />
        </Container>
      </main>

      <Footer />
    </div>
  );
}
