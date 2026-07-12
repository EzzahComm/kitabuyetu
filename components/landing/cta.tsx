'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

const bullets = [
  'Free for groups up to 20 members',
  'Daraja M-Pesa included — STK, PayBill & B2C',
  'Auto-reconciliation & double-entry ledger',
  'No card required',
];

export default function CtaSection() {
  return (
    <section className="relative overflow-hidden bg-brand-600 py-20 md:py-28">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage: 'repeating-linear-gradient(to bottom, transparent, transparent 39px, #ffffff 39px, #ffffff 40px)',
        }}
      />
      <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />

      <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <p className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.22em] text-white/70">
            Balance carried forward
          </p>
          <h2 className="font-display text-4xl font-light leading-[1.05] tracking-tight text-white sm:text-5xl">
            Retire the spreadsheet.
            <br />
            <span className="italic">Keep a real book.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-white/80">
            Join the chamas, SACCOs, and welfare groups across Kenya who let
            Kitabu Yetu collect, reconcile, and account for every shilling.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2">
            {bullets.map((b) => (
              <div key={b} className="flex items-center gap-2 text-sm text-white/85">
                <Check className="h-4 w-4 flex-shrink-0 text-white" />
                <span>{b}</span>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="bg-white px-10 font-bold text-brand-700 shadow-lg hover:bg-brand-50"
            >
              <Link href="/register">
                Register/Sign-Up <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/login">Sign in</Link>
            </Button>
          </div>

          <p className="mt-6 font-mono text-xs text-white/60">
            Questions?{' '}
            <a
              href="mailto:kitabuyetu@gmail.com"
              className="underline underline-offset-4 transition-colors hover:text-white"
            >
              kitabuyetu@gmail.com
            </a>
          </p>
        </motion.div>
      </div>
    </section>
  );
}
