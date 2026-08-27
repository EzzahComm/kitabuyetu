import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { PAIN_POINTS } from './content';

/**
 * Section 3 — the problem, stated plainly.
 *
 * Laid out as a hairline-divided grid rather than four floating cards: the
 * point of the section is that these are four faces of one situation, and a
 * shared rule says that better than four drop shadows.
 */
export function ProblemSection() {
  return (
    <Section tone="paper-deep" labelledBy="problem-heading">
      <Container>
        <RevealedHeading
          id="problem-heading"
          eyebrow="The way it works now"
          title="Running a group shouldn’t feel like"
          emphasis="running a spreadsheet"
          trailing="."
          lede="Most groups already keep good records. The trouble is where those records live — and who can reach them when it matters."
        />

        <ul className="mt-14 grid gap-px overflow-hidden rounded-2xl bg-brand-blue-900/10 ring-1 ring-brand-blue-900/10 sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
          {PAIN_POINTS.map((point, i) => (
            <Reveal
              as="li"
              key={point.title}
              delay={i * 70}
              className="group bg-paper p-7 transition-colors duration-300 hover:bg-brand-50 lg:p-8"
            >
              <point.icon
                aria-hidden="true"
                className="h-6 w-6 text-brand-blue-900/35 transition-colors duration-300 group-hover:text-brand-600"
              />
              <h3 className="mt-6 font-display text-xl font-normal text-brand-blue-900">
                {point.title}
              </h3>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-brand-blue-900/60">
                {point.body}
              </p>
            </Reveal>
          ))}
        </ul>
      </Container>
    </Section>
  );
}

export default ProblemSection;
