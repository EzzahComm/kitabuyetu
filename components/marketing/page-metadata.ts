import type { Metadata } from 'next';

export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.kitabuyetu.co.ke').replace(/\/$/, '');

/** Corporate positioning used by the homepage and inherited social metadata. */
export const HOME_TITLE = 'Kitabu Yetu | Digital Operating System for Community Organisations';
export const HOME_DESCRIPTION =
  'Digital infrastructure for community organisations and the institutions that support them. Manage membership, finances, communication and programmes with Kitabu Yetu.';

/** The branded 1200×630 card from app/opengraph-image.tsx, which Next.js only attaches to `/` on its own. */
export const OG_FALLBACK_IMAGE = `${SITE_URL}/opengraph-image`;

export const OG_FALLBACK = {
  url: OG_FALLBACK_IMAGE,
  width: 1200,
  height: 630,
  alt: 'Kitabu Yetu — The Digital Operating System for Community Organisations.',
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
