'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';

interface Unrouted {
  id: string;
  receipt: string;
  phone: string;
  amount: string;
  bill_ref: string | null;
  reason: string;
  created_at: string;
}

const REASON_LABEL: Record<string, string> = {
  unknown_prefix: 'Unknown account format',
  unknown_group: 'Group not found',
  unknown_member: 'Member not matched',
  ambiguous_member: 'Multiple members match',
  no_account_ref: 'No account reference',
  amount_mismatch: 'Amount mismatch',
  other: 'Needs review',
};

export default function UnroutedPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [active, setActive] = useState<Unrouted | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery<{ items: Unrouted[] }>({
    queryKey: ['mpesa', 'unrouted'],
    queryFn: () => api.get<{ items: Unrouted[] }>('/mpesa/unrouted'),
  });


  const items = data?.items ?? [];

  const openResolve = (row: Unrouted) => {
    setActive(row);
    setNotes('');
  };

  const resolve = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await api.post(`/mpesa/unrouted/${active.id}/resolve`, {
        action: 'dismiss',
        notes: notes || undefined,
      });
      toast({ title: 'Receipt dismissed' });
      setActive(null);
      await qc.invalidateQueries({ queryKey: ['mpesa', 'unrouted'] });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Dismiss failed',
        description: err instanceof ApiError ? err.message : '',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/mpesa">
          <Button variant="ghost" size="icon" aria-label="Back to M-Pesa">
            <ArrowLeft size={16} />
          </Button>
        </Link>
        <PageHeader
          title="Unrouted receipts"
          description="Provider-confirmed receipts that could not be matched automatically. They cannot be manually posted as contributions."
          className="flex-1"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : isError ? (
        // UX_UI_OPTIMIZATION_AUDIT_2026-08.md C2 — a failed fetch used to render
        // "All receipts are routed", telling a treasurer there is nothing to
        // reconcile when in fact nothing loaded.
        <Card>
          <CardContent className="p-0">
            <EmptyState
              variant="error"
              icon={AlertTriangle}
              title="Couldn't load unrouted receipts"
              description={getErrorMessage(error)}
              action={
                <Button variant="outline" onClick={() => refetch()}>
                  Try again
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Inbox className="mx-auto mb-3 opacity-40" size={32} />
            All receipts are routed. Nothing to review.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((row) => (
            <Card key={row.id}>
              <CardContent className="py-4 flex items-center justify-between flex-wrap gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{formatKES(Number(row.amount))}</span>
                    <Badge variant="warning">{REASON_LABEL[row.reason] ?? row.reason}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {row.phone} · Receipt {row.receipt}
                    {row.bill_ref ? ` · Ref ${row.bill_ref}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(row.created_at)}</p>
                </div>
                <Button size="sm" onClick={() => openResolve(row)}>
                  Resolve
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Review unrouted receipt</DialogTitle>
          </DialogHeader>
          {active && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 p-3 text-sm">
                <p>
                  <span className="font-semibold">{formatKES(Number(active.amount))}</span> from {active.phone}
                </p>
                <p className="text-muted-foreground">
                  Receipt {active.receipt}
                  {active.bill_ref ? ` · Ref ${active.bill_ref}` : ''}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">Manual allocation is disabled. Only an existing provider-confirmed payment can be corrected through the audited reallocation workflow.</p>
              <div className="space-y-1">
                <Label>Review notes (optional)</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason / context" />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => resolve()} disabled={busy}>
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
