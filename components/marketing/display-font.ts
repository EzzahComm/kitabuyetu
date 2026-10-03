import { Jost } from 'next/font/google';

/**
 * Display face for the marketing surface, read via the `font-display` Tailwind
 * utility (tailwind.config.ts). Jost, as the Finanza template uses for headings.
 *
 * Only the three weights the template loads. That is deliberate: a heading
 * still asking for `font-light` or `font-normal` resolves to 500 by the CSS
 * font-matching rules, which is the lightest weight Finanza sets headings in -
 * so older pages pick up the template's heavier headings without per-page edits.
 *
 * Scoped to marketing entry points rather than the root layout's <body>: the
 * 80 authenticated dashboard/admin/member/enterprise/reminder routes never
 * render font-display, and a root-level font would preload-hint on all of them
 * (docs/audits/optimization-2026-09). SiteHeader also exposes the variable at
 * the document root, so public pages without their own wrapper still get it.
 */
export const displayFont = Jost({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});
