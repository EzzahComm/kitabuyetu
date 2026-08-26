import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { ROUTES } from '@/components/marketing/routes';

export const metadata: Metadata = {
  title: 'Multigroup Organizations',
  description: 'One login, every group and branch your organization runs.',
};

export default function MultigroupOrganizationsPage() {
  return (
    <PageShell
      title="Multigroup Organizations"
      description="For institutions managing multiple groups, branches, chapters, VSLAs, chamas or SACCOs from one place."
    >
      <p>
        Federations, NGOs and umbrella bodies run this way as a matter of course — a
        network of groups, each with its own officers and its own book, that still
        needs to be visible from the center. Kitabu Yetu&apos;s multi-group support gives an
        organization one login and a portfolio view across every group it oversees,
        while each group keeps its own ledger, private to its own members.
      </p>
      <p>
        This is one of the more established parts of the ecosystem — multi-group
        registration is live, and an existing member can found a second group under the
        same identity without re-registering from scratch.
      </p>
      <div className="flex flex-wrap gap-3 pt-4">
        <Link
          href={ROUTES.enterprise}
          className="rounded-md bg-brand-orange-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-700"
        >
          See Enterprise
        </Link>
        <Link
          href={ROUTES.ecosystem}
          className="rounded-md border border-brand-blue-900/15 px-5 py-2.5 text-sm font-semibold text-brand-blue-900 transition-colors hover:bg-paper"
        >
          Back to the ecosystem
        </Link>
      </div>
    </PageShell>
  );
}
