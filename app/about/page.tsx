import type { Metadata } from 'next';
import { Container } from '@/components/Container';
import { SectionTitle } from '@/components/SectionTitle';
import { Cta } from '@/components/Cta';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Why Kitabu Yetu exists, who builds it, and what it has changed for the groups using it.',
};

/**
 * About Kitabu Yetu — the company story, team positioning, and impact claim.
 *
 * Expanded from the template to include three sections (Our Story, Team, Impact)
 * and wrapped with SiteHeader/SiteFooter, following the pattern the rest of the
 * marketing site uses.
 */
export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <main id="main" className="flex-1">
        <div id="our-story">
          <SectionTitle
            preTitle="Our Story"
            title="Most groups already keep good records"
            titleAs="h1"
          >
            The trouble was never discipline. It was where the records lived — one
            cash book in one person&apos;s handwriting, a spreadsheet three
            officers all need at once, and an M-Pesa statement somebody matches to
            a list of names the evening before every meeting.
          </SectionTitle>

          <Container className="mb-20">
            <div className="mx-auto max-w-3xl text-center text-lg leading-relaxed text-brand-blue-900/70">
              Kitabu Yetu was built to put those three things in one place: the
              members, the money and the payments, on a ledger that has to balance
              before it saves. The group keeps doing what it already does. The book
              just stops being something one person carries.
            </div>
          </Container>
        </div>

        <div id="team">
          <SectionTitle preTitle="Team" title="A product built across the community">
            Kitabu Yetu brings together product, engineering, operations and
            community knowledge. The people who use the platform are part of the
            feedback loop, not an audience we design around from a distance.
          </SectionTitle>
          <Container className="mb-20">
            <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-3">
              {[
                [
                  'Community',
                  'Listen to treasurers, officials and members before we decide what to build.',
                ],
                [
                  'Product',
                  'Turn complicated group workflows into steps people can understand and repeat.',
                ],
                [
                  'Trust',
                  'Treat financial records, permissions and communication as responsibilities, not details.',
                ],
              ].map(([title, description]) => (
                <div key={title} className="border-t-2 border-brand-600 pt-5">
                  <h3 className="text-xl font-semibold text-brand-blue-900">{title}</h3>
                  <p className="mt-3 leading-relaxed text-brand-blue-900/65">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </Container>
        </div>

        <div id="impact">
          <SectionTitle preTitle="Impact" title="Measure what becomes easier">
            We will publish verified numbers as the platform grows. Until then,
            our standard is practical: records close on time, members can see
            their own activity, and organizations can act on figures they can
            trace back to a group.
          </SectionTitle>
          <Container className="mb-20">
            <div className="mx-auto max-w-3xl space-y-6 border-y border-brand-blue-900/10 py-8">
              <div className="grid gap-6 md:grid-cols-3">
                {[
                  [
                    'Manage',
                    'Members, contributions, loans, welfare and group activity.',
                  ],
                  [
                    'Understand',
                    'Reports and insights that explain where the money went.',
                  ],
                  [
                    'Grow',
                    'A clearer track record for funding, products and opportunity.',
                  ],
                ].map(([label, description]) => (
                  <div key={label}>
                    <p className="font-semibold text-brand-blue-900">{label}</p>
                    <p className="mt-2 text-brand-blue-900/65">{description}</p>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </div>

        <Cta />
      </main>
      <SiteFooter />
    </div>
  );
}
