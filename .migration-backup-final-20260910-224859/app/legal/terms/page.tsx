import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { ROUTES } from '@/components/marketing/routes';

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  robots: { index: false, follow: true },
};

/**
 * Deliberately no drafted terms. This product moves real money — inventing
 * plausible-sounding legal text here would be worse than no page at all;
 * see docs/audits/HERO_BRIEF_CLAIM_AUDIT_2026-08.md, which found the same
 * reasoning already applied to Privacy/DPA claims. The route exists so the
 * footer link resolves and the page is unambiguous about its own status —
 * it does not pretend to be a policy.
 */
export default function TermsPage() {
  return (
    <PageShell title="Terms & Conditions">
      <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700">
        This page is a placeholder. Kitabu Yetu&apos;s Terms &amp; Conditions have not
        been drafted or published yet — nothing below should be read as a legal
        agreement.
      </div>
      <p>
        Kitabu Yetu is actively working with legal counsel to publish real Terms &amp;
        Conditions covering account creation, group registration, payments, and use of
        the platform. Until that document is published, no terms are in effect beyond
        what applicable law already requires.
      </p>
      <p>
        Questions in the meantime go to <Link href={ROUTES.contact}>Contact</Link>.
      </p>
    </PageShell>
  );
}
