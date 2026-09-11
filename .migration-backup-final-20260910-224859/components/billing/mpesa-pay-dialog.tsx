'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { StkCheckout } from '@/hooks/use-stk-checkout';

/**
 * The M-Pesa prompt dialog. Presentation only — every piece of state and the
 * whole payment loop live in useStkCheckout, so plan purchase, SMS top-up and
 * the Chama Reminder subscribe page all show the user the same thing.
 */
export function MpesaPayDialog({ checkout }: { checkout: StkCheckout }) {
  return (
    <Dialog open={checkout.open} onOpenChange={checkout.setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Pay via M-Pesa</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {checkout.polling ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="animate-spin h-8 w-8 text-brand-500"/>
              <p className="text-sm text-center text-muted-foreground">
                Check your phone for the M-Pesa prompt.<br/>Waiting for payment confirmation…
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label>M-Pesa phone number</Label>
                <Input
                  placeholder="0712345678"
                  value={checkout.phone}
                  onChange={(e) => checkout.setPhone(e.target.value)}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                You will receive an M-Pesa prompt to pay{' '}
                <strong>KES {checkout.amount?.toLocaleString()}</strong>
              </p>
              <Button
                className="w-full"
                onClick={checkout.pay}
                loading={checkout.isSending}
                disabled={!checkout.phone}
              >
                Send M-Pesa prompt
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
