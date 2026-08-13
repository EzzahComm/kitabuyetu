import { useState, useEffect, useCallback } from 'react';
import { useStkPush, usePollMpesa } from './use-billing';
import { useToast } from './use-toast';
import { getErrorMessage } from '@/lib/utils';
import type { StkPushInput } from '@/lib/validators/mpesa.schema';

/**
 * The STK push → prompt → poll → settle loop, as one reusable state machine.
 *
 * Extracted from the billing page, which ran exactly this loop for two
 * different purchases (plan upgrade and SMS top-up) out of one shared dialog.
 * The Chama Reminder subscribe page needs the same loop for a third, and
 * copying a payment state machine per surface is how they drift.
 *
 * `onCompleted` fires once, on a confirmed payment. Everything money-related
 * still happens server-side off Safaricom's callback — this only tells the UI
 * when to refresh and what to say.
 */
export function useStkCheckout(onCompleted: (amount: number) => void) {
  const { toast } = useToast();
  const stkPush   = useStkPush();

  const [open, setOpen]             = useState(false);
  const [phone, setPhone]           = useState('');
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [polling, setPolling]       = useState(false);
  const [amount, setAmount]         = useState<number | null>(null);
  const [payload, setPayload]       = useState<Omit<StkPushInput, 'phone'> | null>(null);

  const { data: mpesaStatus } = usePollMpesa(checkoutId, polling);

  // Effect responds to M-Pesa polling result (external async system).
  // The setState calls here stop polling and close the modal on terminal
  // status — this is the "subscribe to external system" pattern, not the
  // copy-data-to-state anti-pattern the rule normally guards against.
  useEffect(() => {
    if (!mpesaStatus || amount == null) return;
    if (mpesaStatus.status === 'completed') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPolling(false);
      setOpen(false);
      onCompleted(amount);
    } else if (mpesaStatus.status === 'failed') {
      setPolling(false);
      toast({ variant: 'destructive', title: 'Payment failed', description: 'M-Pesa payment was not completed' });
    }
  }, [mpesaStatus, amount, onCompleted, toast]);

  /** Open the dialog for a purchase. Nothing is sent until the user confirms. */
  const start = useCallback((next: Omit<StkPushInput, 'phone'>) => {
    setPayload(next);
    setAmount(next.amount);
    setOpen(true);
  }, []);

  const pay = useCallback(async () => {
    if (!payload || !phone) return;
    try {
      const res = await stkPush.mutateAsync({ phone, ...payload });
      setCheckoutId(res.checkoutRequestId);
      setPolling(true);
    } catch (err) {
      toast({ variant: 'destructive', title: 'STK push failed', description: getErrorMessage(err) });
    }
  }, [payload, phone, stkPush, toast]);

  return {
    open,
    // Refuse to close mid-poll: the payment is in flight and the dialog is the
    // only thing telling the user so.
    setOpen: (next: boolean) => { if (!polling) setOpen(next); },
    phone, setPhone,
    polling,
    amount,
    start,
    pay,
    isSending: stkPush.isPending,
  };
}

export type StkCheckout = ReturnType<typeof useStkCheckout>;
