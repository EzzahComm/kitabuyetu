import { Container } from './primitives';
import { Reveal } from './reveal';

/**
 * Astrolus's logo strip beneath the hero — deliberately EMPTY.
 *
 * The theme ships this slot filled with Microsoft, Airbnb, Google, GE and
 * Netflix logos. Those are the theme author's placeholders, and publishing
 * them here would be a straightforward lie about who uses Kitabu Yetu, so
 * the slot renders its own empty state instead and waits for real ones.
 *
 * Same rule as IMPACT_STATS in content.ts, which renders an em-dash rather
 * than an invented figure: an honest blank beats a confident fabrication.
 *
 * TO FILL THIS IN: drop logo files into `public/logos/`, then replace the
 * placeholder block below with the grid that is already written out in the
 * comment there. Keep `grayscale hover:grayscale-0` — that is the theme's
 * own treatment and it stops a row of mismatched brand colours from pulling
 * attention off the hero.
 */
export function SocialProof() {
  return (
    <section aria-labelledby="social-proof-heading" className="bg-paper pb-16 pt-4 md:pb-20">
      <Container>
        <Reveal>
          <h2
            id="social-proof-heading"
            className="text-center font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-brand-blue-900/45"
          >
            Built for Kenyan groups, on Kenyan rails
          </h2>

          {/*
            The real grid, for when logos exist:

            <ul className="mt-10 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6">
              {LOGOS.map((logo) => (
                <li key={logo.name} className="p-4">
                  <Image src={logo.src} alt={logo.name} width={120} height={48}
                         className="mx-auto h-10 w-auto grayscale transition duration-200 hover:grayscale-0" />
                </li>
              ))}
            </ul>
          */}
          <div className="mt-8 rounded-2xl border border-dashed border-brand-blue-900/15 bg-paper-deep px-6 py-10 text-center">
            <p className="text-[0.9375rem] leading-relaxed text-brand-blue-900/55">
              Partner and customer logos go here once we have permission to show them.
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-brand-blue-900/45">
              We would rather leave this empty than fill it with names that have not
              agreed to appear.
            </p>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

export default SocialProof;
