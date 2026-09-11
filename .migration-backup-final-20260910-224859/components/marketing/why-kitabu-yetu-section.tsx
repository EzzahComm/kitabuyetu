import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { WHY_KITABU_YETU } from './content';

/**
 * Section — the eight-point case for the platform. Deliberately no numbered
 * badges here (unlike EntryNumber elsewhere) — these eight points are not a
 * sequence, they're independent reasons, and numbering them would imply an
 * order that doesn't exist.
 */
export function WhyKitabuYetuSection() {
  return (
    <Section tone="paper" labelledBy="why-heading">
      <Container>
        <RevealedHeading
          id="why-heading"
          eyebrow="Why Kitabu Yetu"
          title="Wherever your group is,"
          emphasis="this moves it forward."
          align="center"
        />

        <div className="mx-auto mt-14 grid max-w-5xl gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {WHY_KITABU_YETU.map((item, i) => (
            <Reveal key={item.title} delay={(i % 4) * 80}>
              <item.icon aria-hidden="true" className="h-6 w-6 text-brand-600" />
              <h3 className="mt-4 font-display text-lg font-normal text-brand-blue-900">{item.title}</h3>
              <p className="mt-2 text-[0.875rem] leading-relaxed text-brand-blue-900/60">{item.body}</p>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

export default WhyKitabuYetuSection;
