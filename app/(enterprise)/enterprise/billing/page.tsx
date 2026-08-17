'use client';

/**
 * Organization Billing — SMS credits.
 *
 * Deliberately its OWN page, not a card on the Funding Portal. That page is
 * the org's CAPITAL wallet (donor contributions, grants, disbursements to
 * groups) — SMS credits are a separate wallet (organization_billing_accounts
 * .sms_credits) with no GL posting and nothing to do with disbursement
 * capacity. Mirrors the group side, which manages its own SMS credits on a
 * dedicated Billing page too (components/layout/sidebar.tsx), not folded
 * into any "funding" concept.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, ArrowDownToLine } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { SectionHeader } from '@/components/dashboard/sms/shared';
import { useToast } from '@/hooks/use-toast';
import { organizationApi } from '@/lib/api/endpoints';
import { formatDate } from '@/lib/utils';

export default function OrganizationBillingPage() {
  const [topUpOpen, setTopUpOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['organization', 'sms-credits'],
    queryFn:  () => organizationApi.smsCredits(),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="This organization's SMS credits — separate from the capital wallet on the Funding Portal."
        actions={
          <Button size="sm" className="gap-1.5 h-9" onClick={() => setTopUpOpen(true)}>
            <ArrowDownToLine size={15} /> Top up
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          title="SMS credit balance"
          value={isLoading ? '—' : `${(data?.balance ?? 0).toLocaleString()} credits`}
          icon={MessageSquare}
        />
        <StatCard
          title="Rate per SMS"
          value={isLoading || data?.rate == null ? '—' : `KES ${data.rate.toFixed(4)}`}
          description="Negotiated rate — set by Kitabu Yetu staff"
        />
      </div>

      <div className="space-y-3">
        <SectionHeader title="Recent top-ups" subtitle="Manual entries, reconciled against bank/M-Pesa settlement separately." />
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Amount (KES)</th>
                  <th className="px-4 py-3 text-left">Credits added</th>
                  <th className="px-4 py-3 text-left">Rate applied</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
                ) : !data?.recent.length ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No top-ups yet.</td></tr>
                ) : data.recent.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(r.created_at)}</td>
                    <td className="px-4 py-3">{Number(r.amount_paid).toLocaleString()}</td>
                    <td className="px-4 py-3">{Number(r.credits_added).toLocaleString()}</td>
                    <td className="px-4 py-3">{Number(r.rate_applied).toFixed(4)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <SmsCreditsTopUpDialog open={topUpOpen} onClose={() => setTopUpOpen(false)} />
    </div>
  );
}

function SmsCreditsTopUpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [amount, setAmount]       = useState('');
  const [reference, setReference] = useState('');

  const topUp = useMutation({
    mutationFn: () => organizationApi.topUpSmsCredits({
      amountKes: parseFloat(amount),
      reference: reference || undefined,
    }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['organization', 'sms-credits'] });
      toast({
        title: 'SMS credits added',
        description: `${result.creditsAdded.toLocaleString()} credits — new balance ${result.newBalance.toLocaleString()}.`,
      });
      setAmount(''); setReference('');
      onClose();
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Top-up failed', description: e.message }),
  });

  const valid = parseFloat(amount) > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Top up SMS credits</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Amount (KES)</Label>
            <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" />
          </div>
          <div className="space-y-1">
            <Label>Reference <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. bank transfer ref" />
          </div>
          <p className="text-xs text-muted-foreground">
            Recorded as a manual top-up — no M-Pesa payment is collected here. Bank/M-Pesa settlement is
            reconciled separately.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => topUp.mutate()} disabled={!valid || topUp.isPending}>Top up</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
