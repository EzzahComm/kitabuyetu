import type { Metadata } from 'next';
import Navbar from '@/components/landing/navbar';
import Hero from '@/components/landing/hero';
import Stats from '@/components/landing/stats';
import Features from '@/components/landing/features';
import HowItWorks from '@/components/landing/how-it-works';
import Testimonials from '@/components/landing/testimonials';
import CtaSection from '@/components/landing/cta';
import Footer from '@/components/landing/footer';

export const metadata: Metadata = {
  title: 'Kitabu Yetu — Chama & SACCO Financial Management',
  description:
    'The complete financial management platform for Kenyan SACCOs, chamas, and community groups. Track contributions, manage loans, and receive M-Pesa payments — all in one place.',
  keywords: [
    'chama management',
    'SACCO software',
    'Kenya',
    'M-Pesa integration',
    'community group finance',
    'contribution tracking',
    'loan management',
  ],
  openGraph: {
    type: 'website',
    title: 'Kitabu Yetu — Chama & SACCO Financial Management',
    description:
      'Track contributions, manage loans, and receive M-Pesa payments — all in one platform built for Kenya.',
    siteName: 'Kitabu Yetu',
    locale: 'en_KE',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kitabu Yetu',
    description: 'The complete financial management platform for Kenyan community groups.',
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
        <Features />
        <HowItWorks />
        <Testimonials />
        <CtaSection />
      </main>
      <Footer />
    </div>
  );
}
