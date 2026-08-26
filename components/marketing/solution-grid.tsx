import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { CAPABILITIES } from './content';
import { SECTION_IDS } from './routes';

/**
 * Section 4 — what the product actually does, in six pieces.
 *
 * Six equal cards would flatten the story, so the grid is asymmetric: the
 * first two (savings and loans — the reasons a group exists) take the wide
 * top row, the remaining four sit beneath at normal weight.
 */
export function SolutionGrid() {
  const [lead, second, ...rest] = CAPABILITIES;

  return (
    <Section id={SECTION_IDS.solution} tone="white" labelledBy="solution-heading">
      <Container>
        <RevealedHeading
          id="solution-heading"
          eyebrow="What Kitabu Yetu is"
          title="One digital book for"
          emphasis="your entire group"
          trailing="."
          lede="Everything a group needs to run its money, in one place your members can reach — and nothing it does not."
        />

        <div className="mt-14 grid gap-5 lg:mt-20 lg:grid-cols-2">
          {[lead, second].map((item, i) => (
            <Reveal
              key={item.title}
              delay={i * 80}
              className="flex flex-col rounded-2xl bg-paper p-8 ring-1 ring-brand-blue-900/[0.08] transition-shadow duration-300 hover:shadow-[0_20px_50px_-32px_rgba(4,22,47,0.4)] lg:p-10"
            >
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 ring-1 ring-brand-500/20">
                <item.icon aria-hidden="true" className="h-5 w-5 text-brand-600" />
              </span>
              <h3 className="mt-6 font-display text-2xl font-normal text-brand-blue-900">
                {item.title}
              </h3>
              <p className="mt-3 max-w-md text-base leading-relaxed text-brand-blue-900/65">
                {item.body}
              </p>
            </Reveal>
          ))}
        </div>

        <div className="mt-5 grid gap-px overflow-hidden rounded-2xl bg-brand-blue-900/[0.09] ring-1 ring-brand-blue-900/[0.09] sm:grid-cols-2 lg:grid-cols-4">
          {rest.map((item, i) => (
            <Reveal
              key={item.title}
              delay={i * 60}
              className="group bg-white p-7 transition-colors duration-300 hover:bg-paper"
            >
              <item.icon
                aria-hidden="true"
                className="h-5 w-5 text-brand-600 transition-transform duration-300 group-hover:-translate-y-0.5"
              />
              <h3 className="mt-5 text-base font-semibold text-brand-blue-900">{item.title}</h3>
              <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-brand-blue-900/60">
                {item.body}
              </p>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

export default SolutionGrid;
