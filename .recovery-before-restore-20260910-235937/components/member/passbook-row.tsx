import * as React from 'react';
import { ArrowDownLeft, ArrowUpRight, Smartphone, Banknote, RefreshCw } from 'lucide-react';
import { StatusPill } from '@/components/shared/status-pill';
import { cn, formatKES } from '@/lib/utils';
import { TXN_META, type PassbookEntry } from '@/app/(member)/_data';

const methodIcon = { mpesa: Smartphone, cash: Banknote, auto: RefreshCw } as const;

/**
 * One line in the digital passbook. Designed for fast scanning: direction-tinted
 * amount (green in / muted out), a plain-language label, the payment method, and
 * a status pill only when something needs attention (pending/failed).
 */
export function PassbookRow({ entry }: { entry: PassbookEntry }) {
  const meta = TXN_META[entry.type];
  const MethodIcon = methodIcon[entry.method];
  const isIn = entry.direction === 'in';
  const time = new Date(entry.date).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex items-center gap-3 py-3">
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          isIn ? 'bg-brand-50 text-brand-600' : 'bg-muted text-muted-foreground',
        )}
        aria-hidden
      >
        {isIn ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          <span className="mr-1" aria-hidden>{meta.emoji}</span>{entry.label}
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MethodIcon size={11} /> {time}
          {entry.ref && <span className="font-mono text-muted-foreground/70">· {entry.ref}</span>}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className={cn('money text-sm font-semibold tabular-nums', isIn ? 'text-brand-600' : 'text-foreground')}>
          {isIn ? '+' : '−'}{formatKES(entry.amount)}
        </p>
        {entry.status !== 'success' && (
          <StatusPill status={entry.status} size="sm" dot={false} className="mt-0.5" />
        )}
      </div>
    </div>
  );
}
