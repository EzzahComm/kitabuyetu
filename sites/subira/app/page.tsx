import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HeroCarousel } from '@/components/hero-carousel';
import { FinanzaHeading, FinanzaSection } from '@/components/finanza';
import { Reveal } from '@/components/reveal';
import { ABOUT_ITEMS, HOME_SECTIONS } from '@/lib/content';

export default function Home() {
  return (
    <main id="main">
      <HeroCarousel />
      <FinanzaSection id="about" labelledBy="about-heading">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <FinanzaHeading
            id="about-heading"
            pill="Who We Are"
            title="About Subira International"
            lede="Our full website is being prepared."
          />
          <ul className="grid gap-3 sm:grid-cols-2">
            {ABOUT_ITEMS.slice(1).map(({ href, label }) => (
              <Reveal key={href} as="li" className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3">
                <h3 id={href.split('#')[1]} className="scroll-mt-28 font-display text-lg font-semibold">
                  {label}
                </h3>
              </Reveal>
            ))}
          </ul>
        </div>
      </FinanzaSection>
      <FinanzaSection className="bg-brand-50" labelledBy="explore-heading">
        <FinanzaHeading id="explore-heading" title="Explore Subira" align="center" />
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {HOME_SECTIONS.map(({ id, title, description }) => (
            <article key={id} id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-28">
              <Reveal className="h-full rounded-lg border border-brand-100 bg-white p-6">
                <h3 id={`${id}-heading`} className="font-display text-2xl font-semibold">
                  {title}
                </h3>
                <p className="mt-2 leading-relaxed text-finanza-text">{description}</p>
                {id === 'donate' && (
                  <Link
                    href="/#contact"
                    className="mt-4 inline-flex items-center gap-2 font-medium text-brand-600 hover:underline"
                  >
                    Contact <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                )}
              </Reveal>
            </article>
          ))}
        </div>
      </FinanzaSection>
    </main>
  );
}
