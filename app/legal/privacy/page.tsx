import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { ROUTES } from '@/components/marketing/routes';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  robots: { index: false, follow: true },
};

/** See app/legal/terms/page.tsx — same reasoning applies here, more acutely:
 *  this product handles members' personal and financial data, so a wrong or
 *  invented Privacy Policy is a direct liability, not a marketing choice. */
export default function PrivacyPage() {
  return (
    <PageShell title="Privacy Policy">
      <div className="rounded-lg border border-brand-orange-100 bg-brand-orange-50 px-4 py-3 text-sm font-medium text-brand-orange-700">
        This page is a placeholder. Kitabu Yetu&apos;s Privacy Policy has not been
        drafted or published yet — nothing below should be read as a statement of how
        data is collected, used or protected.
      </div>
      <p>
        Kitabu Yetu handles real personal and financial data for members, groups and
        organizations, and a real Privacy Policy — covering what is collected, how it is
        used, and members&apos; rights over it under Kenya&apos;s Data Protection Act — is
        being prepared with legal counsel before it is published here.
      </p>
      <p>
        In the meantime, what is true today: role-based access controls, an audit log
        for changes made in the system, and tenant isolation enforced at the database
        level so one group cannot see another&apos;s data. None of that is a substitute
        for a published policy, and none of it should be read as one.
      </p>
      <p>
        Questions in the meantime go to <Link href={ROUTES.contact}>Contact</Link>.
      </p>
    </PageShell>
  );
}
