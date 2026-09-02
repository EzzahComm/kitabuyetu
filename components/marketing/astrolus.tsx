import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
 * The Astrolus layout vocabulary, rebuilt on Kitabu Yetu's tokens.
 *
 * Astrolus (Tailus UI, MIT) is an Astro theme — its `.astro` files cannot run
 * in this Next.js app, so what is borrowed here is the LAYOUT SYSTEM, not the
 * code: the ambient glow behind a centred hero, pill-shaped actions, and the
 * bordered/divided card grid that is the theme's most recognisable device.
 *
 * Deliberately NOT borrowed: its indigo/purple palette (we lead with the
 * logo's green), its dark-mode variants (this surface is light-only), and its
 * `before:`-pseudo button construction, which exists to animate a background
 * independently of the label — we get the same effect from a plain
 * background transition without the extra element.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The soft colour wash Astrolus floats behind its hero. Two offset blurred
 * fields rather than one, so the gradient reads as depth instead of a single
 * flat halo. Purely decorative and always aria-hidden.
 */
export function AmbientGlow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 grid grid-cols-2 -space-x-52 opacity-30',
        className,
      )}
    >
      <div className="h-56 bg-gradient-to-br from-brand-400 to-brand-blue-400 blur-[106px]" />
      <div className="h-32 bg-gradient-to-r from-brand-300 to-brand-blue-300 blur-[106px]" />
    </div>
  );
}

type PillVariant = 'solid' | 'soft' | 'outline';

const PILL_VARIANT: Record<PillVariant, string> = {
  solid:   'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
  soft:    'bg-brand-500/10 text-brand-800 hover:bg-brand-500/15',
  outline: 'border border-brand-blue-900/15 text-brand-blue-900 hover:bg-paper-deep',
};

/**
 * Astrolus's action shape: a full-height pill that goes full-width on mobile
 * and hugs its label from `sm` up. `active:scale-95` is the theme's own press
 * feedback, kept because it makes a large flat button feel physical.
 */
export function PillLink({
  href, children, variant = 'solid', withArrow = false, className,
}: {
  href: string;
  children: ReactNode;
  variant?: PillVariant;
  withArrow?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-7',
        'text-[0.9375rem] font-semibold transition-all duration-300',
        'hover:scale-[1.03] active:scale-95 motion-reduce:hover:scale-100 motion-reduce:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
        PILL_VARIANT[variant],
        'sm:w-max',
        className,
      )}
    >
      {children}
      {withArrow && (
        <ArrowRight
          aria-hidden="true"
          className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
        />
      )}
    </Link>
  );
}

/**
 * The theme's signature grid: one rounded, bordered slab whose cells are
 * separated by shared hairlines rather than by gaps, so the whole block reads
 * as a single object. `overflow-hidden` is what lets the outer radius clip the
 * corner cells — without it the children square off the corners.
 *
 * `divide-y` is dropped at the `lg` breakpoint the same way Astrolus does it,
 * because on one row the horizontal rules would be stray.
 */
export function DividedGrid({
  children, cols = 4, className,
}: {
  children: ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid overflow-hidden rounded-3xl border border-brand-blue-900/10',
        'divide-x divide-y divide-brand-blue-900/10',
        cols === 2 && 'sm:grid-cols-2 sm:divide-y-0',
        cols === 3 && 'sm:grid-cols-2 lg:grid-cols-3 lg:divide-y-0',
        cols === 4 && 'sm:grid-cols-2 lg:grid-cols-4 lg:divide-y-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A cell of `DividedGrid`. Lifts on hover with `hover:z-[1]` so its shadow
 * paints OVER the neighbouring hairlines instead of being clipped by them —
 * that z-index is the whole trick behind the effect.
 */
export function DividedCard({
  icon, title, body, href, linkText, badge,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  href?: string;
  linkText?: string;
  badge?: ReactNode;
}) {
  const inner = (
    <div className="relative space-y-6 p-8 py-11">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 text-brand-700">
          {icon}
        </span>
        {badge}
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-brand-blue-900 transition-colors group-hover:text-brand-700">
          {title}
        </h3>
        <p className="text-[0.9375rem] leading-relaxed text-brand-blue-900/65">{body}</p>
      </div>

      {href && linkText && (
        <span className="flex items-center justify-between text-brand-blue-900/70 transition-colors group-hover:text-brand-700">
          <span className="text-sm font-medium">{linkText}</span>
          {/* Astrolus's arrow reveal: parked left and invisible, sliding in on
              hover. Hidden from assistive tech — the link text already says
              where this goes. */}
          <ArrowRight
            aria-hidden="true"
            className="h-5 w-5 -translate-x-4 opacity-0 transition duration-300 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:translate-x-0 motion-reduce:opacity-100"
          />
        </span>
      )}
    </div>
  );

  const shell = 'group relative bg-paper transition duration-300 hover:z-[1] hover:shadow-2xl hover:shadow-brand-blue-900/10';

  return href ? (
    <Link
      href={href}
      className={cn(shell, 'block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500')}
    >
      {inner}
    </Link>
  ) : (
    <div className={shell}>{inner}</div>
  );
}
