import type { Metadata } from 'next';
import Image from 'next/image';
import { PageShell } from '@/components/marketing/page-shell';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import founderPhoto from '@/public/img/team/polycap-wanyonyi.png';

export const metadata: Metadata = marketingMetadata({
  path: '/about/team',
  title: 'Our Team',
  description: 'The people and expertise behind Kitabu Yetu.',
});

/**
 * Only the founder is named here, with a real photo. Everyone else stays
 * unnamed until there's an approved bio and headshot for them too —
 * inventing named staff with fabricated headshots would misrepresent real
 * humans behind the product, which is worse than describing the team's
 * discipline in the aggregate, as the rest of this page still does.
 */
export default function TeamPage() {
  return (
    <PageShell title="Our Team" description="The people building Kitabu Yetu.">
      <div className="flex flex-col items-center gap-5 border-b border-brand-blue-900/10 pb-10 text-center sm:flex-row sm:items-center sm:text-left">
        <Image
          src={founderPhoto}
          alt="Polycap Wanyonyi, Founder of Kitabu Yetu"
          className="h-28 w-28 shrink-0 rounded-full object-cover"
          sizes="112px"
        />
        <div>
          <p className="text-xl font-semibold text-brand-blue-900">Polycap Wanyonyi</p>
          <p className="text-brand-blue-900/60">Founder, Kitabu Yetu</p>
        </div>
      </div>
      <p>
        Kitabu Yetu is built by a small team based in Nairobi, working close to the chamas, SACCOs and welfare groups
        the platform serves — the same groups whose treasurers still balance a paper book by hand, or a spreadsheet
        three officers share by WhatsApp.
      </p>
      <p>
        The team spans software engineering, accounting and product design, with a shared discipline: nothing ships on
        the public site or inside the product that the platform cannot actually back. That rule governs the ledger as
        much as it governs this page.
      </p>
      <h2>What the team is building toward</h2>
      <p>
        A platform that treats a chama&apos;s books with the same rigor a bank applies to its own — double-entry
        accounting, an audit trail, role-based approvals — while staying simple enough that a group&apos;s first
        contribution is recorded the same day it registers.
      </p>
      <p>
        More individual profiles are on the way. Until they&apos;re ready, the fastest way to talk to someone on the
        team is directly — see <a href="/contact">Contact</a>.
      </p>
    </PageShell>
  );
}
