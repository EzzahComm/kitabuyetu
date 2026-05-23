import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/providers';
import { SpeedInsights } from '@vercel/speed-insights/next';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const viewport: Viewport = {
  themeColor: '#0B3C88', // Kitabu Yetu brand navy
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

const TAGLINE = 'Simple Books. Stronger Groups.';
const LONG_DESCRIPTION =
  'Kitabu Yetu — Simple Books. Stronger Groups. Digital bookkeeping for chamas, table banking groups, SACCOs, welfare associations, and investment clubs across East Africa.';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.com'),
  title:       { default: `Kitabu Yetu — ${TAGLINE}`, template: '%s | Kitabu Yetu' },
  description: LONG_DESCRIPTION,
  applicationName: 'Kitabu Yetu',
  keywords: ['chama', 'table banking', 'welfare', 'SACCO', 'cooperative', 'investment club', 'Kenya', 'East Africa', 'bookkeeping', 'community finance'],
  authors: [{ name: 'Kitabu Yetu' }],
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Kitabu Yetu',
    startupImage: [
      {
        url: '/icons/icon-512.png',
        media: '(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2)',
      },
    ],
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/favicon.png',        sizes: '32x32',  type: 'image/png' },
      { url: '/icons/icon-72.png',  sizes: '72x72',  type: 'image/png' },
      { url: '/icons/icon-96.png',  sizes: '96x96',  type: 'image/png' },
      { url: '/icons/icon-128.png', sizes: '128x128', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    shortcut: '/favicon.png',
  },
  openGraph: {
    type: 'website',
    siteName: 'Kitabu Yetu',
    title: `Kitabu Yetu — ${TAGLINE}`,
    description: LONG_DESCRIPTION,
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: 'Kitabu Yetu logo' }],
  },
  twitter: {
    card: 'summary',
    title: `Kitabu Yetu — ${TAGLINE}`,
    description: LONG_DESCRIPTION,
    images: ['/icons/icon-512.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
        <SpeedInsights />
      </body>
    </html>
  );
}
