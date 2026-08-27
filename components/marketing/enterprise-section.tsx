import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { ENTERPRISE_FEATURES } from './content';
import { ROUTES } from './routes';

/**
 * The organization-facing half of the platform, given its own section rather
 * than a line inside the product grid.
 *
 * This is deliberately an `ink` section: it is the one B2B moment on a page
 * that otherwise speaks to a group treasurer, and the ground change is what
 * separates the two audiences without a second landing page.
 *
 * Both CTAs go to public pages. `ROUTES.enterprise` is /enterprise-solutions,
 * NOT ROUTES.orgPortal ('/enterprise') — that path is the authenticated
 * portal, and pointing a prospect at it puts a sign-in wall where a pitch
 * should be. See the comment on ROUTES.enterprise in routes.ts.
 */
export function EnterpriseSection() {
  return (
    <Section tone="ink" labelledBy="enterprise-heading">
      <Container>
        <RevealedHeading
          id="enterprise-heading"
          tone="dark"
          eyebrow="For organizations managing multiple groups"
          title="One organization. Many groups."
          emphasis="One connected view"
          trailing="."
          lede="NGOs, CBOs, federations, SACCO networks and development programs rarely support a single group. Enterprise brings them into one account — without merging anybody’s books into anybody else’s."
        />

        <ul className="mt-16 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {ENTERPRISE_FEATURES.map((feature, i) => (
            <Reveal as="li" key={feature.title} delay={i * 55}>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15">
                <feature.icon aria-hidden="true" className="h-4 w-4 text-brand-400" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-white">{feature.title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-brand-blue-100/65">
                {feature.body}
              </p>
            </Reveal>
          ))}
        </ul>

        <Reveal className="mt-14 border-t border-white/10 pt-10">
          <p className="max-w-2xl font-display text-xl font-light leading-snug text-white sm:text-2xl">
            Groups keep their own books.{' '}
            <em className="italic text-brand-400">
              Organizations get the visibility they need.
            </em>
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href={ROUTES.enterprise}
              className="group inline-flex items-center justify-center gap-2 rounded-md bg-brand-500 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-900/30 transition-colors hover:bg-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-blue-900"
            >
              Explore Enterprise
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              href={ROUTES.contact}
              className="inline-flex items-center justify-center rounded-md border border-white/20 px-7 py-3.5 text-base font-medium text-white/90 transition-colors hover:border-white/35 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-blue-900"
            >
              Talk to our team
            </Link>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}

export default EnterpriseSection;
