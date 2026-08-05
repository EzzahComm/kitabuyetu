'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Mirrors app/pricing/page.tsx's PLANS exactly — this is a preview, the full
// page is the single source of truth for plan details. Keep both in sync if
// pricing ever changes.
const plans = [
  {
    type: 'starter', label: 'Starter', price: 'Free', period: 'forever',
    blurb: 'Up to 10 members',
    features: ['Basic contribution tracking', 'Loan management', 'M-Pesa integration'],
    highlight: false,
  },
  {
    type: 'growth', label: 'Growth', price: 'KES 2,500', period: '/month',
    blurb: 'Up to 100 members',
    features: ['Double-entry accounting', 'Advanced reporting', '500 SMS/month'],
    highlight: true,
  },
  {
    type: 'enterprise', label: 'Enterprise', price: 'KES 8,000', period: '/month',
    blurb: 'Unlimited members',
    features: ['Multi-group organization portal', 'API access & custom branding', 'Priority support'],
    highlight: false,
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

export default function PricingPreview() {
  return (
    <section id="pricing" className="relative scroll-mt-24 bg-[#FBFAF5] py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.22em] text-brand-600"
          >
            Simple pricing
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="font-display text-4xl font-light leading-[1.05] tracking-tight text-brand-blue-900 sm:text-5xl"
          >
            Free to start,
            {' '}
            <span className="italic text-brand-600">grows with your group</span>.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-5 text-lg leading-relaxed text-brand-blue-900/60"
          >
            No card required to start. Every plan includes full M-Pesa integration.
          </motion.p>
        </div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="grid gap-5 lg:grid-cols-3"
        >
          {plans.map((p) => (
            <motion.div
              key={p.type}
              variants={card}
              className={
                p.highlight
                  ? 'relative flex flex-col rounded-2xl border-2 border-brand-500 bg-white p-7 shadow-lg shadow-brand-500/10'
                  : 'relative flex flex-col rounded-2xl border border-brand-blue-900/10 bg-white p-7'
              }
            >
              {p.highlight && (
                <span className="absolute -top-3 left-7 rounded-full bg-brand-500 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                  Most popular
                </span>
              )}
              <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand-600">{p.label}</p>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="font-display text-4xl font-normal text-brand-blue-900">{p.price}</span>
                <span className="text-sm text-brand-blue-900/50">{p.period}</span>
              </div>
              <p className="mt-1.5 text-sm text-brand-blue-900/60">{p.blurb}</p>

              <ul className="mt-6 flex-1 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-brand-blue-900/75">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                    {f}
                  </li>
                ))}
              </ul>

              <Button
                asChild
                className={
                  p.highlight
                    ? 'mt-7 bg-brand-500 font-semibold text-white hover:bg-brand-400'
                    : 'mt-7 bg-brand-blue-900/[0.04] font-semibold text-brand-blue-900 hover:bg-brand-blue-900/[0.08]'
                }
              >
                <Link href="/register">Get started</Link>
              </Button>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-10 text-center"
        >
          <Link
            href="/pricing"
            className="group inline-flex items-center gap-2 text-base font-semibold text-brand-600 transition-colors hover:text-brand-700"
          >
            Compare full plan details
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
