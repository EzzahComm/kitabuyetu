'use client';

/**
 * In-context M-Pesa STK Push dialog — the "Request payment" flow.
 *
 * Used from the dashboard (with a member picker) and the member detail page
 * (member preset). Keeps the user inside the current page: confirm details →
 * send prompt → live status while the member enters their PIN → success or
 * failure with retry. On success every affected query (contributions,
 * dashboard tiles, member stats, M-Pesa lists) is invalidated so balances
 * refresh without a page reload.
 *
 * Server side (already enforced there, not here): JWT + group scoping,
 * a 30s duplicate-prompt lock (409), the MpesaReceiptNumber UNIQUE key,
 * automatic contribution + ledger posting on the callback, and
 * reconciliation for lost callbacks.
 */

import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Smartphone, XCircle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api/client';
import { membersApi } from '@/lib/api/endpoints';
import { isValidKenyanPhone } from '@/lib/utils/phone';
import { formatKES } from '@/lib/utils';
import type { MemberPublic } from '@/types/api.types';

type Step = 'form' | 'sending' | 'waiting' | 'completed' | 'failed';

export interface StkPromptDialogProps {
  open:    boolean;
  onClose: () => void;
  /** Preset payer (member page). Omit to show the member picker (dashboard). */
  member?: { name: string; phone: string };
}

const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS    = 40; // × 3s = 2 minutes, past Daraja's own timeout

