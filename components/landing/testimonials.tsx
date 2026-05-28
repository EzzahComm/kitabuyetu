'use client';

import { motion } from 'framer-motion';
import { Star } from 'lucide-react';

const testimonials = [
  {
    quote:
      'We tracked everything in WhatsApp and spreadsheets. Now contributions reconcile themselves and our treasurer spends 30 minutes a month, not the whole weekend.',
    name: 'Grace Wanjiku',
    title: 'Chairperson, Umoja Savings Group',
    location: 'Nairobi',
    initials: 'GW',
    rating: 5,
  },
  {
    quote:
      'Eighty members, every loan repayment by M-Pesa, alerts going out on their own. Our recovery rate went from 70% to 98% — and disbursing loans to phones takes one click.',
    name: 'David Otieno',
    title: 'Treasurer, Nyota SACCO',
    location: 'Kisumu',
    initials: 'DO',
    rating: 5,
  },
  {
    quote:
      'The double-entry reports are clean enough to put in front of our bank for a credit facility. Auto-splitting each contribution into savings and welfare was the feature we didn\'t know we needed.',
    name: 'Fatuma Hassan',
    title: 'Secretary, Pwani Women\'s Chama',
    location: 'Mombasa',
    initials: 'FH',
    rating: 5,
  },
];

export default function Testimonials() {
  return (
    <section id="testimonials" className="bg-[#FBFAF5] py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.22em] text-brand-600"
          >
            Signed off by
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="font-display text-4xl font-light tracking-tight text-brand-blue-900 sm:text-5xl"
          >
            Group leaders who closed the book on chaos.
          </motion.h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: i * 0.12 }}
              className="flex flex-col rounded-2xl border border-brand-blue-900/10 bg-white p-8"
            >
              <div className="mb-5 flex gap-0.5">
                {Array.from({ length: t.rating }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-brand-500 text-brand-500" />
                ))}
              </div>

              <p className="flex-1 font-display text-lg font-light leading-snug text-brand-blue-900/90">
                &ldquo;{t.quote}&rdquo;
              </p>

              <div className="mt-7 flex items-center gap-3 border-t border-dashed border-brand-blue-900/15 pt-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-blue-900 font-mono text-xs font-medium text-white">
                  {t.initials}
                </div>
                <div>
                  <p className="text-sm font-semibold text-brand-blue-900">{t.name}</p>
                  <p className="font-mono text-[11px] text-brand-blue-900/50">
                    {t.title} · {t.location}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
