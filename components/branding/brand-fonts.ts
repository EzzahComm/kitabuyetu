import { Jost, Open_Sans } from 'next/font/google';

/**
 * The two faces the logo lockup is set in (lib/ui/brand-mark.ts BRAND_FONTS):
 * Jost 800 for the wordmark, Open Sans 600 for the tagline.
 *
 * One weight each, latin only. Only routes that render <BrandLockup /> load
 * them, so the cost is ~2 small woff2 files where the logo appears, never the
 * marketing display face's three weights (components/marketing/display-font.ts).
 */
export const wordmarkFont = Jost({
  subsets: ['latin'],
  weight: '800',
  display: 'swap',
});

export const taglineFont = Open_Sans({
  subsets: ['latin'],
  weight: '600',
  display: 'swap',
});