export function StkPromptDialog({ open, onClose, member }: StkPromptDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [memberId, setMemberId] = useState('');
  const [phone, setPhone]       = useState(member?.phone ?? '');
  const [amount, setAmount]     = useState('');
  const [step, setStep]         = useState<Step>('form');
  const [reference, setReference] = useState<string | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const pollGen = useRef(0); // invalidates in-flight polls on close/retry

  // Member picker (dashboard mode only) — active members with a phone.
  const { data: membersData, isLoading: loadingMembers } = useQuery({
    queryKey: ['members', 'stk-picker'],
    queryFn:  () => membersApi.list({ page: 1, limit: 200 }),
    enabled:  open && !member,
    staleTime: 60_000,
  });
  const pickable = useMemo(
    () => (((membersData as { items?: MemberPublic[] } | undefined)?.items) ?? [])
      .filter((m) => m.isActive && m.phone),
    [membersData],
  );

  // Picking a member pre-fills their phone (still editable afterwards).
  function pickMember(id: string) {
    setMemberId(id);
    const picked = pickable.find((m) => m.id === id);
    if (picked) setPhone(picked.phone);
  }

  const payerName = member?.name
    ?? (() => {
      const p = pickable.find((m) => m.id === memberId);
      return p ? `${p.firstName} ${p.lastName}` : null;
    })();

  const amt = parseInt(amount, 10);
  const phoneOk  = isValidKenyanPhone(phone);
  const amountOk = Number.isFinite(amt) && amt > 0;
  const canSend  = phoneOk && amountOk && (member ? true : !!memberId);

  function resetAndClose() {
    pollGen.current++;
    setStep('form');
    setAmount('');
    setMemberId('');
    setPhone(member?.phone ?? '');
    setReference(null);
    setFailReason(null);
    onClose();
  }

  function onPaymentCompleted() {
    // Refresh everything the payment touches — no manual reload needed.
    qc.invalidateQueries({ queryKey: ['contributions'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['members'] });
    qc.invalidateQueries({ queryKey: ['mpesa'] });
    toast({ title: 'Payment received', description: 'Balances and records updated.' });
  }

  async function pollStatus(checkoutId: string) {
    const gen = pollGen.current;
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (pollGen.current !== gen) return; // dialog closed / retried
      try {
        const res = await api.get<{ status: string }>(
          `/mpesa/status?checkoutRequestId=${encodeURIComponent(checkoutId)}`,
        );
        if (pollGen.current !== gen) return;
        if (res.status === 'completed') {
          setStep('completed');
          onPaymentCompleted();
          return;
        }
        if (res.status === 'failed') {
          setStep('failed');
          setFailReason('The prompt was cancelled, timed out, or the payment failed on M-Pesa.');
          return;
        }
      } catch {
        // transient — keep polling
      }
    }
    if (pollGen.current === gen) {
      setStep('failed');
      setFailReason(
        'No confirmation received yet. If the member completed the payment it will still be recorded automatically — check the transactions list shortly before retrying.',
      );
    }
  }

  async function send() {
    setStep('sending');
    setFailReason(null);
    try {
      const res = await api.post<{ checkoutRequestId?: string }>('/mpesa/stk-push', {
        phone,
        amount: amt,
        accountReference: 'CONTRIB',
        description:      'Contribution',
        purpose:          'contribution',
      });
      setReference(res.checkoutRequestId ?? null);
      setStep('waiting');
      toast({ title: 'STK prompt sent', description: 'Ask the member to enter their M-Pesa PIN.' });
      if (res.checkoutRequestId) void pollStatus(res.checkoutRequestId);
    } catch (err) {
      setStep('failed');
      setFailReason(err instanceof Error ? err.message : 'The STK push could not be sent.');
    }
  }

  function retry() {
    pollGen.current++;
    setReference(null);
    setFailReason(null);
    setStep('form');
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetAndClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone size={16} /> Request M-Pesa payment
          </DialogTitle>
        </DialogHeader>

        {step === 'form' && (
          <div className="space-y-4">
            {member ? (
              <p className="text-sm text-muted-foreground">
                Prompt <span className="font-medium text-foreground">{member.name}</span> ({member.phone}) to pay a contribution.
              </p>
            ) : (
              <div className="space-y-1">
                <Label>Member</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={memberId}
                  onChange={(e) => pickMember(e.target.value)}
                >
                  <option value="">
                    {loadingMembers ? 'Loading members…' : 'Select a member…'}
                  </option>
                  {pickable.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName} — {m.phone}
                    </option>
                  ))}
                </select>
                {!loadingMembers && pickable.length === 0 && (
                  <p className="text-xs text-muted-foreground">No active members with a phone number found.</p>
                )}
              </div>
            )}

            <div className="space-y-1">
              <Label>Phone (M-Pesa)</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0712345678"
                inputMode="tel"
              />
              {phone && !phoneOk && (
                <p className="text-xs text-destructive">Enter a valid Kenyan phone number.</p>
              )}
            </div>

            <div className="space-y-1">
              <Label>Amount (KES)</Label>
              <Input
                type="number" min={1} step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Category: <span className="font-medium text-foreground">Contribution</span> · Ref: CONTRIB.
              The payment posts to savings and the ledger automatically on confirmation.
            </p>
          </div>
        )}

        {(step === 'sending' || step === 'waiting') && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium">
                {step === 'sending' ? 'Sending STK prompt…' : `Waiting for ${payerName ?? phone} to enter their PIN…`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {amountOk ? `${formatKES(amt)} · ` : ''}{phone}
                {reference && <> · Ref <span className="font-mono">{reference.slice(-10)}</span></>}
              </p>
            </div>
          </div>
        )}

        {step === 'completed' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-9 w-9 text-green-500" />
            <div>
              <p className="text-sm font-semibold text-green-700">Payment received</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {amountOk ? `${formatKES(amt)} from ` : ''}{payerName ?? phone}. Contribution and ledger updated.
              </p>
            </div>
          </div>
        )}

        {step === 'failed' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <XCircle className="h-9 w-9 text-destructive" />
            <div>
              <p className="text-sm font-semibold text-destructive">Payment not completed</p>
              <p className="mt-1 text-xs text-muted-foreground">{failReason}</p>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'form' && (
            <>
              <Button variant="outline" onClick={resetAndClose}>Cancel</Button>
              <Button onClick={send} disabled={!canSend}>Send prompt</Button>
            </>
          )}
          {(step === 'sending' || step === 'waiting') && (
            <Button variant="outline" onClick={resetAndClose}>Close — keep processing</Button>
          )}
          {step === 'completed' && (
            <Button onClick={resetAndClose}>Done</Button>
          )}
          {step === 'failed' && (
            <>
              <Button variant="outline" onClick={resetAndClose}>Close</Button>
              <Button onClick={retry}>Try again</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
