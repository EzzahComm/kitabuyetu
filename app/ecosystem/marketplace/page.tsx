import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { ROUTES } from '@/components/marketing/routes';

export const metadata: Metadata = {
  title: 'Marketplace',
  description: 'Connecting groups with relevant products, services and financial partners. Coming soon.',
};

export default function MarketplacePage() {
  return (
    <PageShell
      title="Marketplace"
      description="Products, services and financial partners for groups — coming soon."
    >
      <div className="rounded-lg border border-brand-orange-100 bg-brand-orange-50 px-4 py-3 text-sm font-medium text-brand-orange-700">
        Coming soon. This part of the ecosystem is not available yet.
      </div>

      <p>
        A group with a clean, verifiable financial history has earned access to things a
        group with a lost paper book has not — better loan terms, insurance, supplier
        credit, the kind of financial products usually reserved for individuals with a
        formal credit record. The marketplace is where that access is meant to live:
        relevant products and partners, connected to a group through the same ledger
        that already proves its track record.
      </p>

      <h2>What we are building towards</h2>
      <ul className="ml-5 list-disc space-y-2">
        <li>Financial partners offering products matched to a group&apos;s real record, not a guess.</li>
        <li>Suppliers and service providers relevant to community groups.</li>
        <li>Opportunities surfaced to a group, not a group having to go looking for them.</li>
      </ul>

      <div className="flex flex-wrap gap-3 pt-4">
        <Link
          href={ROUTES.contact}
          className="rounded-md border border-brand-blue-900/15 px-5 py-2.5 text-sm font-semibold text-brand-blue-900 transition-colors hover:bg-paper"
        >
          Talk to us about partnering
        </Link>
      </div>
    </PageShell>
  );
}
