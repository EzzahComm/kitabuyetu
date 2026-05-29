import * as React from 'react';
import { cn } from '@/lib/utils';
import { statusTone, tone as toneMap, type Tone } from '@/lib/ui/tokens';

interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Domain status string — mapped to a tone via STATUS_TONE (loans, M-Pesa, KYC…). */
  status: string;
  /** Override the auto-derived tone. */
  tone?: Tone;
  /** Show a leading status dot. Defaults to true. */
  dot?: boolean;
  /** Override the displayed label; defaults to a humanized `status`. */
  label?: string;
  size?: 'sm' | 'md';
}

function humanize(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Financial / lifecycle status indicator. Reads a domain status (e.g. "overdue",
 * "reconciled", "pending") and renders a semantically-coloured pill so money
 * states are instantly scannable and consistent across every portal.
 */
export function StatusPill({
  status, tone: toneOverride, dot = true, label, size = 'md', className, ...props
}: StatusPillProps) {
  const t = toneOverride ?? statusTone(status);
  const c = toneMap[t];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'md' ? 'px-2.5 py-0.5 text-xs' : 'px-2 py-px text-[11px]',
        className,
      )}
      style={{ color: c.fg, backgroundColor: c.bg, borderColor: c.border }}
      {...props}
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.solid }} aria-hidden />
      )}
      {label ?? humanize(status)}
    </span>
  );
}
