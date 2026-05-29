'use client';

import * as React from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn, formatKES } from '@/lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Called on confirm. May be async — the button shows a spinner until it settles. */
  onConfirm: () => void | Promise<void>;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for destructive/irreversible actions (red confirm button). */
  variant?: 'default' | 'danger';
}

/**
 * Generic confirmation modal for actions that need a deliberate second step
 * (delete, suspend, reverse…). Handles async confirm with a loading state and
 * disables dismissal while in flight so an action can't be double-fired.
 */
export function ConfirmDialog({
  open, onOpenChange, title, description, onConfirm,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'default',
}: ConfirmDialogProps) {
  const [loading, setLoading] = React.useState(false);

  async function handleConfirm() {
    try {
      setLoading(true);
      await onConfirm();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {variant === 'danger' && <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />}
            <DialogTitle>{title}</DialogTitle>
          </div>
          {description && <DialogDescription asChild><div>{description}</div></DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface MoneyActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Disburse loan", "Send contribution", "Pay dividend". */
  title: string;
  amount: number;
  /** Key/value rows shown in the confirmation summary (recipient, phone, fee…). */
  details?: { label: string; value: React.ReactNode }[];
  /** Optional warning line shown above the action (e.g. "This cannot be reversed"). */
  warning?: string;
  onConfirm: () => void | Promise<void>;
  confirmLabel?: string;
}

/**
 * High-confidence confirmation for money movements. Surfaces the amount in
 * large type, an itemised summary, and a trust/warning line so the user can
 * verify every detail before funds move — the moment that most needs clarity.
 */
export function MoneyActionDialog({
  open, onOpenChange, title, amount, details, warning, onConfirm, confirmLabel,
}: MoneyActionDialogProps) {
  const [loading, setLoading] = React.useState(false);

  async function handleConfirm() {
    try {
      setLoading(true);
      await onConfirm();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Review the details below before confirming.</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-4 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount</p>
          <p className="money mt-1 text-3xl font-bold tracking-tight text-foreground">{formatKES(amount)}</p>
        </div>

        {details && details.length > 0 && (
          <dl className="space-y-2 text-sm">
            {details.map((d, i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{d.label}</dt>
                <dd className="text-right font-medium text-foreground">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div
          className={cn(
            'flex items-start gap-2 rounded-md p-3 text-sm',
            warning ? 'bg-amber-50 text-amber-800' : 'bg-brand-50 text-brand-800',
          )}
        >
          {warning ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>{warning ?? 'Funds move immediately once confirmed. Check the recipient details.'}</span>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleConfirm} loading={loading}>
            {confirmLabel ?? `Confirm ${formatKES(amount)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
