'use client';

import { motion } from 'framer-motion';
import {
  Smartphone, Landmark, Send, RefreshCw, SplitSquareHorizontal,
  BookOpenCheck, ReceiptText, MessageSquare, Users,
  Wallet, ShieldAlert, Activity, KeyRound,
} from 'lucide-react';

const features = [
  {
    icon: Smartphone,
    title: 'M-Pesa payment prompts',
    description:
      'Send a payment request to any member’s phone. They enter their M-Pesa PIN, and the contribution records itself.',
  },
  {
    icon: Landmark,
    title: 'PayBill payments',
    description:
      'Members pay your PayBill and we match each payment to the right person — no manual entry.',
  },
  {
    icon: Send,
    title: 'Send money out',
    description:
      'Send approved loans, welfare payouts, and dividends straight to members’ phones.',
  },
  {
    icon: SplitSquareHorizontal,
    title: 'Auto-split contributions',
    description:
      'Split each payment across savings, welfare, and loans automatically — down to the last cent.',
  },
  {
    icon: RefreshCw,
    title: 'Payments that reconcile themselves',
    description:
      'We check for stuck or missing payments every few minutes and sort them out. Anything unmatched waits safely in a review queue.',
  },
  {
    icon: BookOpenCheck,
    title: 'Books that stay balanced',
    description:
      'Every shilling is recorded correctly, so your reports are always ready — no spreadsheets to chase.',
  },
  {
    icon: ReceiptText,
    title: 'Receipts & fees',
    description:
      'Members get branded PDF receipts, and every M-Pesa charge is tracked to the cent.',
  },
  {
    icon: MessageSquare,
    title: 'SMS & WhatsApp alerts',
    description:
      'Send confirmations, contribution reminders, and loan-due alerts by WhatsApp or SMS.',
  },
  {
    icon: Users,
    title: 'Members, loans & shares',
    description:
      'Manage members, roles, loans, shares, dividends, and credit scores — all in one place.',
  },
  {
    icon: Wallet,
    title: 'Member app',
    description:
      'Every member gets a phone wallet with their passbook, savings goals, loan balance, and one-tap M-Pesa pay.',
  },
  {
    icon: ShieldAlert,
    title: 'Fraud & member checks',
    description:
      'Risk alerts, fraud checks, and member verification — every payment confirmed and logged before money moves.',
  },
  {
    icon: Activity,
    title: 'Live monitoring',
    description:
      'See the health of payments and messaging live, and spot any problem the moment it happens.',
  },
  {
    icon: KeyRound,
    title: 'API & branding',
    description:
      'API access, multi-branch views, and your own branding for larger networks.',
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
