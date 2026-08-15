import type { Metadata } from 'next';
import Navbar from '@/components/landing/navbar';
import Hero from '@/components/landing/hero';
import ProblemSolution from '@/components/landing/problem-solution';
import DigitalTools from '@/components/landing/digital-tools';
import Personas from '@/components/landing/personas';
import Features from '@/components/landing/features';
import Showcase from '@/components/landing/showcase';
import Comparison from '@/components/landing/comparison';
import Security from '@/components/landing/security';
import Ecosystem from '@/components/landing/ecosystem';
import HowItWorks from '@/components/landing/how-it-works';
import PricingPreview from '@/components/landing/pricing-preview';
import CtaSection from '@/components/landing/cta';
import Footer from '@/components/landing/footer';

export const metadata: Metadata = {
  title: 'Kitabu Yetu — Build Vibrant Communities',
  description:
    'Digital bookkeeping for chamas, SACCOs, welfare groups, and investment clubs to create vibrant communities across East Africa.',
  keywords: [
    'chama management',
    'SACCO software',
    'Kenya',
    'M-Pesa Daraja integration',
    'STK push',
    'PayBill reconciliation',
    'B2C disbursement',
    'community group finance',
    'double-entry accounting',
    'loan management',
  ],
  openGraph: {
    type: 'website',
    title: 'Kitabu Yetu — Build Vibrant Communities',
    description:
      'Digital bookkeeping for chamas, SACCOs, welfare groups, and investment clubs to create vibrant communities across East Africa.',
    siteName: 'Kitabu Yetu',
    locale: 'en_KE',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kitabu Yetu — Build Vibrant Communities',
    description: 'Digital bookkeeping for chamas, SACCOs, welfare groups, and investment clubs across East Africa.',
  },
  alternates: {
    canonical: process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.co.ke',
  },
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main>
        <Hero />
        <ProblemSolution />
        <DigitalTools />
        <Personas />
        <Features />
        <Showcase />
        <Comparison />
        <Security />
        <Ecosystem />
        <HowItWorks />
        <PricingPreview />
        <CtaSection />
      </main>
      <Footer />
    </div>
  );
}
