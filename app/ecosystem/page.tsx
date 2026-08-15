import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingPageShell } from '@/components/landing/marketing-page-shell';

export const metadata: Metadata = {
  title: 'The Kitabu Yetu Ecosystem',
  description:
    'Three digital tools, and the groups, organizations and partners that use them to build vibrant communities across East Africa.',
};

/**
 * The ecosystem view — deliberately simple for now.
 *
 * Kept to what genuinely exists today (the three tools, groups, and funding
 * organizations) with room to grow into programs, partners and opportunities.
 * Nothing here describes a capability the platform does not have; the
 * Fundraise entry is explicitly labelled as not yet available.
 */
const TOOLS = [
  {
    name: 'Kitabu Yetu Bookkeeper',
    href: '/bookkeeper',
    blurb: 'Digital bookkeeping and group administration — contributions, loans, welfare, shares and an audit-ready ledger.',
    status: 'Available',
  },
  {
    name: 'Chama Reminder',
    href: '/chama-reminder',
    blurb: 'Automated SMS reminders, announcements and birthday messages that keep members informed.',
    status: 'Available',
  },
  {
    name: 'Fundraise / Changi$ha',
    href: '/fundraise',
    blurb: 'Digital fundraising and collections for community causes.',
    status: 'Coming soon',
  },
];

export default function EcosystemPage() {
  return (
    <MarketingPageShell
      title="The Kitabu Yetu Ecosystem"
      description="Digital tools for communities, groups and the organizations that support them."
    >
      <p>
        Kitabu Yetu digitises how communities administer themselves. The ecosystem is the
        set of tools a group can use, and the organizations and partners that work
        alongside them.
      </p>

      <h2>Digital tools</h2>
      <div className="not-prose grid gap-4 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="block rounded-xl border border-slate-200 p-5 transition-colors hover:border-brand-300 hover:bg-brand-50/40"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-base font-semibold text-slate-900">{t.name}</span>
              <span
                className={
                  t.status === 'Available'
                    ? 'shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700'
                    : 'shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500'
                }
              >
                {t.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{t.blurb}</p>
          </Link>
        ))}
      </div>

      <h2>Groups</h2>
      <p>
        Chamas, SACCOs, welfare groups and investment clubs — the members and officers who
        run them day to day, each with their own books, rules and cycles.
      </p>

      <h2>Organizations</h2>
      <p>
        Funders, NGOs and umbrella bodies that support groups. An organization gets its own
        portal for programs, disbursements and a portfolio view across the groups it works
        with. If you are one, <Link href="/contact">get in touch</Link>.
      </p>

      <h2>Growing</h2>
      <p>
        Programs, partners and opportunities will join this picture as they become real.
        We would rather list what exists than what is planned.
      </p>
    </MarketingPageShell>
  );
}
