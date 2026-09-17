import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';

const TITLE = 'Fundraise / Changi$ha';
const DESCRIPTION =
  'Digital fundraising and collections for communities, groups and causes across East Africa. Coming soon to Kitabu Yetu.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.co.ke'}/fundraise`,
  },
  // Without its own openGraph block a page fully inherits the root layout's
  // (title/description included, not auto-derived from this page's own) —
  // so a link to /fundraise shared on social media showed the generic
  // homepage preview instead of this page's own.
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { title: TITLE, description: DESCRIPTION },
};

/**
 * Fundraise / Changi$ha — the third digital tool, NOT yet built.
 *
 * Deliberately a coming-soon page with no signup, no pricing and no waitlist
 * form: there is no fundraising backend, no product record, and nothing to
 * charge for. A page that collected details or quoted a price would be
 * promising something the platform cannot currently do. When the product is
 * real this page gets the same treatment as /bookkeeper and /chama-reminder.
 */
export default function FundraisePage() {
  return (
    <PageShell
      title="Fundraise / Changi$ha"
      description="Digital fundraising and collections — coming soon."
    >
      <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700">
        Coming soon. This tool is not available yet.
      </div>

      <p>
        Changi$ha will bring digital fundraising to the same place a group already keeps
        its books and talks to its members — for weddings, funerals, medical appeals,
        school fees, church and community projects, and the many other causes East
        African communities raise money for together. It is planned as a standalone
        fundraising product that can also connect into Kitabu Yetu for groups and
        organizations that want both.
      </p>

      <h2>What we are building towards</h2>
      <ul className="ml-5 list-disc space-y-2">
        <li>Public campaign pages for a cause, organization, group or individual, with a clear target and a running total.</li>
        <li>Contributions by M-Pesa and other digital payment options, credited and reconciled automatically.</li>
        <li>A transparent record every contributor can see — not a screenshot of a bank statement.</li>
        <li>Donor tracking and fundraising reports for the organizer running the campaign.</li>
        <li>Payouts to the organiser with the same controls the rest of the platform uses.</li>
        <li>An API for organizations that want to run Changi$ha campaigns from their own systems.</li>
        <li>White-label campaign pages for organizations that want their own brand on the page a donor sees.</li>
      </ul>

      <p>
        We are not taking signups for this yet. In the meantime,{' '}
        <Link href="/bookkeeper">Kitabu Yetu Bookkeeper</Link> and{' '}
        <Link href="/chama-reminder">Chama Reminder</Link> are both live.
      </p>

      <div className="flex flex-wrap gap-3 pt-4">
        <Link
          href="/contact"
          className="rounded-md border border-brand-blue-900/15 px-5 py-2.5 text-sm font-semibold text-brand-blue-900 transition-colors hover:bg-paper-deep"
        >
          Talk to us about Changi$ha
        </Link>
      </div>
    </PageShell>
  );
}
