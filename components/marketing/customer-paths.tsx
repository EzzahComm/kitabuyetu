import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { CUSTOMER_PATHS } from './content';

/**
 * The self-selection fork: a visitor should be able to tell which half of the
 * platform is theirs without reading the rest of the page.
 *
 * Two cards only, and each carries exactly one CTA — the whole point is to
 * remove a choice, so offering a second action inside either card would undo
 * it. The audience chips are the real segments named in CUSTOMER_PATHS; they
 * are labels, not links, because there is no per-segment page behind them and
 * a chip that looks clickable and isn't is worse than a plain one.
 */
export function CustomerPaths() {
  return (
    <Section tone="paper-deep" labelledBy="paths-heading">
      <Container>
        <RevealedHeading
          id="paths-heading"
          align="center"
          eyebrow="Two ways in"
          title="Who is"
          emphasis="Kitabu Yetu"
          trailing=" for?"
          lede="One platform for groups. One view for organizations."
          className="mx-auto"
        />

        <div className="mt-16 grid gap-6 lg:grid-cols-2 lg:gap-8">
          {CUSTOMER_PATHS.map((path, i) => (
            <Reveal key={path.eyebrow} delay={i * 80}>
              <div className="flex h-full flex-col rounded-2xl border border-brand-blue-900/12 bg-white p-8 sm:p-10">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-orange-500/10">
                  <path.icon aria-hidden="true" className="h-5 w-5 text-brand-orange-700" />
                </span>

                <p className="mt-6 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-brand-orange-700">
                  {path.eyebrow}
                </p>

                <h3 className="mt-3 font-display text-2xl font-light leading-tight tracking-tight text-brand-blue-900">
                  {path.title}
                </h3>

                <p className="mt-4 text-[0.9375rem] leading-relaxed text-brand-blue-900/65">
                  {path.body}
                </p>

                <ul className="mt-6 flex flex-wrap gap-2">
                  {path.audience.map((segment) => (
                    <li
                      key={segment}
                      className="rounded-full border border-brand-blue-900/12 px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-brand-blue-900/60"
                    >
                      {segment}
                    </li>
                  ))}
                </ul>

                {/* mt-auto pins the CTA to the bottom so both cards' buttons
                    line up even when the copy above them differs in length. */}
                <Link
                  href={path.href}
                  className="group mt-auto inline-flex w-fit items-center gap-2 rounded-md bg-brand-orange-500 px-6 py-3 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500 focus-visible:ring-offset-2"
                >
                  {path.linkText}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

export default CustomerPaths;
