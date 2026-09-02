import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { DividedCard, DividedGrid, PillLink } from './astrolus';
import { VALUE_PILLARS } from './content';
import { SECTION_IDS } from './routes';

/**
 * The value proposition, in the four terms a group recognises: Members,
 * Money, Payments, Reports.
 *
 * Built on Astrolus's divided grid — one bordered slab with hairline-separated
 * cells — rather than four floating cards. On a page that already alternates
 * two light grounds, a single object reads more cleanly than four shadows.
 *
 * The full module list lives in ProductShowcase further down; this is the
 * answer to "what is it", not "what does it include".
 */
export function SolutionGrid() {
  return (
    <Section id={SECTION_IDS.solution} tone="paper-deep" labelledBy="solution-heading">
      <Container>
        <RevealedHeading
          id="solution-heading"
          eyebrow="What Kitabu Yetu is"
          title="Your group’s records."
          emphasis="Finally in one place"
          trailing="."
          lede="Running a group should be about building together — not spending meeting after meeting checking notebooks, spreadsheets and M-Pesa statements against each other."
        />

        <Reveal className="mt-14 lg:mt-20">
          <DividedGrid cols={4}>
            {VALUE_PILLARS.map((pillar) => (
              <DividedCard
                key={pillar.title}
                icon={<pillar.icon aria-hidden="true" className="h-5 w-5" />}
                title={pillar.title}
                body={pillar.body}
              />
            ))}
          </DividedGrid>
        </Reveal>

        <Reveal className="mt-10 flex justify-center">
          <PillLink href={`/#${SECTION_IDS.howItWorks}`} variant="outline" withArrow>
            See how it works
          </PillLink>
        </Reveal>
      </Container>
    </Section>
  );
}

export default SolutionGrid;
