import type { Metadata } from 'next';

export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.co.ke').replace(/\/$/, '');

/** The homepage's search title and description. The root layout's openGraph/twitter reuse them: `/` is the only indexable page that inherits those. */
export const HOME_TITLE = 'Kitabu Yetu — Chama Management App for Kenya with M-Pesa';
export const HOME_DESCRIPTION =
  'Run your chama, welfare group or table banking group on Kitabu Yetu: M-Pesa contributions, loans, SMS reminders and records every member can trust.';

/** The branded 1200×630 card from app/opengraph-image.tsx, which Next.js only attaches to `/` on its own. */
export const OG_FALLBACK_IMAGE = `${SITE_URL}/opengraph-image`;

export const OG_FALLBACK = {
  url: OG_FALLBACK_IMAGE,
  width: 1200,
  height: 630,
  alt: 'Kitabu Yetu — Simple books. Stronger groups.',
};

// A page's own openGraph/twitter objects replace the root layout's wholesale (no deep merge),
// so everything the layout provided (type, site name, image) is restated here.
export function marketingMetadata({
  path,
  title,
  description,
  image,
}: {
  path: string;
  title: string;
  description: string;
  image?: string | null;
}): Metadata {
  const url = `${SITE_URL}${path}`;
  const images = [image ? { url: image } : OG_FALLBACK];
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: 'Kitabu Yetu', url, title, description, images },
    twitter: { card: 'summary_large_image', title, description, images },
  };
}
