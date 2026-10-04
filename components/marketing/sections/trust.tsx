import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { CONTROLS, HOME_FAQS } from '../content';
import { FinanzaHeading, FinanzaSection, Pill, btnOutline, btnPrimary } from '../finanza';
import { JsonLd, faqPageJsonLd } from '../json-ld';
import { Container } from '../primitives';
import { Reveal } from '../reveal';
import { ROUTES } from '../routes';

/** Shipped controls only — see the note on CONTROLS. Dark band so it reads as its own moment. */
export function TrustSection({ id }: { id?: string }) {
  return (
    <section id={id} aria-labelledby="trust-heading" className="scroll-mt-28 bg-finanza-dark py-16 lg:py-24">
      <Container>
        <div className="mb-12 grid items-end gap-8 lg:grid-cols-2">
          <Reveal>
            <Pill tone="dark">Security & Trust</Pill>
            <h2
              id="trust-heading"
              className="font-display text-[2rem] font-bold leading-[1.15] text-white sm:text-[2.5rem] xl:text-5xl"
            >
              Built for money that belongs to many.
            </h2>
          </Reveal>
          <Reveal delay={150}>
            <p className="text-lg leading-relaxed text-brand-100/85">
              Trust is the whole point. Every control below is live today.
            </p>
          </Reveal>
        </div>
        <ul className="grid gap-px overflow-hidden rounded-lg bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
          {CONTROLS.map((control) => (
            <li key={control.title} className="bg-finanza-dark p-7">
              <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-brand-500">
                <control.icon aria-hidden="true" className="h-5 w-5 text-white" />
              </span>
              <h3 className="font-display text-xl font-semibold text-white">{control.title}</h3>
              <p className="mt-2 leading-relaxed text-brand-100/80">{control.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/**
 * Native <details> accordion: works without JavaScript, and the FAQPage
 * JSON-LD is generated from the same HOME_FAQS array so the two cannot drift.
 */
export function FaqSection({ id }: { id?: string }) {
  return (
    <FinanzaSection id={id} labelledBy="faq-heading" className="bg-brand-50/60">
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <FinanzaHeading
            id="faq-heading"
            pill="FAQ"
            title="Questions groups ask us first."
            lede="Still unsure? Ask us on WhatsApp — we speak treasurer."
          />
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href={ROUTES.support} className={btnPrimary}>
              Visit Support
            </Link>
            <Link href={ROUTES.pricing} className={btnOutline}>
              See Pricing
            </Link>
          </div>
        </div>
        <div className="space-y-4">
          {HOME_FAQS.map(([question, answer], i) => (
            <details
              key={question}
              open={i === 0}
              className="group rounded-lg border border-brand-100 bg-white px-6 py-5 open:border-brand-500"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-display text-lg font-semibold text-finanza-dark [&::-webkit-details-marker]:hidden">
                {question}
                <ChevronDown
                  aria-hidden="true"
                  className="mt-1 h-5 w-5 shrink-0 text-brand-500 transition-transform duration-300 group-open:rotate-180"
                />
              </summary>
              <p className="mt-3 leading-relaxed text-finanza-text">{answer}</p>
            </details>
          ))}
        </div>
      </div>
      <JsonLd data={faqPageJsonLd(HOME_FAQS)} />
    </FinanzaSection>
  );
}
