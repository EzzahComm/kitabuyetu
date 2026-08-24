import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Container, EntryNumber, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { SHOWCASE, type ShowcaseVisual } from './content';
import { SECTION_IDS } from './routes';
import {
  DashboardMockup, MessagesMockup, PaymentMockup, ReportsMockup,
} from './product-mockups';

function Visual({ kind }: { kind: ShowcaseVisual }) {
  switch (kind) {
    case 'ledger':   return <DashboardMockup />;
    case 'payment':  return <PaymentMockup />;
    case 'reports':  return <ReportsMockup />;
    case 'messages': return <MessagesMockup />;
  }
}

/**
 * Section 6 — the product itself, in four alternating rows.
 *
 * The row number is set as a ledger entry (`01`, `02`, …) against a hairline,
 * which is the device that ties this section to the process steps further
 * down without repeating the same card treatment a third time.
 */
export function ProductShowcase() {
  return (
    <Section id={SECTION_IDS.showcase} tone="paper" labelledBy="showcase-heading">
      <Container>
        <RevealedHeading
          id="showcase-heading"
          eyebrow="A closer look"
          title="Everything your group needs."
          emphasis="Nothing it doesn’t"
          trailing="."
        />

        <div className="mt-16 space-y-20 lg:mt-24 lg:space-y-28">
          {SHOWCASE.map((item, index) => {
            const flipped = index % 2 === 1;
            return (
              <article
                key={item.eyebrow}
                className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
              >
                <Reveal className={cn(flipped && 'lg:order-2')}>
                  <div className="flex items-center gap-4">
                    <EntryNumber n={index + 1} />
                    <span aria-hidden="true" className="h-px w-10 bg-brand-blue-900/15" />
                    <span className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-brand-blue-900/60">
                      {item.eyebrow}
                    </span>
                  </div>

                  <h3 className="mt-6 font-display text-[1.875rem] font-light leading-[1.1] tracking-tight text-brand-blue-900 sm:text-[2.25rem]">
                    {item.title}{' '}
                    <em className="italic font-normal text-brand-600">{item.emphasis}</em>
                  </h3>

                  <p className="mt-5 max-w-lg text-lg leading-relaxed text-brand-blue-900/65">
                    {item.body}
                  </p>

                  <ul className="mt-7 space-y-3">
                    {item.points.map((point) => (
                      <li key={point} className="flex items-start gap-3">
                        <Check
                          aria-hidden="true"
                          className="mt-1 h-4 w-4 shrink-0 text-brand-600"
                        />
                        <span className="text-[0.9375rem] leading-relaxed text-brand-blue-900/75">
                          {point}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {item.href && item.linkText && (
                    <Link
                      href={item.href}
                      className="group mt-8 inline-flex items-center gap-2 rounded-sm text-[0.9375rem] font-semibold text-brand-700 transition-colors hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 focus-visible:ring-offset-paper"
                    >
                      {item.linkText}
                      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                    </Link>
                  )}
                </Reveal>

                <Reveal delay={90} className={cn(flipped && 'lg:order-1')}>
                  <Visual kind={item.visual} />
                </Reveal>
              </article>
            );
          })}
        </div>
      </Container>
    </Section>
  );
}

export default ProductShowcase;
