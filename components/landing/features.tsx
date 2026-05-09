'use client';

import { motion } from 'framer-motion';
import {
  Smartphone,
  TrendingUp,
  Users,
  FileText,
  MessageSquare,
  ShieldCheck,
  CreditCard,
  RefreshCcw,
  Upload,
} from 'lucide-react';

const features = [
  {
    icon: Smartphone,
    title: 'M-Pesa Integration',
    description:
      'Members pay contributions via STK Push directly from their phones. Payments reconcile automatically — no manual entry needed.',
    color: 'text-green-700',
    bg: 'bg-green-50',
    border: 'group-hover:border-green-200',
  },
  {
    icon: TrendingUp,
    title: 'Loan Management',
    description:
      'Track loan applications, approvals, repayment schedules, and outstanding balances with full audit trails.',
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'group-hover:border-blue-200',
  },
  {
    icon: Users,
    title: 'Member Management',
    description:
      'Manage all group members, assign roles, track contribution history, and handle member onboarding in one place.',
    color: 'text-violet-700',
    bg: 'bg-violet-50',
    border: 'group-hover:border-violet-200',
  },
  {
    icon: FileText,
    title: 'Financial Reports',
    description:
      'Generate balance sheets, contribution reports, and loan summaries. Export to PDF for board meetings.',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'group-hover:border-amber-200',
  },
  {
    icon: MessageSquare,
    title: 'SMS Notifications',
    description:
      'Automatically notify members about contributions due, loan approvals, and payment confirmations via Africa\'s Talking.',
    color: 'text-rose-700',
    bg: 'bg-rose-50',
    border: 'group-hover:border-rose-200',
  },
  {
    icon: ShieldCheck,
    title: 'Role-Based Access',
    description:
      'Separate dashboards for members, treasurers, and admins. Row-level security ensures members see only their own data.',
    color: 'text-teal-700',
    bg: 'bg-teal-50',
    border: 'group-hover:border-teal-200',
  },
  {
    icon: CreditCard,
    title: 'Double-Entry Accounting',
    description:
      'Full general ledger with journal entries. Every transaction is balanced and auditable — meeting accounting standards.',
    color: 'text-indigo-700',
    bg: 'bg-indigo-50',
    border: 'group-hover:border-indigo-200',
  },
  {
    icon: RefreshCcw,
    title: 'Automated Billing',
    description:
      'Set up recurring invoices for monthly contributions. Overdue reminders sent automatically via SMS and email.',
    color: 'text-orange-700',
    bg: 'bg-orange-50',
    border: 'group-hover:border-orange-200',
  },
  {
    icon: Upload,
    title: 'Bulk CSV Import',
    description:
      'Migrate from spreadsheets in minutes. Import up to 5,000 members, contributions, or loans from a single CSV file.',
    color: 'text-cyan-700',
    bg: 'bg-cyan-50',
    border: 'group-hover:border-cyan-200',
  },
];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const card = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function Features() {
  return (
    <section id="features" className="py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="mb-16 text-center">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-3 text-sm font-semibold uppercase tracking-widest text-green-600"
          >
            Everything you need
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl"
          >
            Built for the way chamas
            <br className="hidden sm:block" /> actually work
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mx-auto mt-4 max-w-2xl text-lg text-slate-600"
          >
            From monthly contributions to complex loan portfolios, Kitabu Yetu handles
            the financial complexity so you can focus on growing your group.
          </motion.p>
        </div>

        {/* Feature grid */}
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((feature) => (
            <motion.div
              key={feature.title}
              variants={card}
              className={`group relative rounded-2xl border border-slate-100 bg-white p-8 shadow-sm transition-all duration-300 hover:shadow-md ${feature.border}`}
            >
              <div className={`mb-5 inline-flex rounded-xl p-3 ${feature.bg}`}>
                <feature.icon className={`h-6 w-6 ${feature.color}`} />
              </div>
              <h3 className="mb-3 text-lg font-bold text-slate-900">{feature.title}</h3>
              <p className="leading-relaxed text-slate-600">{feature.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
