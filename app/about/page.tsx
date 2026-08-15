import type { Metadata } from 'next';
import { MarketingPageShell } from '@/components/landing/marketing-page-shell';

export const metadata: Metadata = {
  title: 'About — Kitabu Yetu',
  description: 'Kitabu Yetu is a digital ledger for Kenya\'s chamas, SACCOs, welfare groups, and investment clubs.',
};

export default function AboutPage() {
  return (
    <MarketingPageShell
      title="About Kitabu Yetu"
      description="Build Vibrant Communities"
    >
      <p>
        Kitabu Yetu is a digital bookkeeping platform built for the way Kenya&apos;s community
        groups actually run their money — chamas, SACCOs, welfare groups, and investment
        clubs. It replaces the paper ledger and the treasurer&apos;s personal M-Pesa statement
        with one shared, audit-ready book.
      </p>
      <p>
        Groups collect contributions and loan repayments directly by M-Pesa — STK push,
        PayBill, and B2C payouts — and every payment reconciles automatically against a
        real double-entry ledger, so members can see exactly where their money is at any
        time, not just at the next meeting.
      </p>
      <h2>Who it&apos;s for</h2>
      <p>
        Individual members tracking their own contributions and loans, group officers
        running day-to-day operations for a chama or SACCO, and organizations — NGOs and
        federations — that fund or oversee multiple groups at once.
      </p>
    </MarketingPageShell>
  );
}
