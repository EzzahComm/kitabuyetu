'use client';

import { motion } from 'framer-motion';

const stats = [
  { value: '500+',     label: 'Groups',        description: 'Chamas, SACCOs & welfare groups' },
  { value: 'KSh 50M+', label: 'Reconciled / mo', description: 'Contributions, loans & payouts' },
  { value: '10,000+',  label: 'Members',       description: 'Each with their own ledger view' },
  { value: '< 5 min',  label: 'To go live',    description: 'Register, add members, collect' },
];

export default function Stats() {
  return (
    <section className="border-b border-brand-blue-900/10 bg-white py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 divide-y divide-brand-blue-900/10 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="px-2 py-6 text-center lg:px-8"
            >
              <div className="font-display text-4xl font-light text-brand-blue-900 sm:text-5xl">
                {stat.value}
              </div>
              <div className="mt-2 font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand-600">
                {stat.label}
              </div>
              <div className="mt-1 text-sm text-brand-blue-900/50">{stat.description}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
