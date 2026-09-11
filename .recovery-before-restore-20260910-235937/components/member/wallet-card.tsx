'use client';

import * as React from 'react';
import { Eye, EyeOff, TrendingUp } from 'lucide-react';
import { formatKES } from '@/lib/utils';

interface WalletCardProps {
  savings: number;
  shares: number;
  thisMonth: number;
  loanBalance: number;
  memberNo: string;
}

/**
 * Wallet hero — the first thing a member sees. Big, calm, trustworthy: total
 * savings front and centre, a privacy toggle to hide the figure in public, and
 * three supporting stats. Brand-navy gradient signals "this is your money,
 * safe here".
 */
export function WalletCard({ savings, shares, thisMonth, loanBalance, memberNo }: WalletCardProps) {
  const [hidden, setHidden] = React.useState(false);
  const mask = (v: number) => (hidden ? '•••••' : formatKES(v));

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-blue-600 to-brand-blue-800 p-5 text-white shadow-lg">
      {/* soft decorative orb */}
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-brand-500/20 blur-2xl" aria-hidden />

      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white/70">My savings</p>
        <button
          type="button"
          onClick={() => setHidden((h) => !h)}
          className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          aria-label={hidden ? 'Show balance' : 'Hide balance'}
        >
          {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      <p className="money mt-1 text-4xl font-bold tracking-tight">{mask(savings)}</p>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-white/70">
        <TrendingUp size={13} className="text-brand-300" />
        <span><span className="font-semibold text-brand-100">{formatKES(thisMonth)}</span> saved this month</span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white/10 p-3 backdrop-blur-sm">
          <p className="text-[11px] text-white/60">Shares</p>
          <p className="money mt-0.5 text-base font-semibold">{mask(shares)}</p>
        </div>
        <div className="rounded-xl bg-white/10 p-3 backdrop-blur-sm">
          <p className="text-[11px] text-white/60">Loan balance</p>
          <p className="money mt-0.5 text-base font-semibold">{mask(loanBalance)}</p>
        </div>
      </div>

      <p className="mt-4 font-mono text-[11px] text-white/40">Member {memberNo}</p>
    </div>
  );
}
