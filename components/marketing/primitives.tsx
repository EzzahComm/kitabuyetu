import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Reveal } from './reveal';

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
  return (
    <div className={cn('mx-auto w-full max-w-[82rem] px-5 sm:px-8 lg:px-10', className)}>
      {children}
    </div>
  );
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
export type SectionTone = 'paper' | 'paper-deep' | 'white' | 'ink';

const TONE_CLASS: Record<SectionTone, string> = {
  paper:        'bg-paper text-brand-blue-900',
  'paper-deep': 'bg-paper-deep text-brand-blue-900',
  white:        'bg-white text-brand-blue-900',
  ink:          'bg-brand-blue-900 text-white',
};

interface SectionProps {
  children:   ReactNode;
  /** Anchor target — also what the header's in-page links point at. */
  id?:        string;
  tone?:      SectionTone;
  /** Removes the standard vertical padding when a section paints its own. */
  flush?:     boolean;
  className?: string;
  /** Accessible name for the section landmark. */
  labelledBy?: string;
}

export function Section({
  children, id, tone = 'paper', flush = false, className, labelledBy,
}: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        'relative isolate',
        TONE_CLASS[tone],
        !flush && 'py-20 md:py-28 lg:py-32',
        id && 'scroll-mt-20',
        className,
      )}
    >
      {children}
    </section>
  );
}

/**
 * The ruled-book texture. Kitabu Yetu is "our ledger", and the dark sections
 * carry the faint horizontal rules of an account book instead of the gradient
 * mesh every other fintech site reaches for. Purely decorative.
 */
export function LedgerRules({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 -z-10 opacity-[0.055]', className)}
      style={{
        backgroundImage:
          'repeating-linear-gradient(to bottom, transparent 0, transparent 39px, currentColor 39px, currentColor 40px)',
      }}
    />
  );
}

interface SectionHeadingProps {
  /** Small mono kicker above the headline. */
  eyebrow?: string;
  /** Plain text before the emphasised phrase. */
  title:    ReactNode;
  /** Rendered in italic brand colour, then the trailing text. */
  emphasis?: string;
  trailing?: string;
  lede?:    ReactNode;
  id?:      string;
  tone?:    'dark' | 'light';
  align?:   'left' | 'center';
  className?: string;
  /** Render as h1 (hero pages) rather than the default h2. */
  as?:      'h1' | 'h2';
}

/**
 * One heading block for the whole site: mono eyebrow, large Fraunces headline
 * with a single italic phrase, and an optional lede. The italic phrase is the
 * site's signature — used once per section and never twice in one headline.
 */
export function SectionHeading({
  eyebrow, title, emphasis, trailing, lede, id, tone = 'light',
  align = 'left', className, as = 'h2',
}: SectionHeadingProps) {
  const Heading = as;
  const dark = tone === 'dark';
  return (
    <div
      className={cn(
        'max-w-3xl',
        align === 'center' && 'mx-auto text-center',
        className,
      )}
    >
      {eyebrow && (
        <p
          className={cn(
            'mb-5 font-mono text-[11px] font-medium uppercase tracking-[0.24em]',
            dark ? 'text-brand-orange-400' : 'text-brand-orange-700',
          )}
        >
          {eyebrow}
        </p>
      )}
      <Heading
        id={id}
        className={cn(
          'font-display font-light tracking-tight',
          as === 'h1'
            ? 'text-[2.75rem] leading-[1.02] sm:text-6xl lg:text-[4.25rem]'
            : 'text-[2.125rem] leading-[1.06] sm:text-[2.75rem] lg:text-[3.25rem]',
          dark ? 'text-white' : 'text-brand-blue-900',
        )}
      >
        {title}
        {emphasis && (
          <>
            {' '}
            <em
              className={cn(
                'italic font-normal',
                dark ? 'text-brand-orange-400' : 'text-brand-orange-700',
              )}
            >
              {emphasis}
            </em>
          </>
        )}
        {trailing}
      </Heading>
      {lede && (
        <p
          className={cn(
            'mt-6 text-lg leading-relaxed sm:text-[1.175rem]',
            align === 'center' && 'mx-auto',
            dark ? 'text-brand-blue-100/70' : 'text-brand-blue-900/65',
          )}
        >
          {lede}
        </p>
      )}
    </div>
  );
}

/** Heading block that fades in as it is scrolled to. */
export function RevealedHeading(props: SectionHeadingProps) {
  return (
    <Reveal>
      <SectionHeading {...props} />
    </Reveal>
  );
}

/**
 * The ledger-entry number that labels showcase rows and process steps —
 * `01`, `02`, … set in the mono face at display size.
 */
export function EntryNumber({ n, tone = 'light' }: { n: number; tone?: 'dark' | 'light' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'font-mono text-sm font-medium tabular-nums tracking-[0.2em]',
        tone === 'dark' ? 'text-brand-orange-400/80' : 'text-brand-orange-700',
      )}
    >
      {String(n).padStart(2, '0')}
    </span>
  );
}
