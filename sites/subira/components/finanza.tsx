import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Container } from './primitives';
import { Reveal } from './reveal';

const focusRing =
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2';

/** `.btn.btn-primary.py-3.px-5` */
export const btnPrimary = cn(
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-500 px-8 py-3 text-base font-medium text-white transition-colors duration-500 hover:bg-brand-600',
  focusRing,
);

/** `.btn.btn-outline-primary` */
export const btnOutline = cn(
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-brand-500 px-8 py-3 text-base font-medium text-brand-500 transition-colors duration-500 hover:bg-brand-500 hover:text-white',
  focusRing,
);

/** The small bordered label above every Finanza heading ("About Us", "Our Services"…). */
export function Pill({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'dark' }) {
  return (
    <p
      className={cn(
        'mb-4 inline-block rounded-lg border px-3 py-1 text-[0.9375rem] font-medium',
        tone === 'dark' ? 'border-white/60 text-white' : 'border-brand-100 text-brand-500',
      )}
    >
      {children}
    </p>
  );
}

interface FinanzaHeadingProps {
  pill?: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: 'left' | 'center';
  as?: 'h1' | 'h2';
  id?: string;
  className?: string;
}

/** Pill + `.display-5` heading (+ optional lede) — the opening of nearly every Finanza section. */
export function FinanzaHeading({ pill, title, lede, align = 'left', as = 'h2', id, className }: FinanzaHeadingProps) {
  const Heading = as;
  return (
    <Reveal className={cn(align === 'center' && 'mx-auto max-w-[40rem] text-center', className)}>
      {pill && <Pill>{pill}</Pill>}
      <Heading
        id={id}
        className="font-display text-[2rem] font-bold leading-[1.15] text-finanza-dark sm:text-[2.5rem] xl:text-5xl"
      >
        {title}
      </Heading>
      {lede && <p className="mt-5 text-base leading-relaxed text-finanza-text sm:text-lg">{lede}</p>}
    </Reveal>
  );
}

/** A Finanza content section: `.container-xxl.py-5`. */
export function FinanzaSection({
  children,
  id,
  className,
  labelledBy,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cn('scroll-mt-28 py-16 lg:py-24', className)}>
      <Container>{children}</Container>
    </section>
  );
}
