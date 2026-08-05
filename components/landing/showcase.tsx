'use client';

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Circle, TrendingUp, ArrowUpRight } from 'lucide-react';

function BrowserFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-black/5 bg-white shadow-2xl shadow-black/10">
      <div className="flex items-center gap-2 border-b border-brand-blue-900/[0.06] bg-brand-blue-900/[0.03] px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-blue-900/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-brand-blue-900/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-brand-blue-900/15" />
        </div>
        <span className="mx-auto font-mono text-[10px] uppercase tracking-[0.14em] text-brand-blue-900/40">{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function TreasurerDashboardMockup() {
  return (
    <BrowserFrame title="Treasurer Dashboard">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Savings', value: 'KSh 842,300' },
          { label: 'Loans out', value: 'KSh 210,500' },
          { label: 'Welfare fund', value: 'KSh 38,900' },
        ].map((s) => (
          <div key={s.label} className="rounded-lg bg-brand-blue-900/[0.03] p-3">
            <p className="font-mono text-[9px] uppercase tracking-wider text-brand-blue-900/40">{s.label}</p>
            <p className="mt-1 text-sm font-bold text-brand-blue-900">{s.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {[
          { name: 'Wanjiku N.', amount: '+ KSh 3,000', tone: 'text-brand-600' },
          { name: 'Otieno D.', amount: '+ KSh 1,500', tone: 'text-brand-600' },
          { name: 'Loan repayment · Achieng M.', amount: '+ KSh 5,200', tone: 'text-brand-600' },
        ].map((r) => (
          <div key={r.name} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-brand-blue-900/[0.02]">
            <div className="flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              <span className="text-xs text-brand-blue-900/75">{r.name}</span>
            </div>
            <span className={`font-mono text-xs font-medium ${r.tone}`}>{r.amount}</span>
          </div>
        ))}
      </div>
    </BrowserFrame>
  );
}

function ReportsMockup() {
  const bars = [40, 62, 51, 78, 66, 90, 84];
  return (
    <BrowserFrame title="Reports & Portfolio">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-brand-blue-900/40">Contributions, 7 weeks</p>
          <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-brand-blue-900">
            KSh 1.2M
            <span className="flex items-center gap-0.5 text-xs font-semibold text-brand-600">
              <TrendingUp className="h-3 w-3" /> 18%
            </span>
          </p>
        </div>
      </div>
      <div className="mt-4 flex h-24 items-end gap-2">
        {bars.map((h) => (
          <div key={h} className="flex-1 rounded-t-sm bg-brand-500/20" style={{ height: `${h}%` }}>
            <div className="h-2 rounded-t-sm bg-brand-500" />
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-brand-blue-900/[0.06] pt-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-brand-blue-900/40">Trial balance</p>
          <p className="mt-1 text-xs font-medium text-brand-600">Balanced ✓</p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-brand-blue-900/40">Branches</p>
          <p className="mt-1 text-xs font-medium text-brand-blue-900">6 groups reporting</p>
        </div>
      </div>
    </BrowserFrame>
  );
}

function MemberAppMockup() {
  return (
    <div className="relative mx-auto w-[220px] overflow-hidden rounded-[2rem] border-[6px] border-brand-blue-900 bg-white shadow-2xl shadow-black/20">
      <div className="absolute left-1/2 top-0 z-10 h-4 w-20 -translate-x-1/2 rounded-b-xl bg-brand-blue-900" />
      <div className="bg-brand-blue-900 px-4 pb-5 pt-7">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-brand-blue-100/50">Your passbook</p>
        <p className="mt-1 text-2xl font-bold text-white">KSh 24,600</p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-brand-400">
          <ArrowUpRight className="h-3 w-3" /> KSh 3,000 this month
        </p>
      </div>
      <div className="space-y-2.5 p-4">
        {[
          { label: 'Contribution', sub: 'Today, 08:14', amount: '+3,000' },
          { label: 'Welfare payout', sub: '2 days ago', amount: '−500' },
          { label: 'Loan repayment', sub: '5 days ago', amount: '−1,200' },
        ].map((t) => (
          <div key={t.label} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Circle className="h-1.5 w-1.5 fill-brand-500 text-brand-500" />
              <div>
                <p className="text-[11px] font-medium text-brand-blue-900">{t.label}</p>
                <p className="font-mono text-[9px] text-brand-blue-900/40">{t.sub}</p>
              </div>
            </div>
            <span className="font-mono text-[11px] font-semibold text-brand-blue-900">{t.amount}</span>
          </div>
        ))}
      </div>
      <div className="mx-4 mb-4 rounded-lg bg-brand-50 px-3 py-2.5 text-center">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-brand-600">Pay with M-Pesa</p>
      </div>
    </div>
  );
}

export default function Showcase() {
  return (
    <section className="relative bg-white py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.22em] text-brand-600"
          >
            See it for yourself
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="font-display text-4xl font-light leading-[1.05] tracking-tight text-brand-blue-900 sm:text-5xl"
          >
            The same book, on
            {' '}
            <span className="italic text-brand-600">every screen</span>.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-5 text-lg leading-relaxed text-brand-blue-900/60"
          >
            A treasurer&apos;s dashboard, a member&apos;s phone, and the reports that
            come out of both — all reading from the same live ledger.
          </motion.p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="space-y-6"
          >
            <TreasurerDashboardMockup />
            <ReportsMockup />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="flex justify-center"
          >
            <MemberAppMockup />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
