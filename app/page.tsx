import type { Metadata } from 'next';
import Navbar from '@/components/landing/navbar';
import Hero from '@/components/landing/hero';
import Stats from '@/components/landing/stats';
import Personas from '@/components/landing/personas';
import Features from '@/components/landing/features';
import HowItWorks from '@/components/landing/how-it-works';
import Testimonials from '@/components/landing/testimonials';
import CtaSection from '@/components/landing/cta';
import Footer from '@/components/landing/footer';

export const metadata: Metadata = {
  title: 'Kitabu Yetu — Simple Books. Stronger Groups.',
  description:
    'The digital ledger for Kenya\'s chamas, SACCOs, and welfare groups. Collect by M-Pesa (STK, PayBill, B2C), auto-reconcile every payment, split contributions across accounts, and keep an audit-ready double-entry book.',
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
    title: 'Kitabu Yetu — Simple Books. Stronger Groups.',
    description:
      'Collect by M-Pesa, auto-reconcile every shilling, and keep an audit-ready ledger — built for Kenya\'s community groups.',
    siteName: 'Kitabu Yetu',
    locale: 'en_KE',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kitabu Yetu — Simple Books. Stronger Groups.',
    description: 'The digital ledger for Kenya\'s chamas, SACCOs, and welfare groups.',
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
        <Stats />
        <Personas />
        <Features />
        <HowItWorks />
        <Testimonials />
        <CtaSection />
      </main>
      <Footer />
    </div>
  );
}
