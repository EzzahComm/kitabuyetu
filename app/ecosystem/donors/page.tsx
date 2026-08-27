import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { ROUTES } from '@/components/marketing/routes';

export const metadata: Metadata = {
  title: 'Donors',
  description: 'A space for development partners and funders to discover, support and monitor groups and projects. Coming soon.',
};

/**
 * Vision page — no donor-facing feature exists in the product today. Coming
 * soon framing, matching /fundraise: describe the direction without
 * implying there is anything to sign up for yet.
 */
export default function DonorsPage() {
  return (
    <PageShell
      title="Donors"
      description="For development partners, funders and institutions that back community groups — coming soon."
    >
      <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700">
        Coming soon. This part of the ecosystem is not available yet.
      </div>

      <p>
        The same ledger a group already keeps its own books on is the most honest
        evidence a donor could ask for — real contributions, real loans, real welfare
        payouts, not a report compiled for the occasion. We&apos;re building toward a way
        for donors and development partners to see that evidence directly, for the
        groups and projects that choose to share it.
      </p>

      <h2>What we are building towards</h2>
      <ul className="ml-5 list-disc space-y-2">
        <li>A directory of qualifying groups and projects, opted in by the group itself.</li>
        <li>Real financial and activity records a donor can review, not a self-reported summary.</li>
        <li>Direct support and monitoring, without routing around the group&apos;s own leadership.</li>
      </ul>

      <p>
        In the meantime, organizations already overseeing multiple groups can use{' '}
        <Link href={ROUTES.enterprise}>Enterprise</Link> today.
      </p>

      <div className="flex flex-wrap gap-3 pt-4">
        <Link
          href={ROUTES.contact}
          className="rounded-md border border-brand-blue-900/15 px-5 py-2.5 text-sm font-semibold text-brand-blue-900 transition-colors hover:bg-paper-deep"
        >
          Talk to us as a donor or funder
        </Link>
      </div>
    </PageShell>
  );
}
