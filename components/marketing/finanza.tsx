import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { CountUp } from './count-up';
import { Container } from './primitives';
import { Reveal } from './reveal';

/* ────────────────────────────────────────────────────────────────────────────
 * The Finanza template's visual vocabulary, as server components.
 *
 * Colours come from `brand-*`, which resolves to the Finanza palette on every
 * page that renders the marketing header (tailwind.config.ts), plus the fixed
 * `finanza-dark` / `finanza-text` neutrals. Bootstrap's `.btn-primary`,
 * `.page-header`, `.facts`, `.feature-box` etc. map to the pieces below.
 * ──────────────────────────────────────────────────────────────────────────── */

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

/** A white button for use on a primary-coloured band. */
export const btnOnPrimary = cn(
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-white px-8 py-3 text-base font-medium text-brand-500 transition-colors duration-500 hover:bg-brand-100',
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-500',
);

/** The template's 95% primary wash over its circle-and-dot pattern (`.facts`, `.callback::before`). */
export const patternBandStyle: CSSProperties = {
  backgroundImage:
    'linear-gradient(rgb(var(--brand-scale-500) / 0.95), rgb(var(--brand-scale-500) / 0.95)), url(/img/finanza/pattern.png)',
};

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

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Finanza's inner-page masthead (`.page-header`): a title and breadcrumb on
 * lavender waves. Deliberately compact — just clear of the fixed header, so
 * the page's own content starts above the fold. The template's version is a photo of two models; this
 * draws the same waves in SVG and keeps its decorative pattern, so no stock
 * people stand in for Kitabu Yetu's team.
 */
export function PageHeader({ title, lede, crumbs }: { title: string; lede?: ReactNode; crumbs?: Crumb[] }) {
  const trail: Crumb[] = [{ label: 'Home', href: '/' }, ...(crumbs ?? []), { label: title }];
  return (
    <div className="relative isolate overflow-hidden bg-white pb-10 pt-24 lg:pb-12 lg:pt-40">
      <svg
        aria-hidden="true"
        className="absolute inset-0 -z-10 h-full w-full"
        viewBox="0 0 1440 420"
        preserveAspectRatio="none"
      >
        <path
          className="fill-brand-100"
          d="M0 0H700C640 30 600 70 585 125C568 190 610 230 575 285C540 340 455 335 385 360C320 383 265 420 215 420H0Z"
        />
        <path
          className="fill-brand-100"
          d="M1440 95C1390 118 1362 160 1352 212C1340 272 1302 305 1255 334C1215 359 1196 395 1190 420H1440Z"
        />
      </svg>
      <div
        aria-hidden="true"
        className="absolute right-[6%] top-1/2 -z-10 hidden h-[180px] w-[360px] -translate-y-1/4 bg-contain bg-center bg-no-repeat opacity-50 lg:block"
        style={{ backgroundImage: 'url(/img/finanza/pattern.png)' }}
      />
      <Container>
        <div className="max-w-3xl">
          <h1 className="mb-3 font-display text-[2.25rem] font-bold leading-[1.1] text-finanza-dark motion-safe:animate-fade-up sm:text-[2.75rem] xl:text-5xl">
            {title}
          </h1>
          {lede && <p className="mb-4 max-w-2xl leading-relaxed text-finanza-text sm:text-lg">{lede}</p>}
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-medium">
              {trail.map((crumb, i) => (
                <li key={`${crumb.label}-${i}`} className="flex items-center gap-2">
                  {i > 0 && (
                    <span aria-hidden="true" className="text-finanza-text">
                      /
                    </span>
                  )}
                  {crumb.href ? (
                    <Link href={crumb.href} className="text-brand-500 transition-colors hover:text-brand-700">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-finanza-text">
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </Container>
    </div>
  );
}

export interface Fact {
  icon: LucideIcon;
  value: number;
  prefix?: string;
  label: string;
}

/** Finanza's `.facts` band: four counters on the primary-washed pattern. */
export function FactsBand({ facts, className }: { facts: Fact[]; className?: string }) {
  return (
    <section
      aria-label="Kitabu Yetu at a glance"
      className={cn('my-12 py-16 lg:py-24', className)}
      style={patternBandStyle}
    >
      <Container>
        <dl className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          {facts.map((fact, i) => (
            // column-reverse: DOM order is label → figure → icon (read in that order); main-end is the
            // top, so justify-end packs every column from the icon down and figures line up.
            <Reveal
              key={fact.label}
              delay={i * 120}
              className="flex flex-col-reverse items-center justify-end text-center"
            >
              <dt className="mt-2 text-lg text-white">
                {fact.label}
                <hr aria-hidden="true" className="mx-auto mt-4 w-1/4 border-white/40" />
              </dt>
              <dd className="font-display text-[2.75rem] font-bold leading-tight text-white xl:text-[3.5rem]">
                <CountUp value={fact.value} prefix={fact.prefix} />
              </dd>
              <fact.icon aria-hidden="true" className="mb-3 h-12 w-12 text-white" />
            </Reveal>
          ))}
        </dl>
      </Container>
    </section>
  );
}

interface FeatureBoxProps {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  href?: string;
  linkText?: string;
  className?: string;
}

/** `.feature-box`: bordered card that floods primary on hover, text turning white. */
export function FeatureBox({ icon: Icon, title, children, href, linkText = 'Read More', className }: FeatureBoxProps) {
  return (
    <div
      className={cn(
        'group relative rounded-lg border border-brand-100 bg-white p-6 transition-colors duration-500 hover:border-brand-500 hover:bg-brand-500',
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className="mb-4 h-10 w-10 text-brand-500 transition-colors duration-500 group-hover:text-white"
      />
      <h3 className="mb-3 font-display text-xl font-semibold text-finanza-dark transition-colors duration-500 group-hover:text-white">
        {title}
      </h3>
      <p className="text-finanza-text transition-colors duration-500 group-hover:text-white">{children}</p>
      {href && (
        <Link
          href={href}
          className="mt-4 inline-flex items-center gap-1.5 font-medium text-brand-500 transition-colors duration-500 after:absolute after:inset-0 after:rounded-lg group-hover:text-white focus-visible:outline-hidden focus-visible:after:ring-2 focus-visible:after:ring-brand-300"
        >
          {linkText} <span aria-hidden="true">→</span>
          <span className="sr-only"> about {title}</span>
        </Link>
      )}
    </div>
  );
}

/** A primary circle holding an icon — the About block's "No Hidden Cost / Dedicated Team" items. */
export function IconBadge({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-500', className)}>
      <Icon aria-hidden="true" className="h-5 w-5 text-white" />
    </span>
  );
}
