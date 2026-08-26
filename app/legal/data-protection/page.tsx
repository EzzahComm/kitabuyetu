import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { ROUTES } from '@/components/marketing/routes';

export const metadata: Metadata = {
  title: 'Data Protection',
  robots: { index: false, follow: true },
};

/** See app/legal/privacy/page.tsx. This page exists to hold the footer link,
 *  not to assert ODPC registration or DPA 2019 compliance — that marker was
 *  found and removed once already for being false; see
 *  docs/audits/HERO_BRIEF_CLAIM_AUDIT_2026-08.md. Do not add it back here
 *  without the actual registration existing first. */
export default function DataProtectionPage() {
  return (
    <PageShell title="Data Protection">
      <div className="rounded-lg border border-brand-orange-100 bg-brand-orange-50 px-4 py-3 text-sm font-medium text-brand-orange-700">
        This page is a placeholder. Kitabu Yetu is not yet registered with the Office of
        the Data Protection Commissioner (ODPC), and nothing below should be read as a
        claim of compliance with Kenya&apos;s Data Protection Act, 2019.
      </div>
      <p>
        Data protection registration and a full compliance program are in progress.
        Until that work is complete and published here, treat this page as a statement
        of intent, not a certification.
      </p>
      <p>
        Questions in the meantime go to <Link href={ROUTES.contact}>Contact</Link>.
      </p>
    </PageShell>
  );
}
