'use client';

import { motion } from 'framer-motion';
import { Check, Minus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Mark = 'yes' | 'no' | 'partial';

const capabilities: { label: string; paper: Mark; generic: Mark; kitabu: Mark }[] = [
  { label: 'Native M-Pesa STK, PayBill & B2C', paper: 'no', generic: 'partial', kitabu: 'yes' },
  { label: 'Auto-reconciliation within minutes', paper: 'no', generic: 'no', kitabu: 'yes' },
  { label: 'Real double-entry accounting', paper: 'no', generic: 'partial', kitabu: 'yes' },
  { label: 'Auto-split across savings, welfare & loans', paper: 'no', generic: 'no', kitabu: 'yes' },
  { label: 'Member self-service app & passbook', paper: 'no', generic: 'partial', kitabu: 'yes' },
  { label: 'Role-based access (chair, treasurer, secretary)', paper: 'no', generic: 'partial', kitabu: 'yes' },
  { label: 'Automatic SMS & WhatsApp reminders', paper: 'no', generic: 'no', kitabu: 'yes' },
  { label: 'Full audit trail on every entry', paper: 'no', generic: 'partial', kitabu: 'yes' },
  { label: 'Multi-branch / SACCO portfolio view', paper: 'no', generic: 'no', kitabu: 'yes' },
];

const markIcon: Record<Mark, typeof Check> = { yes: Check, no: X, partial: Minus };
const markStyle: Record<Mark, string> = {
  yes: 'bg-brand-50 text-brand-600 ring-1 ring-brand-500/20',
  no: 'bg-brand-blue-900/[0.04] text-brand-blue-900/25',
  partial: 'bg-amber-50 text-amber-500 ring-1 ring-amber-200',
};

function MarkCell({ mark }: { mark: Mark }) {
  const Icon = markIcon[mark];
  return (
    <div className="flex justify-center">
      <span className={cn('flex h-7 w-7 items-center justify-center rounded-full', markStyle[mark])}>
        <Icon className="h-4 w-4" strokeWidth={2.5} />
      </span>
    </div>
  );
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};
const rowV = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

export default function Comparison() {
  return (
    <section className="relative bg-[#FBFAF5] py-20 md:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.22em] text-brand-600"
          >
            Why Kitabu Yetu
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="font-display text-4xl font-light leading-[1.05] tracking-tight text-brand-blue-900 sm:text-5xl"
          >
            Built for this,
            {' '}
            <span className="italic text-brand-600">not adapted to it</span>.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-5 text-lg leading-relaxed text-brand-blue-900/60"
          >
            Generic accounting software gets you partway. Kitabu Yetu was built
            specifically for how chamas, SACCOs, and welfare groups actually move
            money in Kenya.
          </motion.p>
        </div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="overflow-x-auto rounded-2xl border border-brand-blue-900/10 shadow-sm"
        >
          <table className="w-full min-w-[560px] border-collapse bg-white text-sm">
            <thead>
              <tr className="border-b border-brand-blue-900/10 bg-brand-blue-900/[0.03]">
                <th className="px-6 py-4 text-left font-mono text-xs font-medium uppercase tracking-[0.14em] text-brand-blue-900/50 sm:px-8">
                  Capability
                </th>
                <th className="px-4 py-4 text-center font-mono text-xs font-medium uppercase tracking-[0.14em] text-brand-blue-900/50">
                  Paper &amp; Excel
                </th>
                <th className="px-4 py-4 text-center font-mono text-xs font-medium uppercase tracking-[0.14em] text-brand-blue-900/50">
                  Generic software
                </th>
                <th className="bg-brand-50/60 px-4 py-4 text-center font-mono text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
                  Kitabu Yetu
                </th>
              </tr>
            </thead>
            <tbody>
              {capabilities.map((c, i) => (
                <motion.tr
                  key={c.label}
                  variants={rowV}
                  className={i !== capabilities.length - 1 ? 'border-b border-brand-blue-900/10' : ''}
                >
                  <td className="px-6 py-4 font-medium text-brand-blue-900 sm:px-8">{c.label}</td>
                  <td className="px-4 py-4"><MarkCell mark={c.paper} /></td>
                  <td className="px-4 py-4"><MarkCell mark={c.generic} /></td>
                  <td className="bg-brand-50/40 px-4 py-4"><MarkCell mark={c.kitabu} /></td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="mt-4 flex items-center gap-2 text-xs text-brand-blue-900/40"
        >
          <Minus className="h-3.5 w-3.5" /> Partial — usually possible with manual work or a third-party add-on.
        </motion.p>
      </div>
    </section>
  );
}
