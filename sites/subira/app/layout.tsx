import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { displayFont } from '@/components/display-font';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--subira-inter', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://subirainternational.kitabuyetu.co.ke'),
  title: 'Subira International',
  description: 'Subira International website preview.',
  robots: { index: false, follow: false },
  icons: {
    icon: { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    apple: { url: '/subira-icon-180.png', sizes: '180x180' },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${displayFont.variable}`}>
      <body className="bg-white font-sans text-finanza-dark">
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
