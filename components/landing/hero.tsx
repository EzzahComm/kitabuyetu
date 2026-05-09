'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowRight,
  Smartphone,
  Shield,
  TrendingUp,
  CheckCircle,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-green-950 via-green-900 to-emerald-800 pb-20 pt-28 md:pb-28 md:pt-36">
      {/* Decorative orbs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-1/4 -top-1/2 h-[600px] w-[600px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute -right-16 top-1/3 h-[500px] w-[500px] rounded-full bg-green-400/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-[300px] w-[700px] -translate-x-1/2 rounded-full bg-teal-500/10 blur-3xl" />
      </div>

      {/* Grid pattern overlay */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(white 1px, transparent 1px), linear-gradient(to right, white 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          {/* ── Text content ── */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: 'easeOut' }}
          >
            {/* Badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm text-emerald-300 backdrop-blur-sm">
              <span>🇰🇪</span>
              <span className="font-medium">Built for Kenyan Community Groups</span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl lg:text-[3.5rem] xl:text-6xl">
              Your Chama&apos;s Finances,{' '}
              <span className="text-emerald-400">Finally Under Control</span>
            </h1>

            {/* Sub-headline */}
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-green-200/80">
              Track contributions, manage loans, send SMS updates, and receive M-Pesa
              payments — all in one platform built for Kenya&apos;s SACCOs, chamas, and
              community groups.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="bg-emerald-500 px-8 font-semibold text-white hover:bg-emerald-400 focus-visible:ring-emerald-400"
              >
                <Link href="/register">
                  Start Free Trial <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/30 bg-white/5 text-white backdrop-blur-sm hover:bg-white/15 hover:text-white focus-visible:ring-white/50"
              >
                <a href="#how-it-works">See How It Works</a>
              </Button>
            </div>

            {/* Trust indicators */}
            <div className="mt-10 flex flex-wrap gap-6">
              {[
                { icon: Smartphone, label: 'M-Pesa Integrated' },
                { icon: Shield, label: 'Bank-grade Security' },
                { icon: TrendingUp, label: 'Real-time Reports' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-emerald-300">
                  <Icon className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-medium">{label}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* ── Dashboard preview mockup ── */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.75, delay: 0.2, ease: 'easeOut' }}
            className="relative hidden lg:block"
          >
            <DashboardPreview />
          </motion.div>
        </div>

        {/* ── Floating social proof bar ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-16 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 border-t border-white/10 pt-8 text-sm text-white/60"
        >
          <span className="font-medium text-white/80">Trusted by 500+ groups across Kenya</span>
          {['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret'].map((city) => (
            <span key={city} className="rounded-full bg-white/10 px-3 py-0.5 text-xs text-white/70">
              {city}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function DashboardPreview() {
  const bars = [42, 68, 51, 83, 60, 91, 74, 96, 63, 88, 79, 100];

  return (
    <div className="relative ml-8">
      {/* Main dashboard card */}
      <div className="rounded-2xl border border-white/20 bg-white/10 p-6 shadow-2xl backdrop-blur-md">
        {/* Header row */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-white/50">
              Group Balance
            </p>
            <p className="mt-1 text-3xl font-bold text-white">KSh 2,450,000</p>
            <p className="mt-1 text-xs text-emerald-400">↑ 12.4% this month</p>
          </div>
          <div className="rounded-xl bg-emerald-500/20 p-3">
            <TrendingUp className="h-6 w-6 text-emerald-400" />
          </div>
        </div>

        {/* Mini bar chart */}
        <div className="mb-5 flex h-16 items-end gap-1.5">
          {bars.map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-sm bg-emerald-400/50 transition-all"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Members', value: '48' },
            { label: 'Active Loans', value: '12' },
            { label: 'Repaid', value: '95%' },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-white/5 p-3 text-center">
              <p className="text-lg font-bold text-white">{value}</p>
              <p className="text-xs text-white/40">{label}</p>
            </div>
          ))}
        </div>

        {/* Recent transactions */}
        <div className="mt-4 space-y-2">
          {[
            { name: 'James K.', amount: '+KSh 5,000', type: 'Contribution', color: 'text-emerald-400' },
            { name: 'Aisha M.', amount: '+KSh 5,000', type: 'Contribution', color: 'text-emerald-400' },
            { name: 'Loan Disbursement', amount: '-KSh 50,000', type: 'Loan', color: 'text-amber-400' },
          ].map((tx, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
              <div>
                <p className="text-xs font-medium text-white">{tx.name}</p>
                <p className="text-[10px] text-white/40">{tx.type}</p>
              </div>
              <span className={`text-xs font-semibold ${tx.color}`}>{tx.amount}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Floating M-Pesa notification */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.9 }}
        className="absolute -bottom-6 -left-10 flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-xl"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="h-5 w-5 text-green-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">M-Pesa received</p>
          <p className="text-xs text-slate-500">James N. · KSh 5,000</p>
        </div>
      </motion.div>

      {/* Floating members badge */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 1.0 }}
        className="absolute -right-8 -top-5 rounded-xl bg-white px-4 py-2.5 shadow-xl"
      >
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {['J', 'A', 'F', 'M'].map((l) => (
              <div
                key={l}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-xs font-bold text-white"
              >
                {l}
              </div>
            ))}
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-800">48 members</p>
            <p className="text-[10px] text-slate-400">
              <Users className="mr-0.5 inline h-2.5 w-2.5" />
              All active
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
