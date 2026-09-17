import { Fraunces } from 'next/font/google';

/**
 * Editorial display serif for the marketing surface ("Kitabu Yetu" = "our
 * ledger"), read via the `font-display` Tailwind utility (tailwind.config.ts).
 *
 * Scoped to marketing entry points (this module, imported by page-shell.tsx
 * and the handful of marketing pages with their own independent root
 * wrapper) rather than the root layout's <body> — every one of the 80
 * authenticated dashboard/admin/member/enterprise/reminder routes never
 * renders font-display, yet the root-layout version preload-hinted this
 * 117.9KB font on all of them anyway (docs/audits/optimization-2026-09).
 */
export const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['opsz', 'SOFT'],
});
