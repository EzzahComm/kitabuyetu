import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Container, LedgerRules, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { ECOSYSTEM_PILLARS } from './content';
import { ROUTES, SECTION_IDS } from './routes';

const FLOW = ['Groups', 'Organizations', 'Donors', 'Programs', 'Marketplace'];

/**
 * Section — the ecosystem diagram. Dark ground, same as the hero, so the
 * "bigger picture" section reads visually distinct from the product-grounded
 * sections around it. The flow row is the brief's own framing
 * (Groups ↔ Organizations ↔ Donors ↔ Programs ↔ Marketplace); the cards below
 * it are ECOSYSTEM_PILLARS, so the diagram and the detail never drift apart.
 */
export function EcosystemSection() {
  return (
    <Section id={SECTION_IDS.ecosystem} tone="ink" labelledBy="ecosystem-heading" className="overflow-hidden">
      <LedgerRules className="text-white" />
      <Container>
        <RevealedHeading
          id="ecosystem-heading"
          eyebrow="The bigger picture"
          title="One book, connected to"
          emphasis="a wider ecosystem."
          tone="dark"
          align="center"
          lede="Kitabu Yetu starts with a group's own ledger. The ecosystem is where that ledger connects outward — to the organizations that oversee groups, the donors that fund them, and the programs and partners around them."
        />

        <Reveal className="mx-auto mt-14 flex max-w-4xl flex-wrap items-center justify-center gap-x-2 gap-y-3">
          {FLOW.map((node, i) => (
            <div key={node} className="flex items-center gap-2">
              <span className="rounded-full border border-brand-orange-500/30 bg-brand-orange-500/10 px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-brand-orange-300">
                {node}
              </span>
              {i < FLOW.length - 1 && (
                <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-white/25" />
              )}
            </div>
          ))}
        </Reveal>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ECOSYSTEM_PILLARS.map((pillar, i) => (
            <Reveal key={pillar.href} delay={i * 80}>
              <Link
                href={pillar.href}
                className="group flex h-full flex-col rounded-xl border border-white/10 p-5 transition-colors hover:border-brand-orange-400/40 hover:bg-white/[0.03]"
              >
                <div className="flex items-start justify-between gap-2">
                  <pillar.icon aria-hidden="true" className="h-5 w-5 text-brand-orange-400" />
                  {pillar.status === 'vision' && (
                    <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/60">
                      Coming soon
                    </span>
                  )}
                </div>
                <h3 className="mt-4 text-[0.9375rem] font-semibold text-white">{pillar.title}</h3>
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-brand-blue-100/60">{pillar.body}</p>
              </Link>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-12 text-center">
          <Link
            href={ROUTES.ecosystem}
            className="text-sm font-semibold text-brand-orange-400 transition-colors hover:text-brand-orange-300"
          >
            Explore the full ecosystem →
          </Link>
        </Reveal>
      </Container>
    </Section>
  );
}

export default EcosystemSection;
