import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { ROUTES } from '@/components/marketing/routes';

export const metadata: Metadata = {
  title: 'Enterprise',
  description: 'Kitabu Yetu for institutions managing multiple groups, branches or programs.',
};

/**
 * The public pitch for the organization portal at ROUTES.orgPortal
 * ('/enterprise'). That path is the real, logged-in product — this page is
 * where a prospect lands first, since an unauthenticated visitor hitting
 * '/enterprise' directly would only see a sign-in screen, not a description
 * of what they're signing in to.
 *
 * Multi-group oversight is real (shipped 2026-08-15) and this page is
 * grounded in it. Portfolio-level reporting, funding management and public
 * APIs describe the direction the enterprise portal is growing into, not
 * every screen inside it today.
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
        <li>Multi-group registration under a single organization account.</li>
        <li>A dedicated Enterprise portal, separate from any individual group&apos;s dashboard.</li>
        <li>Per-group visibility for the organization, per-group privacy for the group&apos;s own members.</li>
      </ul>

      <h2>Where this is heading</h2>
      <p>
        Deeper portfolio reporting across every supported group, funding and disbursement
        management for organizations that move money to the groups they back, and APIs for
        institutions that want to connect Kitabu Yetu into their own systems.
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
          className="rounded-md border border-brand-blue-900/15 px-5 py-2.5 text-sm font-semibold text-brand-blue-900 transition-colors hover:bg-paper"
        >
          Sign in to the Enterprise portal
        </Link>
      </div>
    </PageShell>
  );
}
