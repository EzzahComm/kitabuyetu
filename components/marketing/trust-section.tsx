import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { CONTROLS } from './content';

/**
 * Section 10 — transparency and trust.
 *
 * Ruled rows rather than cards. Six shadowed tiles saying "secure" is the
 * visual language of a page that has nothing specific to point at; a plain
 * ruled list reads like a specification, which is what this is. Every line
 * names a mechanism that exists in the product today — see content.ts.
 */
export function TrustSection() {
  return (
    <Section tone="paper" labelledBy="trust-heading">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
          {/* The sticky element is this wrapper, not the heading block itself:
              the reveal animation leaves a transform on the inner node, and a
              transform on the sticky element's own box is the one thing that
              reliably breaks it. */}
          <div className="lg:sticky lg:top-28 lg:self-start">
            <RevealedHeading
              id="trust-heading"
              eyebrow="Transparency"
              title="Everyone knows where"
              emphasis="the money goes"
              trailing="."
              lede="A group’s money is held on trust, and trust survives on evidence. These are the controls that produce it."
              className="max-w-none"
            />
          </div>

          <ul className="grid gap-x-10 sm:grid-cols-2">
            {CONTROLS.map((control, i) => (
              <Reveal
                as="li"
                key={control.title}
                delay={i * 55}
                className="border-t border-brand-blue-900/12 py-7 first:border-t-0 first:pt-0 sm:[&:nth-child(2)]:border-t-0 sm:[&:nth-child(2)]:pt-0"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10">
                  <control.icon aria-hidden="true" className="h-4 w-4 text-brand-700" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-brand-blue-900">
                  {control.title}
                </h3>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-brand-blue-900/60">
                  {control.body}
                </p>
              </Reveal>
            ))}
          </ul>
        </div>
      </Container>
    </Section>
  );
}

export default TrustSection;
