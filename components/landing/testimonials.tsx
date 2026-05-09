'use client';

import { motion } from 'framer-motion';
import { Star, Quote } from 'lucide-react';

const testimonials = [
  {
    quote:
      'Before Kitabu Yetu we were tracking everything in WhatsApp groups and spreadsheets. Now our treasurer spends 30 minutes a month instead of the whole weekend. M-Pesa integration is a game changer.',
    name: 'Grace Wanjiku',
    title: 'Chairperson, Umoja Savings Group',
    location: 'Nairobi',
    initials: 'GW',
    color: 'bg-green-500',
    rating: 5,
  },
  {
    quote:
      'Managing 80 members and their loan repayments was overwhelming. Kitabu Yetu sends SMS reminders automatically and the loan tracking is crystal clear. Our recovery rate went from 70% to 98%.',
    name: 'David Otieno',
    title: 'Treasurer, Nyota SACCO',
    location: 'Kisumu',
    initials: 'DO',
    color: 'bg-blue-500',
    rating: 5,
  },
  {
    quote:
      'The reports we generate from Kitabu Yetu are professional enough to present to our bank when applying for credit facilities. It has completely transformed how we operate as a group.',
    name: 'Fatuma Hassan',
    title: 'Secretary, Pwani Women\'s Chama',
    location: 'Mombasa',
    initials: 'FH',
    color: 'bg-violet-500',
    rating: 5,
  },
];

export default function Testimonials() {
  return (
    <section id="testimonials" className="py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-16 text-center">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-3 text-sm font-semibold uppercase tracking-widest text-green-600"
          >
            Loved by group leaders
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl"
          >
            Trusted across Kenya
          </motion.h2>
        </div>

        {/* Cards */}
        <div className="grid gap-6 md:grid-cols-3">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: i * 0.12 }}
              className="relative flex flex-col rounded-2xl border border-slate-100 bg-white p-8 shadow-sm"
            >
              {/* Quote icon */}
              <Quote className="mb-4 h-8 w-8 text-green-100" />

              {/* Stars */}
              <div className="mb-4 flex gap-0.5">
                {Array.from({ length: t.rating }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-amber-400 text-amber-400" />
                ))}
              </div>

              {/* Quote text */}
              <p className="flex-1 text-slate-700 leading-relaxed">&ldquo;{t.quote}&rdquo;</p>

              {/* Author */}
              <div className="mt-6 flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white ${t.color}`}
                >
                  {t.initials}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                  <p className="text-xs text-slate-500">
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
