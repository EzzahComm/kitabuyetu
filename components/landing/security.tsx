'use client';

import { motion } from 'framer-motion';
import {
  ShieldCheck, KeyRound, ScrollText, GitBranch, Building2, Lock,
} from 'lucide-react';

// Every claim here maps to something real and shipped — no generic "bank-grade"
// language that can't be pointed at an actual mechanism. See docs/audits/ for
// the RBAC activation, audit-log, and maker-checker work this describes.
const controls = [
  {
    icon: KeyRound,
    title: 'Role-based access',
    description: 'Chairperson, treasurer, secretary, and member each see and do only what their role allows.',
  },
  {
    icon: Lock,
    title: 'Two-factor for staff',
    description: 'Backoffice and organization staff sign in with a TOTP code, not a password alone.',
  },
  {
    icon: GitBranch,
    title: 'Maker-checker approvals',
    description: 'Disbursements, loan write-offs, and manual journals need a second, different approver above your threshold.',
  },
  {
    icon: ScrollText,
    title: 'Full audit trail',
    description: 'Every sensitive change — who, what, and when — is logged and reviewable, not just the money movements.',
  },
  {
    icon: Building2,
    title: 'Isolated per group',
    description: 'Your group’s members, contributions, and books are never visible to another group.',
  },
  {
    icon: ShieldCheck,
    title: 'Official Daraja integration',
    description: 'Payments run on Safaricom’s own M-Pesa API — not a screen-scraped or unofficial workaround.',
  },
];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07 } },
};
const card = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function Security() {
  return (
    <section className="relative overflow-hidden bg-brand-blue-900 py-20 md:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -right-1/4 top-0 h-[560px] w-[560px] rounded-full bg-brand-500/10 blur-[120px]" />
      </div>
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: 'repeating-linear-gradient(to bottom, transparent, transparent 39px, #ffffff 39px, #ffffff 40px)',
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.22em] text-brand-400"
          >
            Built for real money
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="font-display text-4xl font-light leading-[1.05] tracking-tight text-white sm:text-5xl"
          >
            Controls that hold up
            {' '}
            <span className="italic text-brand-400">under real scrutiny</span>.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-5 text-lg leading-relaxed text-brand-blue-100/60"
          >
            A group&apos;s money deserves the same discipline a bank applies to
            its own. Every control below is live in the product today, not on a
            roadmap.
          </motion.p>
        </div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3"
        >
          {controls.map((c) => (
            <motion.div
              key={c.title}
              variants={card}
              className="group relative bg-brand-blue-900 p-8 transition-colors duration-300 hover:bg-white/[0.03]"
            >
              <div className="mb-5 inline-flex rounded-xl bg-brand-500/15 p-3 ring-1 ring-brand-500/30 transition-transform duration-300 group-hover:-translate-y-0.5">
                <c.icon className="h-6 w-6 text-brand-400" />
              </div>
              <h3 className="mb-2.5 text-lg font-bold text-white">{c.title}</h3>
              <p className="leading-relaxed text-brand-blue-100/60">{c.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
