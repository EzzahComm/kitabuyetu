'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const bullets = [
  'Free for groups with up to 20 members',
  'M-Pesa integration included',
  'SMS notifications for every transaction',
  'No credit card required',
];

export default function CtaSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-green-900 via-green-800 to-emerald-700 py-20 md:py-28">
      {/* Decorative orbs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-emerald-400/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-emerald-300">
            Start today
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Ready to digitize your chama?
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-green-200/80">
            Join 500+ community groups across Kenya who have replaced spreadsheets and
            WhatsApp chaos with Kitabu Yetu.
          </p>

          {/* Benefits list */}
          <div className="mt-8 flex flex-col sm:flex-row flex-wrap justify-center gap-3">
            {bullets.map((b) => (
              <div key={b} className="flex items-center gap-2 text-sm text-emerald-200">
                <CheckCircle className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                <span>{b}</span>
              </div>
            ))}
          </div>

          {/* CTA buttons */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              asChild
              size="lg"
              className="bg-white px-10 text-green-800 font-bold hover:bg-green-50 focus-visible:ring-white shadow-lg"
            >
              <Link href="/register">
                Start Free Trial <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/30 bg-white/5 text-white backdrop-blur-sm hover:bg-white/15 hover:text-white"
            >
              <Link href="/login">Sign In to Your Account</Link>
            </Button>
          </div>

          <p className="mt-6 text-sm text-green-300/70">
            Questions?{' '}
            <a
              href="mailto:support@kitabuyetu.co.ke"
              className="underline underline-offset-4 hover:text-white transition-colors"
            >
              Contact our support team
            </a>
          </p>
        </motion.div>
      </div>
    </section>
  );
}
