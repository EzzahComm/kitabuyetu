import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { ROUTES } from '@/components/marketing/routes';
import { marketingMetadata } from '@/components/marketing/page-metadata';

export const metadata: Metadata = marketingMetadata({
  path: '/ecosystem/organizations',
  title: 'Multigroup Organizations',
  description: 'One login, every group and branch your organization runs.',
});

export default function MultigroupOrganizationsPage() {
  return (
    <PageShell
      title="Multigroup Organizations"
      description="For institutions managing multiple groups, branches, chapters, VSLAs, chamas or SACCOs from one place."
    >
      <p>
        Federations, NGOs and umbrella bodies run this way as a matter of course - a network of groups, each with its
        own officers and its own book, that still needs to be visible from the center. Kitabu Yetu&apos;s multi-group
        support gives an organization one login and a portfolio view across every group it oversees, while each group
        keeps its own ledger, private to its own members.
      </p>
      <p>
        This is one of the more established parts of the ecosystem - multi-group registration is live, and an existing
        member can found a second group under the same identity without re-registering from scratch.
      </p>
      <div className="flex flex-wrap gap-3 pt-4">
        <Link
          href={ROUTES.enterprise}
          // !text-white: PageShell's prose wrapper sets `[&_a]:text-brand-500`
          // on every link, which - being a two-part selector - outranks a
          // plain `text-white` utility and silently repaints this button's
          // text blue-on-blue.
          className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold !text-white transition-colors hover:bg-brand-700"
        >
          See Enterprise
        </Link>
        <Link
          href={ROUTES.ecosystem}
          className="rounded-md border border-brand-100 px-5 py-2.5 text-sm font-semibold !text-finanza-dark transition-colors hover:bg-brand-50/60"
        >
          Back to the ecosystem
        </Link>
      </div>
    </PageShell>
  );
}
