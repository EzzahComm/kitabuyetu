import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { CONTACT, ROUTES } from '@/components/marketing/routes';

export const metadata: Metadata = {
  title: 'Data Protection',
  robots: { index: false, follow: true },
};

/**
 * Anchors into the published Privacy Policy (ids come from
 * components/marketing/legal-document.tsx's slugifyHeading). This page only
 * points at owner-supplied text; it does not restate or extend it.
 */
const PRIVACY_SECTIONS = [
  { label: 'Your privacy rights', id: '3-your-privacy-rights' },
  { label: 'Access to your personal information', id: '21-access-to-your-personal-information' },
  { label: 'Correction of personal information', id: '22-correction-of-personal-information' },
  { label: 'Deletion of personal information', id: '23-deletion-of-personal-information' },
  { label: 'Data portability', id: '24-data-portability' },
  { label: 'Data security', id: '19-data-security' },
  { label: 'Data protection contact', id: '32-data-protection-contact' },
] as const;

/** See app/legal/privacy/page.tsx. This page exists to hold the footer link,
 *  not to assert ODPC registration or DPA 2019 compliance — that marker was
 *  found and removed once already for being false; see
 *  docs/audits/HERO_BRIEF_CLAIM_AUDIT_2026-08.md. Do not add it back here
 *  without the actual registration existing first. */
export default function DataProtectionPage() {
  return (
    <PageShell title="Data Protection" crumbs={[{ label: 'Legal', href: ROUTES.legal }]}>
      <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700">
        This page is a placeholder. Kitabu Yetu is not yet registered with the Office of the Data Protection
        Commissioner (ODPC), and nothing below should be read as a claim of compliance with Kenya&apos;s Data Protection
        Act, 2019.
      </div>
      <p>
        Data protection registration and a full compliance program are in progress. Until that work is complete and
        published here, treat this page as a statement of intent, not a certification.
      </p>
      <h2>Where to find how your data is handled today</h2>
      <p>
        The <Link href={ROUTES.legalPrivacy}>Privacy Policy</Link> is the published statement of what we collect, why,
        and the rights you have over it. The sections most people are looking for:
      </p>
      <ul className="list-disc space-y-1.5 pl-6">
        {PRIVACY_SECTIONS.map((section) => (
          <li key={section.id}>
            <Link href={`${ROUTES.legalPrivacy}#${section.id}`}>{section.label}</Link>
          </li>
        ))}
      </ul>
      <p>
        Questions in the meantime go to <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> or the{' '}
        <Link href={ROUTES.contact}>Contact</Link> page.
      </p>
    </PageShell>
  );
}
