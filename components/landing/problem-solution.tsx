'use client';

import { motion } from 'framer-motion';
import { ArrowRight, X, Check } from 'lucide-react';

const rows = [
  { problem: 'A treasurer’s notebook, easy to lose or damage', solution: 'A digital ledger, backed up automatically' },
  { problem: 'Hours spent totalling contributions by hand', solution: 'Every M-Pesa payment matched and split in seconds' },
  { problem: 'Missing or late contributions nobody notices in time', solution: 'Non-contributors flagged the moment a cycle closes' },
  { problem: '“What did I actually pay?” — disputes with no paper trail', solution: 'Every member sees their own passbook, any time' },
  { problem: 'One person holding the only copy of the books', solution: 'Role-based access — chairperson, treasurer, secretary, member' },
];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const row = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45 } },
};

export default function ProblemSolution() {
  return (
    <section className="relative bg-[#FBFAF5] py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.22em] text-brand-600"
          >
            Why groups switch
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="font-display text-4xl font-light leading-[1.05] tracking-tight text-brand-blue-900 sm:text-5xl"
          >
            The notebook was never
            {' '}
            <span className="italic text-brand-600">built for this</span>.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-5 text-lg leading-relaxed text-brand-blue-900/60"
          >
            Paper records, spreadsheets, and end-of-month totals by hand all break
            the same way — one missed entry, one lost book, one dispute nobody can
            settle. Here&apos;s what changes with Kitabu Yetu.
          </motion.p>
        </div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="overflow-hidden rounded-2xl border border-brand-blue-900/10 bg-white shadow-sm"
        >
          {/* Column headers */}
          <div className="grid grid-cols-2 border-b border-brand-blue-900/10 bg-brand-blue-900/[0.03]">
            <div className="flex items-center gap-2 px-6 py-4 sm:px-8">
              <X className="h-4 w-4 text-brand-blue-900/30" />
              <span className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-brand-blue-900/50">
                The old way
              </span>
            </div>
            <div className="flex items-center gap-2 border-l border-brand-blue-900/10 px-6 py-4 sm:px-8">
              <Check className="h-4 w-4 text-brand-600" />
              <span className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-brand-600">
                With Kitabu Yetu
              </span>
            </div>
          </div>

          {rows.map((r, i) => (
            <motion.div
              key={r.problem}
              variants={row}
              className={`grid grid-cols-2 ${i !== rows.length - 1 ? 'border-b border-brand-blue-900/10' : ''}`}
            >
              <div className="px-6 py-5 text-sm leading-relaxed text-brand-blue-900/50 sm:px-8 sm:text-base">
                {r.problem}
              </div>
              <div className="border-l border-brand-blue-900/10 px-6 py-5 text-sm font-medium leading-relaxed text-brand-blue-900 sm:px-8 sm:text-base">
                {r.solution}
              </div>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-10"
        >
          <a
            href="#solutions"
            className="group inline-flex items-center gap-2 text-base font-semibold text-brand-600 transition-colors hover:text-brand-700"
          >
            See what changes for your role
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
