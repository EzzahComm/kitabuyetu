import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
 * The marketing surface's layout vocabulary.
 *
 * Everything public composes from these four pieces, so the vertical rhythm,
 * the measure, and the heading scale are decided ONCE here rather than being
 * retyped as ad-hoc `py-20 md:py-32` / `max-w-7xl px-4 sm:px-6 lg:px-8` pairs
 * in every section — which is exactly how the previous landing page ended up
 * with three different heading sizes and two different container widths that
 * all looked almost right.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The one measure for public pages. Wider than the app's, with more air. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[82rem] px-5 sm:px-8 lg:px-10', className)}>{children}</div>;
}

/**
 * Section grounds. The page alternates `paper` (white) with `paper-deep` (a
 * cool #F8FAFC) and drops to `ink` for the two navy moments — M-Pesa and
 * Enterprise — plus the final call to action.
 *
 * `paper` and `white` resolve to the SAME colour since the ground moved from
 * cream to white (2026-08-26). `white` is kept only so existing callers keep
 * compiling; prefer `paper` for the marketing ground and `paper-deep` for the
 * step down. Two adjacent sections must never share a tone — that is the only
 * thing separating them, as this site uses no section borders.
 */
