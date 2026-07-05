'use client';

import { motion } from 'framer-motion';
import {
  Smartphone, Landmark, Send, RefreshCw, SplitSquareHorizontal,
  BookOpenCheck, ReceiptText, MessageSquare, Users,
  Wallet, ShieldAlert, Activity, KeyRound,
} from 'lucide-react';

const features = [
  {
    icon: Wallet,
    title: 'Member Experience',
    description:
      'Individual digital wallets with USSD and app access. Financial inclusion that removes the need for members to travel or hand over physical cash, so participation works from anywhere.',
  },
  {
    icon: Activity,
    title: 'Treasurer Experience',
    description:
      'Centralized group dashboards and automated journal entries. Eliminate human error with a fully digital book, avoiding lost ledgers, math mistakes, and recording delays.',
  },
  {
    icon: Send,
    title: 'Payment Processing',
    description:
      'Direct M-Pesa integration for frictionless collections. Members contribute and pay fees without typing codes or exchanging cash, improving fund security and speed.',
  },
  {
    icon: RefreshCw,
    title: 'Accounting',
    description:
      'Real-time, automated M-Pesa reconciliation. Instant reporting and compliance with 100% certainty on payments, zero end-of-month catch-up, and trusted audit trails.',
  },
  {
    icon: Landmark,
    title: 'SACCO Federation',
    description:
      'Multi-tier branch hierarchy management. Get a real-time, bird’s-eye view of cash flow, liquidity, and member liabilities across every branch and region.',
  },
  {
    icon: KeyRound,
    title: 'Credit Marketplace',
    description:
      'Third-party API integration and credit scoring dashboards for lenders. Enable data-driven capital access with de-risked loans based on verifiable M-Pesa history.',
  },
  {
    icon: ShieldAlert,
    title: 'Micro-Insurance Distribution',
    description:
      'B2B embedded insurance portals and premium checkout links for agents. Automate risk mitigation with group policies tailored to community needs and zero admin overhead.',
  },
  {
    icon: BookOpenCheck,
    title: 'Investment Portfolio Management',
    description:
      'Multi-ledger setup, asset tracking accounts, and project bookkeeping. Track separate ventures in one app so asset performance stays clear and operational funds never mix.',
  },
  {
    icon: ReceiptText,
    title: 'Grant & Donor Governance',
    description:
      'Read-only permissions, transparent audit logs, and project-specific finance exports. Donors track funds in real time, cutting manual impact reporting and boosting funding confidence.',
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

export default function Features() {
  return (
    <section id="features" className="relative bg-[#FBFAF5] py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.22em] text-brand-600"
          >
            The whole book
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="font-display text-4xl font-light leading-[1.05] tracking-tight text-brand-blue-900 sm:text-5xl"
          >
            From the M-Pesa prompt to the
            {' '}
            <span className="italic text-brand-600">posted journal entry</span>.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-5 text-lg leading-relaxed text-brand-blue-900/60"
          >
            Kitabu Yetu carries a payment all the way through — collection,
            matching, allocation, accounting, and notification — so your
            treasurer doesn&apos;t have to.
          </motion.p>
        </div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="grid gap-px overflow-hidden rounded-2xl border border-brand-blue-900/10 bg-brand-blue-900/10 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              variants={card}
              className="group relative bg-[#FBFAF5] p-8 transition-colors duration-300 hover:bg-white"
            >
              <span className="absolute right-6 top-6 font-mono text-xs text-brand-blue-900/25">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="mb-5 inline-flex rounded-xl bg-brand-50 p-3 ring-1 ring-brand-500/15 transition-transform duration-300 group-hover:-translate-y-0.5">
                <feature.icon className="h-6 w-6 text-brand-600" />
              </div>
              <h3 className="mb-2.5 text-lg font-bold text-brand-blue-900">{feature.title}</h3>
              <p className="leading-relaxed text-brand-blue-900/60">{feature.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
