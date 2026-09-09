import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { ROUTES } from '@/components/marketing/routes';

export const metadata: Metadata = {
  title: 'Enterprise',
  description:
    'Kitabu Yetu for institutions managing multiple groups, branches or programs — ' +
    'portfolio oversight, programs, funding and disbursements, without flattening any group’s own book.',
};

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
    <PageShell
      title="Enterprise"
      description="For institutions running more than one group — centralized oversight without flattening any group's own book."
    >
      <p>
        NGOs, federations and umbrella bodies rarely oversee a single chama or SACCO —
        they run dozens, each with its own officers, its own meeting calendar, and its
        own ledger that needs to stay exactly that: its own. The Enterprise portal
        gives an institution one login and a portfolio view across every group it
        supports, without merging any group&apos;s books into another&apos;s.
      </p>

      <h2>What&apos;s live today</h2>
      <ul className="ml-5 list-disc space-y-2">
        <li>Multi-group registration under a single organization account, with branches.</li>
        <li>A portfolio overview across every group you support, separate from any individual group&apos;s dashboard.</li>
        <li>Programs with their own budget and criteria, and the groups enrolled in each.</li>
        <li>Funding and disbursements — money out to the groups you back, drawn against a budget and held to a second approver.</li>
        <li>Reports: budget variance across programs, and spend broken down by donor.</li>
        <li>Organization staff accounts with defined roles, one-time-code sign-in, and an audit trail of what they did.</li>
        <li>Your own logo and colours on what the organization sends out.</li>
        <li>Per-group visibility for the organization, per-group privacy for the group&apos;s own members.</li>
      </ul>

      <h2>Where this is heading</h2>
      <p>
        API keys and webhooks, for institutions that want to connect Kitabu Yetu into
        their own systems. The screens are designed but the issuance and delivery
        backend is not built — so this is genuinely not available yet, and we would
        rather say so here than let you find out after signing up.
      </p>

      <div className="flex flex-wrap gap-3 pt-4">
        <Link
          href={ROUTES.contact}
          className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          Talk to us about Enterprise
        </Link>
        <Link
          href={ROUTES.orgPortal}
          className="rounded-md border border-brand-blue-900/15 px-5 py-2.5 text-sm font-semibold text-brand-blue-900 transition-colors hover:bg-paper-deep"
        >
          Sign in to the Enterprise portal
        </Link>
      </div>
    </PageShell>
  );
}
