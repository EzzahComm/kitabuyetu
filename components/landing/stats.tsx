'use client';

import { motion } from 'framer-motion';

const stats = [
  { value: '500+', label: 'Community Groups', description: 'SACCOs and chamas managed' },
  { value: 'KSh 50M+', label: 'Processed Monthly', description: 'Contributions and loans' },
  { value: '10,000+', label: 'Members', description: 'Across all groups' },
  { value: '99.9%', label: 'Uptime', description: 'Always available when you need it' },
];

export default function Stats() {
  return (
    <section className="border-y border-slate-100 bg-slate-50 py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="text-center"
            >
              <div className="text-3xl font-extrabold text-green-700 sm:text-4xl lg:text-5xl">
                {stat.value}
              </div>
              <div className="mt-1 text-base font-semibold text-slate-900">{stat.label}</div>
              <div className="mt-0.5 text-sm text-slate-500">{stat.description}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
