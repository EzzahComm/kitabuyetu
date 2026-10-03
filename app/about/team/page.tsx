import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { ROUTES } from '@/components/marketing/routes';
import { FinanzaHeading, FinanzaSection, btnPrimary } from '@/components/marketing/finanza';
import { FounderCard, JoinTeamCard } from '@/components/marketing/kitabu-sections';

export const metadata: Metadata = marketingMetadata({
  path: '/about/team',
  title: 'Our Team',
  description: 'The people and expertise behind Kitabu Yetu.',
});

/**
 * Only the founder is named here, with a real photo. Everyone else stays
 * unnamed until there's an approved bio and headshot for them too -
 * inventing named staff with fabricated headshots would misrepresent real
 * humans behind the product, which is worse than describing the team's
 * discipline in the aggregate, as the rest of this page still does. The
 * Finanza team grid's other slots point to open roles instead.
 */
export default function TeamPage() {
  return (
    <PageShell
      title="Our Team"
      description="The people building Kitabu Yetu."
      crumbs={[{ label: 'About', href: ROUTES.about }]}
      layout="sections"
    >
      <FinanzaSection className="pt-8 lg:pt-12">
        <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
          <FounderCard />
          <JoinTeamCard />
        </div>
      </FinanzaSection>

      <FinanzaSection labelledBy="building-heading" className="bg-brand-50/60">
        <div className="mx-auto max-w-3xl space-y-5 leading-relaxed text-finanza-text">
          <FinanzaHeading
            id="building-heading"
            pill="How we work"
            title="What the team is building toward"
            className="mb-8"
          />
          <p>
            Kitabu Yetu is built by a small team based in Nairobi, working close to the chamas, SACCOs and welfare
            groups the platform serves - the same groups whose treasurers still balance a paper book by hand, or a
            spreadsheet three officers share by WhatsApp.
          </p>
          <p>
            The team spans software engineering, accounting and product design, with a shared discipline: nothing ships
            on the public site or inside the product that the platform cannot actually back. That rule governs the
            ledger as much as it governs this page.
          </p>
          <p>
            A platform that treats a chama&apos;s books with the same rigor a bank applies to its own - double-entry
            accounting, an audit trail, role-based approvals - while staying simple enough that a group&apos;s first
            contribution is recorded the same day it registers.
          </p>
          <p>
            More individual profiles are on the way. Until they&apos;re ready, the fastest way to talk to someone on the
            team is directly.
          </p>
          <div className="flex flex-col gap-3 pt-2 sm:flex-row">
            <Link href={ROUTES.contact} className={btnPrimary}>
              Contact the team
            </Link>
            <Link
              href={ROUTES.careers}
              className="inline-flex min-h-12 items-center justify-center font-medium text-brand-500 hover:text-brand-700"
            >
              See open roles →
            </Link>
          </div>
        </div>
      </FinanzaSection>
    </PageShell>
  );
}
