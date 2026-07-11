'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Smartphone, Users, Building2, ShieldCheck, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const personas = [
  {
    icon: Smartphone,
    kicker: 'For members',
    title: 'A wallet in every pocket',
    description:
      'Members get a mobile-first app — savings balance, digital passbook, savings goals, and one-tap M-Pesa contributions. Works offline, syncs when signal returns.',
    points: ['Digital passbook & receipts', 'Savings goals', 'Loan balance & repay'],
    cta: 'Open the member app',
    href: '/me',
  },
  {
    icon: Users,
    kicker: 'For group leaders',
    title: 'Chairperson, treasurer & secretary',
    description:
      'Run the whole group from one dashboard — contributions, loans, welfare, shares, and dividends. A "Needs you now" queue surfaces every approval, unrouted receipt, and overdue member.',
    points: ['Contributions & loans', 'M-Pesa reconciliation', 'Members & meetings'],
    cta: 'Start your group',
    href: '/register',
  },
  {
    icon: Building2,
    kicker: 'For SACCOs, Organizations & federations',
    title: 'Portfolios across every branch',
    description:
      'Roll up savings, loans, and impact across hundreds of groups. Switch organizations, compare branches, run bulk disbursements, and integrate via API, webhooks, and white-label branding.',
    points: ['Multi-branch portfolios', 'Program impact analytics', 'API, webhooks & white-label'],
    cta: 'Explore Enterprise',
    href: '/enterprise',
  },
  {
    icon: ShieldCheck,
    kicker: 'For platform & operations teams',
    title: 'A control room for the network',
    description:
      'Backoffice queues, risk & fraud heatmaps, KYC review, and live Daraja health with a real-time transaction feed — plus a ⌘K command palette to jump anywhere in seconds.',
    points: ['Risk & fraud monitoring', 'KYC verification queues', 'Live Daraja & SMS health'],
    cta: 'Backoffice sign in',
    href: '/admin-login',
  },
];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const card = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function Personas() {
  return (
    <section id="solutions" className="relative bg-white py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.22em] text-brand-600"
          >
            One platform, every role
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="font-display text-4xl font-light leading-[1.05] tracking-tight text-brand-blue-900 sm:text-5xl"
          >
            From a single chama to a
            {' '}
            <span className="italic text-brand-600">national network</span>.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-5 text-lg leading-relaxed text-brand-blue-900/60"
          >
            The same ledger powers the member on their phone, the treasurer at the
            meeting, the federation managing a hundred branches, and the team keeping
            the whole platform safe.
          </motion.p>
        </div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="grid gap-5 sm:grid-cols-2"
        >
          {personas.map((p) => (
            <motion.div
              key={p.kicker}
              variants={card}
              className="group flex flex-col rounded-2xl border border-brand-blue-900/10 bg-[#FBFAF5] p-7 transition-colors duration-300 hover:border-brand-500/30 hover:bg-white"
            >
              <div className="mb-5 inline-flex w-fit rounded-xl bg-brand-50 p-3 ring-1 ring-brand-500/15 transition-transform duration-300 group-hover:-translate-y-0.5">
                <p.icon className="h-6 w-6 text-brand-600" />
              </div>
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-brand-600">
                {p.kicker}
              </p>
              <h3 className="mt-1.5 text-xl font-bold text-brand-blue-900">{p.title}</h3>
              <p className="mt-2.5 leading-relaxed text-brand-blue-900/60">{p.description}</p>

              <ul className="mt-4 flex flex-wrap gap-2">
                {p.points.map((pt) => (
                  <li
                    key={pt}
                    className="rounded-full bg-brand-blue-900/5 px-2.5 py-1 text-xs font-medium text-brand-blue-900/70"
                  >
                    {pt}
                  </li>
                ))}
              </ul>

              <div className="mt-6 pt-1">
                <Button asChild variant="ghost" className="px-0 text-brand-600 hover:bg-transparent hover:text-brand-700">
                  <Link href={p.href}>
                    {p.cta}
                    <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </Button>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
