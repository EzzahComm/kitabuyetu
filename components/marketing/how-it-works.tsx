import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { STEPS } from './content';
import { ROUTES, SECTION_IDS } from './routes';

/**
 * Section 7 — the six-step journey: Create, Organize, Automate, Collect,
 * Communicate, Grow (STEPS in content.ts).
 *
 * Six items don't fit one row cleanly the way the previous four did, so this
 * is a plain card grid (left rail on mobile, 2 rows of 3 from lg up) rather
 * than the earlier single connecting rule — a horizontal line drawn across
 * two rows would visually connect steps that aren't actually adjacent.
 */
export function HowItWorks() {
  return (
    <Section id={SECTION_IDS.howItWorks} tone="paper-deep" labelledBy="how-heading">
      <Container>
        <RevealedHeading
          id="how-heading"
          eyebrow="Getting started"
          title="Six steps, and the book"
          emphasis="is open"
          trailing="."
          lede="No migration project, no consultant, no training week. Most groups are recording their first contribution the same day."
        />

        <ol className="relative mt-16 grid gap-10 sm:grid-cols-2 lg:mt-20 lg:grid-cols-3 lg:gap-x-10 lg:gap-y-14">
          {STEPS.map((step, i) => (
            <Reveal
              as="li"
              key={step.title}
              delay={i * 70}
              className="relative pl-16 sm:pl-0"
            >
              <span
                aria-hidden="true"
                className="absolute left-0 top-0 flex h-11 w-11 items-center justify-center rounded-full border border-brand-blue-900/12 bg-paper font-mono text-[13px] font-medium tabular-nums text-brand-700 sm:static sm:mb-6 sm:flex"
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="font-display text-xl font-normal leading-snug text-brand-blue-900 sm:mt-0">
                <span className="sr-only">Step {i + 1}: </span>
                {step.title}
              </h3>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-brand-blue-900/60">
                {step.body}
              </p>
            </Reveal>
          ))}
        </ol>

        <Reveal className="mt-16 flex flex-col items-start gap-4 border-t border-brand-blue-900/10 pt-10 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-base text-brand-blue-900/65">
            Bring the register you already keep — members and past contributions import
            from a spreadsheet.
          </p>
          <Link
            href={ROUTES.startGroup}
            className="group inline-flex shrink-0 items-center gap-2 rounded-md bg-brand-600 px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-paper-deep"
          >
            Start your group
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </Reveal>
      </Container>
    </Section>
  );
}

export default HowItWorks;
