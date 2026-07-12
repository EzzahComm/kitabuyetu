'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  Wallet, LayoutDashboard, Send, RefreshCw, Building2,
  Handshake, ShieldCheck, TrendingUp, ClipboardCheck, ArrowRight,
} from 'lucide-react';

// Nine capability tiers, each framed as Feature → Solution. The first five
// overlap the mechanics in "The whole book" (#features) but are re-voiced here
// at the role/tier altitude; the last four (Credit Marketplace onward) are the
// ecosystem's reach beyond a single group's book.
const tiers = [
  {
    icon: Wallet,
    title: 'Members',
    feature: 'A wallet on every member’s phone.',
    solution:
      'Financial inclusion. No need to physically meet or travel to hand over cash — members participate from anywhere, on any phone.',
  },
  {
    icon: LayoutDashboard,
    title: 'Treasurers',
    feature: 'One dashboard that records every entry for you.',
    solution:
      'Human error, eliminated. Treasurers run the whole book digitally — no lost ledgers, no arithmetic mistakes, no lag in recording transactions.',
  },
  {
    icon: Send,
    title: 'Payment Processing',
    feature: 'Direct M-Pesa integration.',
    solution:
      'Frictionless transactions. Members contribute and pay fees without typing codes or exchanging cash — funds stay secure end to end.',
  },
  {
    icon: RefreshCw,
    title: 'Accounting',
    feature: 'Every M-Pesa payment matched automatically.',
    solution:
      'Instant reporting and compliance. 100% certainty on who has paid, zero end-of-month reconciliation, and an audit trail everyone trusts.',
  },
  {
    icon: Building2,
    title: 'SACCO Federation',
    feature: 'Manage every branch from one place.',
    solution:
      "Institutional visibility. A real-time, bird's-eye view of cash flow, liquidity, and member liabilities across every branch — not delayed, fragmented reports.",
  },
  {
    icon: Handshake,
    title: 'Credit Marketplace',
    feature: 'Credit scores and lender access built in.',
    solution:
      'Data-driven capital access. Groups skip the paperwork; lenders issue de-risked loans against verified M-Pesa transaction history.',
  },
  {
    icon: ShieldCheck,
    title: 'Micro-Insurance Distribution',
    feature: 'Offer insurance cover to members in a few taps.',
    solution:
      'Automated risk mitigation. Members get health, agricultural, or life cover fit to community risk — with zero admin overhead for agents.',
  },
  {
    icon: TrendingUp,
    title: 'Investment Portfolio Management',
    feature: 'Track investments and assets, each in its own book.',
    solution:
      'Asset diversification and growth. Groups track real estate, agriculture, or money market ventures separately, out of a single app — no mixing with operational funds.',
  },
  {
    icon: ClipboardCheck,
    title: 'Grant & Donor Governance',
    feature: 'Give donors read-only access and clear reports.',
    solution:
      "Institutional trust. Donors track fund utilization in real time, cutting manual impact reporting and raising the group's odds of future funding.",
  },
];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const card = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function Ecosystem() {
  return (
    <section id="ecosystem" className="relative scroll-mt-24 bg-white py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.22em] text-brand-600"
          >
            Beyond the ledger
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="font-display text-4xl font-light leading-[1.05] tracking-tight text-brand-blue-900 sm:text-5xl"
          >
            One book.
            {' '}
            <span className="italic text-brand-600">A whole financial ecosystem</span>.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-5 text-lg leading-relaxed text-brand-blue-900/60"
          >
            Kitabu Yetu doesn&apos;t stop at contributions and reconciliation. As a
            group grows — into a federation, a lending relationship, an insured
            membership, or a donor-funded project — the same book grows with it.
          </motion.p>
        </div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="grid gap-px overflow-hidden rounded-2xl border border-brand-blue-900/10 bg-brand-blue-900/10 sm:grid-cols-2 lg:grid-cols-3"
        >
          {tiers.map((tier) => (
            <motion.div
              key={tier.title}
              variants={card}
              className="group relative bg-white p-8 transition-colors duration-300 hover:bg-[#FBFAF5]"
            >
              <div className="mb-5 inline-flex rounded-xl bg-brand-50 p-3 ring-1 ring-brand-500/15 transition-transform duration-300 group-hover:-translate-y-0.5">
                <tier.icon className="h-6 w-6 text-brand-600" />
              </div>
              <h3 className="mb-4 text-lg font-bold text-brand-blue-900">{tier.title}</h3>

              <p className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-brand-blue-700">
                Feature
              </p>
              <p className="mb-4 leading-relaxed text-brand-blue-900/60">{tier.feature}</p>

              <p className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-brand-600">
                Solution
              </p>
              <p className="leading-relaxed text-brand-blue-900/60">{tier.solution}</p>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-10"
        >
          <Link
            href="/enterprise"
            className="group inline-flex items-center gap-2 text-base font-semibold text-brand-600 transition-colors hover:text-brand-700"
          >
            Enterprise and federation-scale? Explore the ecosystem
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
