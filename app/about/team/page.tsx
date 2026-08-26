import type { Metadata } from 'next';
import { PageShell } from '@/components/marketing/page-shell';

export const metadata: Metadata = {
  title: 'Our Team',
  description: 'The people and expertise behind Kitabu Yetu.',
};

/**
 * Deliberately no named individuals, titles, or photographs. This site has
 * zero licensed photography and no approved bio copy for specific people —
 * inventing named executives with fabricated headshots would misrepresent
 * real humans behind the product, which is a different and worse problem
 * than optimistic product copy. This page describes the team's discipline
 * and focus instead; replace with real profiles the moment they exist.
 */
export default function TeamPage() {
  return (
    <PageShell
      title="Our Team"
      description="The people building Kitabu Yetu."
    >
      <p>
        Kitabu Yetu is built by a small team based in Nairobi, working close to the
        chamas, SACCOs and welfare groups the platform serves — the same groups whose
        treasurers still balance a paper book by hand, or a spreadsheet three officers
        share by WhatsApp.
      </p>
      <p>
        The team spans software engineering, accounting and product design, with a
        shared discipline: nothing ships on the public site or inside the product that
        the platform cannot actually back. That rule governs the ledger as much as it
        governs this page.
      </p>
      <h2>What the team is building toward</h2>
      <p>
        A platform that treats a chama&apos;s books with the same rigor a bank applies to
        its own — double-entry accounting, an audit trail, role-based approvals — while
        staying simple enough that a group&apos;s first contribution is recorded the same
        day it registers.
      </p>
      <p>
        Individual profiles are on the way. Until they&apos;re ready, the fastest way to
        talk to someone on the team is directly — see <a href="/contact">Contact</a>.
      </p>
    </PageShell>
  );
}
