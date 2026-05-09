'use client';

import { motion } from 'framer-motion';
import { UserPlus, Users, Banknote, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

const steps = [
  {
    number: '01',
    icon: UserPlus,
    title: 'Register Your Group',
    description:
      'Create your chama or SACCO account in under 2 minutes. Add your group name, set up contribution rules, and configure your M-Pesa shortcode.',
    color: 'text-green-600',
    bg: 'bg-green-50',
    ring: 'ring-green-200',
  },
  {
    number: '02',
    icon: Users,
    title: 'Add Your Members',
    description:
      'Invite members by phone number or import them from a CSV spreadsheet. Each member gets a secure account to view their own contribution history.',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    ring: 'ring-blue-200',
  },
  {
    number: '03',
    icon: Banknote,
    title: 'Start Tracking Finances',
    description:
      'Record contributions, approve loans, and watch M-Pesa payments reconcile automatically. Reports and SMS alerts handle themselves.',
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    ring: 'ring-violet-200',
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-slate-50 py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-16 text-center">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-3 text-sm font-semibold uppercase tracking-widest text-green-600"
          >
            Simple to get started
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl"
          >
            Up and running in minutes,
            <br className="hidden sm:block" /> not weeks
          </motion.h2>
        </div>

        {/* Steps */}
        <div className="relative">
          {/* Connecting line (desktop) */}
          <div
            aria-hidden
            className="absolute left-1/2 top-20 hidden h-0.5 w-[calc(66.666%-4rem)] -translate-x-1/2 bg-gradient-to-r from-green-200 via-blue-200 to-violet-200 lg:block"
          />

          <div className="grid gap-10 lg:grid-cols-3 lg:gap-8">
            {steps.map((step, i) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.55, delay: i * 0.15 }}
                className="relative flex flex-col items-center text-center"
              >
                {/* Step icon */}
                <div className={`relative mb-6 flex h-16 w-16 items-center justify-center rounded-2xl ${step.bg} ring-4 ${step.ring}`}>
                  <step.icon className={`h-8 w-8 ${step.color}`} />
                  <span className="absolute -right-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-black text-slate-900 shadow-md ring-2 ring-slate-100">
                    {i + 1}
                  </span>
                </div>

                <h3 className="mb-3 text-xl font-bold text-slate-900">{step.title}</h3>
                <p className="max-w-xs text-slate-600 leading-relaxed">{step.description}</p>

                {/* Arrow between steps (mobile) */}
                {i < steps.length - 1 && (
                  <div className="mt-6 flex justify-center lg:hidden">
                    <ArrowRight className="h-6 w-6 rotate-90 text-slate-300" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-14 text-center"
        >
          <Button
            asChild
            size="lg"
            className="bg-green-600 px-10 font-semibold text-white hover:bg-green-700"
          >
            <Link href="/register">
              Get Started Free <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
          <p className="mt-3 text-sm text-slate-500">No credit card required · Free for small groups</p>
        </motion.div>
      </div>
    </section>
  );
}
