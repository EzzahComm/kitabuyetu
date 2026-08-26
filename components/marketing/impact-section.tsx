import Link from 'next/link';
import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { IMPACT_STATS } from './content';
import { ROUTES } from './routes';

/**
 * Section — impact. Every value in IMPACT_STATS is a placeholder em-dash;
 * see the note on that array in content.ts. This section exists as a slot
 * for real figures, not to imply figures exist today.
 */
export function ImpactSection() {
  return (
    <Section tone="paper-deep" labelledBy="impact-heading">
      <Container>
        <RevealedHeading
          id="impact-heading"
          eyebrow="Impact"
          title="What digitizing group administration is"
          emphasis="changing."
          align="center"
          lede={
            <>
              Real figures, pulled from the same ledger the platform runs on — published{' '}
              here the moment there is a track record worth reporting. See{' '}
              <Link href={ROUTES.aboutImpact} className="font-medium text-brand-orange-700 hover:underline">
                the full impact page
              </Link>.
            </>
          }
        />

        <div className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-5">
          {IMPACT_STATS.map((stat, i) => (
            <Reveal key={stat.label} delay={i * 60}>
              <div className="rounded-lg border border-brand-blue-900/10 bg-white px-3 py-6 text-center">
                <p className="font-display text-3xl font-light text-brand-blue-900">{stat.value}</p>
                <p className="mt-2 text-[0.6875rem] font-medium uppercase leading-snug tracking-wide text-brand-blue-900/50">
                  {stat.label}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

export default ImpactSection;
