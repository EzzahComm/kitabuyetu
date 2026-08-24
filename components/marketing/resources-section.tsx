import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { RESOURCES } from './content';

/**
 * Section 11 — where to go next.
 *
 * The brief called for an editorial "stories" strip. This repository has no
 * blog, no CMS and no articles, so what ships is an honest index of the pages
 * that DO exist, in the same editorial card treatment. Six invented headlines
 * linking to nowhere would have looked richer and been a lie — and dead links
 * are the specific failure this site has already had once.
 */
export function ResourcesSection() {
  return (
    <Section tone="white" labelledBy="resources-heading">
      <Container>
        <RevealedHeading
          id="resources-heading"
          eyebrow="Resources"
          title="Read a little more before"
          emphasis="you commit"
          trailing="."
          lede="What each product covers, what is running right now, and how to reach a person in Nairobi."
        />

        <ul className="mt-14 grid gap-px overflow-hidden rounded-2xl bg-brand-blue-900/[0.09] ring-1 ring-brand-blue-900/[0.09] sm:grid-cols-2 lg:mt-20 lg:grid-cols-3">
          {RESOURCES.map((item, i) => (
            <Reveal as="li" key={item.href} delay={i * 55} className="bg-white">
              <Link
                href={item.href}
                className="group flex h-full flex-col p-8 transition-colors duration-300 hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
              >
                <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-brand-600">
                  {item.kind}
                </span>
                <span className="mt-5 flex items-start justify-between gap-4">
                  <span className="font-display text-xl font-normal leading-snug text-brand-blue-900">
                    {item.title}
                  </span>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="mt-1 h-4 w-4 shrink-0 text-brand-blue-900/25 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600"
                  />
                </span>
                <span className="mt-3 text-[0.9375rem] leading-relaxed text-brand-blue-900/60">
                  {item.body}
                </span>
              </Link>
            </Reveal>
          ))}
        </ul>
      </Container>
    </Section>
  );
}

export default ResourcesSection;
