import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingPageShell } from '@/components/landing/marketing-page-shell';
import { PLAN_MONTHLY_FEES } from '@/types/enums';

export const metadata: Metadata = {
  title: 'Kitabu Yetu Bookkeeper — Digital bookkeeping for groups',
  description:
    'Digital bookkeeping for chamas, SACCOs, welfare groups and investment clubs. Collect by M-Pesa, reconcile every shilling, and keep an audit-ready double-entry book.',
};

/**
 * Kitabu Yetu Bookkeeper — the first of the three digital tools.
 *
 * Every claim here has to be one the product actually delivers today; the
 * public pricing page was previously wrong on every plan because numbers were
 * typed into the page instead of read from the fee table, so the price below
 * is read from PLAN_MONTHLY_FEES and nothing is hardcoded.
 */
export default function BookkeeperPage() {
  return (
    <MarketingPageShell
      title="Kitabu Yetu Bookkeeper"
      description="Digital bookkeeping and group administration — the record your members can trust."
    >
      <p>
        Bookkeeper digitises how a group keeps its books. Contributions, loans, welfare,
        shares and dividends all post to a real double-entry ledger, so the balance a
        treasurer reads is the same balance the accounts can prove.
      </p>

      <h2>What it does</h2>
      <ul className="ml-5 list-disc space-y-2">
        <li><strong>Collect by M-Pesa.</strong> STK prompts and PayBill payments land against the right member automatically, by account number.</li>
        <li><strong>Reconcile every shilling.</strong> Payments that cannot be matched are queued for a human rather than quietly dropped.</li>
        <li><strong>Contributions and savings.</strong> Split a single payment across savings, welfare and loan repayment using the group&rsquo;s own rules.</li>
        <li><strong>Loans end to end.</strong> Application, approval, disbursement, repayment schedules and arrears.</li>
        <li><strong>Books that hold up.</strong> Trial balance, P&amp;L, balance sheet and cash flow, generated from the same ledger.</li>
        <li><strong>Members see their own record.</strong> Passbook, statements and savings goals.</li>
      </ul>

      <h2>Who it is for</h2>
      <p>
        Chamas, SACCOs, welfare groups and investment clubs — any group that collects money
        from members and owes them an accurate account of it.
      </p>

      <h2>Pricing</h2>
      <p>
        From <strong>KES {PLAN_MONTHLY_FEES.kitabu_yetu.starter}/month</strong>. See{' '}
        <Link href="/pricing">full pricing</Link> for what each plan includes.
      </p>

      <div className="flex flex-wrap gap-3 pt-4">
        <Link
          href="/register"
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Create your group
        </Link>
        <Link
          href="/pricing"
          className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          See pricing
        </Link>
      </div>
    </MarketingPageShell>
  );
}
