import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ECOSYSTEM_PILLARS } from '@/components/marketing/content';
import { PageShell } from '@/components/marketing/page-shell';
import { ROUTES } from '@/components/marketing/routes';

export const metadata: Metadata = {
  title: 'The Ecosystem',
  description: 'Groups, organizations, donors and programs — how Kitabu Yetu connects a community’s book to the wider ecosystem around it.',
};

/**
 * Four pillars, not three tools — the ecosystem view now matches
 * ECOSYSTEM_ITEMS/ECOSYSTEM_PILLARS in components/marketing/{routes,content}.ts,
 * which is also what the header's Ecosystem dropdown links to. Multigroup
 * Organizations is real; Donors, Marketplace and Programs are the direction
 * this is heading, each labelled and each honest about it on its own page.
 */
export default function EcosystemPage() {
  return (
    <PageShell
      title="The Kitabu Yetu Ecosystem"
      description="A group's book doesn't stop at its own members — it connects outward, to the organizations, donors and programs around it."
    >
      <p>
        Kitabu Yetu starts with one group&apos;s ledger, but the platform is built to grow
        into the wider network around that group — the federation that oversees it, the
        donor that funds a project inside it, and the programs it might qualify for
        because its record can actually prove it.
      </p>

      <div className="not-prose grid gap-4 sm:grid-cols-2">
        {ECOSYSTEM_PILLARS.map((pillar) => (
          <Link
            key={pillar.href}
            href={pillar.href}
            className="group flex flex-col rounded-xl border border-brand-blue-900/10 p-5 transition-colors hover:border-brand-500/40 hover:bg-white"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex items-center gap-2.5 text-base font-semibold text-brand-blue-900">
                <pillar.icon aria-hidden="true" className="h-4.5 w-4.5 text-brand-600" />
                {pillar.title}
              </span>
              <span
                className={
                  pillar.status === 'live'
                    ? 'shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700'
                    : 'shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700'
                }
              >
                {pillar.status === 'live' ? 'Live' : 'Coming soon'}
              </span>
            </div>
            <p className="mt-2 text-sm text-brand-blue-900/65">{pillar.body}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
              Learn more
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>

      <h2>The tools underneath</h2>
      <p>
        Every pillar above sits on top of the same products: <Link href={ROUTES.bookkeeper}>Bookkeeper</Link>{' '}
        for the ledger, <Link href={ROUTES.chamaReminder}>Chama Reminder</Link> for the messaging, and{' '}
        <Link href={ROUTES.fundraise}>Fundraise / Changi$ha</Link> for causes and campaigns. See the full{' '}
        <Link href={ROUTES.products}>product overview</Link> for what each one does.
      </p>
    </PageShell>
  );
}
