'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { BookText, BellRing, HeartHandshake, ArrowRight } from 'lucide-react';
import { PLAN_MONTHLY_FEES, PRODUCT_LABEL } from '@/types/enums';

/**
 * The three digital tools — the spine of how the site presents Kitabu Yetu.
 *
 * Replaces the old "Solutions" framing. Prices are read from the real fee
 * table rather than typed here: the public pricing page was once wrong on
 * every plan precisely because numbers were hardcoded into the page
 * (docs/audits/PRODUCT_CONCORDANCE_AUDIT_2026-08.md §1.1).
 *
 * Fundraise is marked "Coming soon" and links to a page that says the same.
 * It must not imply a signup that does not exist.
 */
const TOOLS = [
  {
    icon: BookText,
    name: 'Kitabu Yetu Bookkeeper',
    href: '/bookkeeper',
    tagline: 'Digital bookkeeping and group administration.',
    blurb:
      'Contributions, loans, welfare, shares and dividends on a real double-entry ledger — collected by M-Pesa and reconciled automatically.',
    meta: `From KES ${PLAN_MONTHLY_FEES.kitabu_yetu.starter}/month`,
    available: true,
  },
  {
    icon: BellRing,
    name: PRODUCT_LABEL.chama_reminder,
    href: '/chama-reminder',
    tagline: 'Remind. Inform. Celebrate. Mobilize.',
    blurb:
      'Automated SMS reminders, meeting notices, announcements and birthday messages — on schedule, personalised, opt-out respected.',
    meta: `From KES ${PLAN_MONTHLY_FEES.chama_reminder.starter}/month`,
    available: true,
  },
  {
    icon: HeartHandshake,
    name: 'Fundraise / Changi$ha',
    href: '/fundraise',
    tagline: 'Digital fundraising and collections.',
    blurb:
      'Raise money together for weddings, funerals, medical appeals, school fees and community projects — with a record everyone can see.',
    meta: 'Coming soon',
    available: false,
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

export default function DigitalTools() {
  return (
    <section id="digital-tools" className="relative scroll-mt-24 bg-white py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.22em] text-brand-600"
          >
            Digital Tools
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="font-display text-4xl font-light leading-[1.05] tracking-tight text-brand-blue-900 sm:text-5xl"
          >
            Three tools for digitising
            <br />
            <span className="italic text-brand-600">group administration.</span>
          </motion.h2>
        </div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="grid gap-6 md:grid-cols-3"
        >
          {TOOLS.map((t) => (
            <motion.div key={t.href} variants={card}>
              <Link
                href={t.href}
                className="group flex h-full flex-col rounded-2xl border border-slate-200 p-7 transition-all hover:border-brand-300 hover:shadow-lg hover:shadow-brand-500/5"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <t.icon size={22} />
                </span>

                <h3 className="mt-5 text-lg font-semibold text-brand-blue-900">{t.name}</h3>
                <p className="mt-1 text-sm font-medium text-brand-600">{t.tagline}</p>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">{t.blurb}</p>

                <div className="mt-6 flex items-center justify-between">
                  <span
                    className={
                      t.available
                        ? 'text-xs font-semibold uppercase tracking-wide text-slate-500'
                        : 'rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500'
                    }
                  >
                    {t.meta}
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-brand-600" />
                </div>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
