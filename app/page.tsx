import type { Metadata } from 'next';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { Hero } from '@/components/marketing/hero';
import { ProductPillarsSection } from '@/components/marketing/product-pillars-section';
import { ProblemSection } from '@/components/marketing/problem-section';
import { SolutionGrid } from '@/components/marketing/solution-grid';
import { WhyKitabuYetuSection } from '@/components/marketing/why-kitabu-yetu-section';
import { ProductShowcase } from '@/components/marketing/product-showcase';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { EcosystemSection } from '@/components/marketing/ecosystem-section';
import { EnterpriseSection } from '@/components/marketing/enterprise-section';
import { CustomerPaths } from '@/components/marketing/customer-paths';
import { MemberExperience } from '@/components/marketing/member-experience';
import { RoleCards } from '@/components/marketing/role-cards';
import { MpesaSection } from '@/components/marketing/mpesa-section';
import { TrustSection } from '@/components/marketing/trust-section';
import { ImpactSection } from '@/components/marketing/impact-section';
import { ResourcesSection } from '@/components/marketing/resources-section';
import { PricingSection } from '@/components/marketing/pricing-section';
import { FinalCta } from '@/components/marketing/final-cta';
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
    <div className="flex min-h-screen flex-col bg-paper">
      <StructuredData />
      {/* The skip link lives in SiteHeader, so every public page has one. */}
      <SiteHeader variant="overlay" />

      {/*
        Section order follows the story the page is meant to tell, in this
        order: what is this → why do I need it → what can it do → does it work
        with M-Pesa → what does it mean for members → what if I manage many
        groups → can I trust it → what else is there → how do I start → what
        does it cost → what do I do now.

        The two audiences split at CustomerPaths, which is why Enterprise sits
        immediately before it: a visitor who manages many groups has just been
        shown the organization product, so the fork that follows is a real
        choice rather than an abstract one.
      */}
      <main id="main" className="flex-1">
        <Hero />
        <SolutionGrid />
        <ProblemSection />
        <ProductShowcase />
        <MpesaSection />
        <MemberExperience />
        <EnterpriseSection />
        <CustomerPaths />
        <TrustSection />
        <RoleCards />
        <ProductPillarsSection />
        <EcosystemSection />
        <HowItWorks />
        <WhyKitabuYetuSection />
        <ImpactSection />
        <ResourcesSection />
        <PricingSection />
        <FinalCta />
      </main>

      <SiteFooter />
    </div>
  );
}
