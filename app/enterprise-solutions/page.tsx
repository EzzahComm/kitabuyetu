import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { CONTACT, ROUTES } from '@/components/marketing/routes';
import { marketingMetadata } from '@/components/marketing/page-metadata';

export const metadata: Metadata = marketingMetadata({
  path: '/enterprise-solutions',
  title: 'Multi-Group Management for Institutions & NGOs',
  description:
    'Kitabu Yetu for SACCOs, NGOs and institutions running many groups or programs: portfolio oversight, funding and disbursements, each group keeping its own book.',
});

/**
 * The public pitch for the Enterprise portal at ROUTES.orgPortal
 * ('/enterprise'). That path is the real, logged-in product — this page is
 * where a prospect lands first, since an unauthenticated visitor hitting
 * '/enterprise' directly would only see a sign-in screen, not a description
 * of what they're signing in to.
 *
 * The "live today" list below was three bullets until 2026-08-27, while nine
 * real screens were already shipping — it named funding management and
 * reporting as future work when both were built. Every bullet now maps to a
 * screen in `app/(enterprise)/enterprise/` backed by one of the 35 live
 * `/api/admin/organization*` routes.
 *
 * APIs and webhooks stay under "where this is heading", and that is NOT
 * caution — the `api-keys` screen is a mock that imports seed rows from
 * `_data`, with no issuance or delivery backend behind it. Do not promote it
 * on the strength of the screen existing.
 */
export default function EnterpriseSolutionsPage() {
  return (
    <PageShell title="Enterprise" description="Every group you support. One dashboard. Each group keeps its own book.">
      <p>
        NGOs, federations and SACCO networks support dozens of groups, each with its own officers and its own books.
        Enterprise gives you one login and a live view across all of them — without mixing anyone&apos;s books.
      </p>

      <h2>What you get today</h2>
      <ul className="ml-5 list-disc space-y-2">
        <li>All your groups and branches under one account.</li>
        <li>A portfolio dashboard across every group you support.</li>
        <li>Programmes with their own budget, criteria and enrolled groups.</li>
        <li>Funding sent to your groups against a budget, with a second approver.</li>
        <li>Reports: budget vs actual, and spend by donor.</li>
        <li>Staff roles, one-time-code sign-in, and a record of every action.</li>
        <li>Your logo and colours on everything you send.</li>
        <li>You see each group&apos;s progress; members&apos; personal records stay private.</li>
      </ul>

      <h2>Coming next</h2>
      <p>
        Connecting Kitabu Yetu to your own systems. It isn&apos;t available yet — and we&apos;d rather tell you now than
        after you sign up.
      </p>

      <div className="flex flex-wrap gap-3 pt-4">
        <Link
          href="/register-organization"
          // !text-white: PageShell's prose wrapper sets `[&_a]:text-brand-500`
          // on every link, which — being a two-part selector — outranks a
          // plain `text-white` utility and silently repaints this button's
          // text blue-on-blue.
          className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold !text-white transition-colors hover:bg-brand-700"
        >
          Create your Enterprise account
        </Link>
        <Link
          href={ROUTES.contact}
          className="rounded-md border border-brand-100 px-5 py-2.5 text-sm font-semibold !text-finanza-dark transition-colors hover:bg-brand-50/60"
        >
          Book a demo
        </Link>
        <Link
          href={ROUTES.orgPortal}
          className="rounded-md border border-brand-100 px-5 py-2.5 text-sm font-semibold !text-finanza-dark transition-colors hover:bg-brand-50/60"
        >
          Sign in to the Enterprise portal
        </Link>
      </div>
      <p className="pt-2 text-sm text-finanza-text">
        Or email our enterprise team directly:{' '}
        <a
          href={`mailto:${CONTACT.enterpriseEmail}?subject=${encodeURIComponent('Enterprise enquiry')}`}
          className="font-medium text-brand-700 underline-offset-4 hover:underline"
        >
          {CONTACT.enterpriseEmail}
        </a>
      </p>
    </PageShell>
  );
}
