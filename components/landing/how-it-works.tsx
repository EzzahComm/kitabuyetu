'use client';

import { motion } from 'framer-motion';
import { UserPlus, Smartphone, BookOpenCheck, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

const steps = [
  {
    icon: UserPlus,
    title: 'Open the book',
    description:
      'Register your group in under two minutes. You get KY-coded accounts, a chart of accounts, and your PayBill reference set up automatically.',
  },
  {
    icon: Smartphone,
    title: 'Collect by M-Pesa',
    description:
      'Prompt members with STK Push or let them pay your PayBill. Each payment is matched to a member and split across your accounts as it lands.',
  },
  {
    icon: BookOpenCheck,
    title: 'The book keeps itself',
    description:
      'Journals post, receipts send, charges reconcile, and reminders go out — automatically. You just read the reports.',
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-brand-blue-900 py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.22em] text-brand-400"
          >
            Three entries
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="font-display text-4xl font-light leading-[1.05] tracking-tight text-white sm:text-5xl"
          >
            Up and running in minutes,
            {' '}
            <span className="italic text-brand-400">not weeks</span>.
          </motion.h2>
        </div>

        <div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 lg:grid-cols-3">
          {steps.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: i * 0.12 }}
              className="relative bg-brand-blue-900 p-8 md:p-10"
            >
              <div className="mb-6 flex items-center gap-4">
                <span className="font-display text-5xl font-light text-brand-500/40">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/15 ring-1 ring-brand-500/30">
                  <step.icon className="h-6 w-6 text-brand-400" />
                </div>
              </div>
              <h3 className="mb-3 text-xl font-bold text-white">{step.title}</h3>
              <p className="leading-relaxed text-brand-blue-100/60">{step.description}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-14 flex flex-col items-center gap-3"
        >
          <Button
            asChild
            size="lg"
            className="bg-brand-500 px-10 font-semibold text-white shadow-lg shadow-brand-500/25 hover:bg-brand-400"
          >
            <Link href="/register">
              Register/Sign-Up <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
          <p className="font-mono text-xs uppercase tracking-wider text-white/40">
            No card required · Free for small groups
          </p>
        </motion.div>
      </div>
    </section>
  );
}
