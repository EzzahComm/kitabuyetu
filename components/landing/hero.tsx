'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowRight, Smartphone, ShieldCheck, RefreshCw, CheckCircle2, Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-brand-blue-900 pb-24 pt-28 md:pb-32 md:pt-36">
      {/* Warm ledger glow + green accent light */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-1/4 -top-1/3 h-[640px] w-[640px] rounded-full bg-brand-500/15 blur-[120px]" />
        <div className="absolute -right-24 top-1/4 h-[520px] w-[520px] rounded-full bg-brand-blue-400/20 blur-[120px]" />
      </div>

      {/* Ruled-ledger texture — horizontal lines like an account book */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: 'repeating-linear-gradient(to bottom, transparent, transparent 39px, #ffffff 39px, #ffffff 40px)',
        }}
      />
      {/* The ledger's red margin rule */}
      <div aria-hidden className="absolute left-[8%] top-0 hidden h-full w-px bg-brand-500/20 lg:block" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          {/* ── Copy ── */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-4 py-1.5 font-mono text-xs uppercase tracking-[0.18em] text-brand-300">
              <span className="text-sm">🇰🇪</span>
              Powered by Safaricom Daraja
            </div>

            <h1 className="font-display text-5xl font-light leading-[1.02] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Simple books.
              <br />
              <span className="font-normal italic text-brand-400">Stronger&nbsp;groups.</span>
            </h1>

            <p className="mt-7 max-w-xl text-lg leading-relaxed text-brand-blue-100/80">
              Kitabu Yetu helps Kenya&apos;s savings groups manage money in one place.
              Members save and pay with M-Pesa from their phone, treasurers keep the
              books, and every shilling is matched automatically.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="bg-brand-500 px-8 font-semibold text-white shadow-lg shadow-brand-500/25 hover:bg-brand-400"
              >
                <Link href="/register">
                  Register/Sign-Up <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/25 bg-white/5 text-white backdrop-blur-sm hover:bg-white/10 hover:text-white"
              >
                <a href="#how-it-works">See how it works</a>
              </Button>
            </div>

            <div className="mt-11 flex flex-wrap gap-x-7 gap-y-3">
              {[
                { icon: Smartphone, label: 'STK · PayBill · B2C' },
                { icon: RefreshCw, label: 'Auto-reconciliation' },
                { icon: Wallet, label: 'Member wallet app' },
                { icon: ShieldCheck, label: 'Double-entry ledger' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-brand-blue-100/70">
                  <Icon className="h-4 w-4 text-brand-400" />
                  <span className="font-mono text-xs uppercase tracking-wider">{label}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* ── Receipt / ledger mockup ── */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
            className="relative hidden lg:block"
          >
            <LedgerMockup />
          </motion.div>
        </div>

        {/* ── Footprint bar ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-20 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-white/10 pt-8"
        >
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-white/50">
            Keeping books across
          </span>
          {['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret'].map((city) => (
            <span key={city} className="font-mono text-xs text-white/70">
              {city}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function LedgerMockup() {
  return (
    <div className="relative ml-6">
      {/* Receipt card — warm paper */}
      <div className="rounded-2xl border border-black/5 bg-[#FBFAF5] p-6 shadow-2xl shadow-black/40">
        {/* Receipt header */}
        <div className="flex items-start justify-between border-b border-dashed border-brand-blue-900/15 pb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand-blue-900/50">
              Contribution received
            </p>
            <p className="mt-1 font-display text-4xl font-normal text-brand-blue-900">
              KSh 3,000
            </p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50">
            <CheckCircle2 className="h-6 w-6 text-brand-600" />
          </div>
        </div>

        {/* M-Pesa meta */}
        <div className="space-y-2 py-4 font-mono text-xs">
          <Row k="Member" v="Wanjiku N. · KY0001042" />
          <Row k="M-Pesa receipt" v="SKE3X9QW12" accent />
          <Row k="Account ref" v="KYT-CONTR-KY0000019" />
        </div>

        {/* Split allocation — the standout feature */}
        <div className="rounded-xl bg-brand-blue-900/[0.04] p-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-brand-blue-900/50">
            Auto-split to ledger
          </p>
          {[
            { label: 'Savings', amount: '2,000', pct: 'w-[66%]' },
            { label: 'Welfare fund', amount: '500', pct: 'w-[17%]' },
            { label: 'Loan repayment', amount: '500', pct: 'w-[17%]' },
          ].map((s) => (
            <div key={s.label} className="mb-2.5 last:mb-0">
              <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
                <span className="text-brand-blue-900/70">{s.label}</span>
                <span className="font-medium text-brand-blue-900">KSh {s.amount}</span>
              </div>
              <div className="h-1.5 rounded-full bg-brand-blue-900/10">
                <div className={`h-full rounded-full bg-brand-500 ${s.pct}`} />
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-brand-blue-900/40">
          Journal posted · receipt sent
        </p>
      </div>

      {/* Floating STK-push chip */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.9 }}
        className="absolute -left-12 top-8 rounded-xl border border-black/5 bg-white px-4 py-3 shadow-xl"
      >
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-500" />
          </span>
          <div>
            <p className="text-sm font-semibold text-brand-blue-900">STK prompt sent</p>
            <p className="font-mono text-[10px] text-brand-blue-900/50">Awaiting PIN · 0712••• 042</p>
          </div>
        </div>
      </motion.div>

      {/* Floating B2C disbursement chip */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 1.05 }}
        className="absolute -bottom-7 -right-8 rounded-xl border border-black/5 bg-white px-4 py-3 shadow-xl"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-600">B2C disbursed</p>
        <p className="mt-0.5 text-sm font-semibold text-brand-blue-900">Loan → KSh 50,000</p>
        <p className="font-mono text-[10px] text-brand-blue-900/50">Sent to member&apos;s phone</p>
      </motion.div>
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-brand-blue-900/50">{k}</span>
      <span className={accent ? 'font-medium text-brand-600' : 'text-brand-blue-900/80'}>{v}</span>
    </div>
  );
}
