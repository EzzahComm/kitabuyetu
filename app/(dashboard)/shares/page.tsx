'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Coins, Plus, Users, TrendingUp, Layers, Settings as SettingsIcon,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';
import { downloadAuthenticated } from '@/lib/utils/download';
import type { PaginatedResult } from '@/types/db.types';

// ── Types ──────────────────────────────────────────────────────────────

interface ShareClass {
  id: string; name: string; code: string;
  par_value: string; current_value: string | null;
  voting_weight: string; transfer_allowed: boolean;
  is_active: boolean;
}
interface GroupSummary {
  totalClasses: number; totalShareholders: number;
  totalShares: number; totalShareCapital: string; totalInvested: string;
  byClass: { classId: string; code: string; name: string; sharesIssued: number; shareholders: number; effectiveValue: string; capitalAtValue: string }[];
  topHolders: { memberId: string; firstName: string; lastName: string; totalShares: number; totalInvested: string }[];
}
interface Holding {
  member_id: string; share_class_id: string; quantity: number; total_invested: string;
  member_first_name: string; member_last_name: string; member_phone: string;
  share_class_name: string; share_class_code: string;
  share_class_par: string; share_class_current: string | null;
}
interface ShareTxn {
  id: string; type: string; status: string;
  quantity: number; unit_price: string; total_amount: string;
  certificate_serial: string | null; posted_at: string;
  member_first_name: string; member_last_name: string;
  share_class_code: string;
  counterparty_first_name: string | null; counterparty_last_name: string | null;
  notes: string | null;
}
interface MemberRow { id: string; first_name: string; last_name: string; phone: string }

const fmtMoney = (v: string | number | null | undefined) => {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(n);
};
const fmtInt = (v: number) => new Intl.NumberFormat('en-KE').format(v);

const TYPE_BADGE: Record<string, 'default' | 'success' | 'secondary' | 'warning' | 'destructive' | 'outline'> = {
  allocation:   'secondary',
  purchase:     'success',
  transfer_in:  'default',
  transfer_out: 'outline',
  redemption:   'warning',
  adjustment:   'destructive',
};

export default function SharesPage() {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const [open, setOpen] = useState(false);

  const summaryQ  = useQuery<GroupSummary>({
    queryKey: ['shares', 'summary'],
    queryFn:  () => api.get<GroupSummary>('/shares/summary'),
  });
  const classesQ  = useQuery<{ items: ShareClass[] }>({
    queryKey: ['shares', 'classes'],
    queryFn:  () => api.get<{ items: ShareClass[] }>('/share-classes?active=true'),
  });
  const holdingsQ = useQuery<PaginatedResult<Holding>>({
    queryKey: ['shares', 'holdings'],
    queryFn:  () => api.get<PaginatedResult<Holding>>('/shares/holdings?limit=50'),
  });
  const ledgerQ   = useQuery<PaginatedResult<ShareTxn>>({
    queryKey: ['shares', 'ledger'],
    queryFn:  () => api.get<PaginatedResult<ShareTxn>>('/shares/transactions?limit=50'),
  });

  const onTxnCreated = async () => {
    setOpen(false);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['shares', 'summary'] }),
      qc.invalidateQueries({ queryKey: ['shares', 'holdings'] }),
      qc.invalidateQueries({ queryKey: ['shares', 'ledger'] }),
    ]);
    toast({ title: 'Transaction posted' });
  };

  const summary = summaryQ.data;
  const classes = classesQ.data?.items ?? [];
  const noClasses = !classesQ.isLoading && classes.length === 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Share Capital</h1>
          <p className="text-sm text-muted-foreground">
            Allocate, sell, transfer and redeem member shares.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/shares/classes"><SettingsIcon size={16} className="mr-2" /> Share classes</Link>
          </Button>
          <Button disabled={noClasses} onClick={() => setOpen(true)}>
            <Plus size={16} className="mr-2" /> New transaction
          </Button>
        </div>
      </div>

      {noClasses && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Layers className="h-10 w-10 text-muted-foreground" />
            <p className="text-base font-medium">No share classes yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Create at least one share class (e.g. &ldquo;Ordinary Shares&rdquo; at KES 100 par value) before you can allocate, purchase, or transfer shares.
            </p>
            <Button asChild>
              <Link href="/shares/classes">Create a share class</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {!noClasses && (
        <>
          {/* Summary cards */}
          <div className="grid gap-3 md:grid-cols-4">
            <Summary label="Share capital" value={fmtMoney(summary?.totalShareCapital)} icon={<Coins className="h-5 w-5" />} loading={summaryQ.isLoading} />
            <Summary label="Shares issued" value={fmtInt(summary?.totalShares ?? 0)}        icon={<TrendingUp className="h-5 w-5" />} loading={summaryQ.isLoading} />
            <Summary label="Shareholders"  value={fmtInt(summary?.totalShareholders ?? 0)} icon={<Users className="h-5 w-5" />}      loading={summaryQ.isLoading} />
            <Summary label="Share classes" value={fmtInt(summary?.totalClasses ?? 0)}      icon={<Layers className="h-5 w-5" />}     loading={summaryQ.isLoading} />
          </div>

          {/* By-class breakdown */}
          {(summary?.byClass.length ?? 0) > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">By class</CardTitle></CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {summary!.byClass.map((c) => (
                    <div key={c.classId} className="rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{c.name}</p>
                        <Badge variant="outline">{c.code}</Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <div><p>Issued</p><p className="text-sm text-foreground">{fmtInt(c.sharesIssued)}</p></div>
                        <div><p>Holders</p><p className="text-sm text-foreground">{fmtInt(c.shareholders)}</p></div>
                        <div><p>Capital</p><p className="text-sm text-foreground">{fmtMoney(c.capitalAtValue)}</p></div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="holdings">
            <TabsList>
              <TabsTrigger value="holdings">Holdings</TabsTrigger>
              <TabsTrigger value="ledger">Ledger</TabsTrigger>
              <TabsTrigger value="topholders">Top holders</TabsTrigger>
            </TabsList>

            <TabsContent value="holdings" className="mt-4">
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Member</th>
                        <th className="px-4 py-3">Class</th>
                        <th className="px-4 py-3 text-right">Shares</th>
                        <th className="px-4 py-3 text-right">Invested</th>
                        <th className="px-4 py-3 text-right">Value</th>
                        <th className="px-4 py-3 text-right">Appreciation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdingsQ.isLoading ? (
                        <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
                      ) : (holdingsQ.data?.items.length ?? 0) === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No shareholders yet</td></tr>
                      ) : holdingsQ.data!.items.map((h) => {
                        const value = h.quantity * Number(h.share_class_current ?? h.share_class_par);
                        const appreciation = value - Number(h.total_invested);
                        return (
                          <tr key={`${h.member_id}-${h.share_class_id}`} className="border-b last:border-b-0 hover:bg-muted/30">
                            <td className="px-4 py-2">
                              <p className="font-medium">{h.member_first_name} {h.member_last_name}</p>
                              <p className="font-mono text-xs text-muted-foreground">{h.member_phone}</p>
                            </td>
                            <td className="px-4 py-2"><Badge variant="outline">{h.share_class_code}</Badge></td>
                            <td className="px-4 py-2 text-right font-mono">{fmtInt(h.quantity)}</td>
                            <td className="px-4 py-2 text-right font-mono">{fmtMoney(h.total_invested)}</td>
                            <td className="px-4 py-2 text-right font-mono">{fmtMoney(value)}</td>
                            <td className={`px-4 py-2 text-right font-mono ${appreciation > 0 ? 'text-green-600' : appreciation < 0 ? 'text-red-600' : ''}`}>
                              {appreciation > 0 ? '+' : ''}{fmtMoney(appreciation)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ledger" className="mt-4">
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Member</th>
                        <th className="px-4 py-3">Class</th>
                        <th className="px-4 py-3 text-right">Qty</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                        <th className="px-4 py-3">Certificate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerQ.isLoading ? (
                        <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
                      ) : (ledgerQ.data?.items.length ?? 0) === 0 ? (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No transactions yet</td></tr>
                      ) : ledgerQ.data!.items.map((t) => (
                        <tr key={t.id} className={`border-b last:border-b-0 hover:bg-muted/30 ${t.status === 'reversed' ? 'opacity-60 line-through' : ''}`}>
                          <td className="px-4 py-2 font-mono text-xs">{new Date(t.posted_at).toLocaleDateString()}</td>
                          <td className="px-4 py-2">
                            <Badge variant={TYPE_BADGE[t.type] ?? 'outline'} className="capitalize">{t.type.replace('_', ' ')}</Badge>
                          </td>
                          <td className="px-4 py-2">
                            <p>{t.member_first_name} {t.member_last_name}</p>
                            {t.counterparty_first_name && (
                              <p className="text-xs text-muted-foreground">↔ {t.counterparty_first_name} {t.counterparty_last_name}</p>
                            )}
                          </td>
                          <td className="px-4 py-2"><Badge variant="outline">{t.share_class_code}</Badge></td>
                          <td className={`px-4 py-2 text-right font-mono ${t.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {t.quantity > 0 ? '+' : ''}{fmtInt(t.quantity)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">{fmtMoney(t.total_amount)}</td>
                          <td className="px-4 py-2 font-mono text-xs">
                            {t.certificate_serial ? (
                              <button
                                type="button"
                                onClick={() => {
                                  // Auth'd download — JWT is in localStorage,
                                  // a plain <a target=_blank> would 401.
                                  downloadAuthenticated(
                                    `/api/v1/shares/transactions/${t.id}/certificate`,
                                    {
                                      fallbackFilename: `share-certificate-${t.certificate_serial}.pdf`,
                                      openInNewTab: true,
                                    },
                                  ).catch((err: Error) =>
                                    toast({ variant: 'destructive', title: 'Could not open certificate', description: err.message }),
                                  );
                                }}
                                className="text-primary hover:underline"
                                title="Open share certificate PDF"
                              >
                                {t.certificate_serial}
                              </button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="topholders" className="mt-4">
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Rank</th>
                        <th className="px-4 py-3">Member</th>
                        <th className="px-4 py-3 text-right">Total shares</th>
                        <th className="px-4 py-3 text-right">Invested</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(summary?.topHolders.length ?? 0) === 0 ? (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No shareholders yet</td></tr>
                      ) : summary!.topHolders.map((h, i) => (
                        <tr key={h.memberId} className="border-b last:border-b-0 hover:bg-muted/30">
                          <td className="px-4 py-2 font-mono">#{i + 1}</td>
                          <td className="px-4 py-2">{h.firstName} {h.lastName}</td>
                          <td className="px-4 py-2 text-right font-mono">{fmtInt(h.totalShares)}</td>
                          <td className="px-4 py-2 text-right font-mono">{fmtMoney(h.totalInvested)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      <NewTransactionDialog
        open={open}
        onOpenChange={setOpen}
        classes={classes}
        onPosted={onTxnCreated}
      />
    </div>
  );
}

// ── Summary card ───────────────────────────────────────────────────────

function Summary({ label, value, icon, loading }: { label: string; value: string; icon: React.ReactNode; loading?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase text-muted-foreground">{label}</p>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <p className="mt-1 text-2xl font-semibold">{loading ? '—' : value}</p>
      </CardContent>
    </Card>
  );
}

// ── New-transaction dialog ────────────────────────────────────────────

const txnSchema = z.object({
  type:                 z.enum(['allocation', 'purchase', 'transfer', 'redemption', 'adjustment']),
  memberId:             z.string().uuid('Pick a member'),
  shareClassId:         z.string().uuid('Pick a class'),
  quantity:             z.coerce.number().int().refine((n) => n !== 0, 'Quantity is required'),
  unitPrice:            z.coerce.number().nonnegative().optional().or(z.literal('')),
  totalAmount:          z.coerce.number().nonnegative().optional().or(z.literal('')),
  counterpartyMemberId: z.string().uuid().optional().or(z.literal('')),
  paymentMethod:        z.enum(['mpesa', 'cash', 'bank_transfer', 'cheque', 'other']).optional().or(z.literal('')),
  paymentReference:     z.string().max(80).optional().or(z.literal('')),
  notes:                z.string().max(1000).optional().or(z.literal('')),
});
type TxnForm = z.infer<typeof txnSchema>;

function NewTransactionDialog({ open, onOpenChange, classes, onPosted }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  classes: ShareClass[]; onPosted: () => void;
}) {
  const { toast } = useToast();
  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<TxnForm>({
    resolver: zodResolver(txnSchema),
    defaultValues: { type: 'purchase' },
  });
  const type = useWatch({ control, name: 'type' });

  // Member list for picker. Cap at 200 active members — typeahead is a P2 feature.
  const membersQ = useQuery<{ items: MemberRow[] }>({
    queryKey: ['shares', 'member-picker'],
    queryFn:  () => api.get<{ items: MemberRow[] }>('/members?status=active&limit=200'),
    enabled:  open,
  });
  const members = membersQ.data?.items ?? [];

  const onSubmit = async (values: TxnForm) => {
    try {
      // Empty strings → undefined so the validator's `.optional()` accepts.
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v === '' || v === undefined) continue;
        body[k] = v;
      }
      await api.post('/shares/transactions', body);
      reset();
      onPosted();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to post transaction';
      toast({ variant: 'destructive', title: 'Failed', description: msg });
    }
  };

  const showPayment      = type === 'purchase' || type === 'redemption';
  const showCounterparty = type === 'transfer';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New share transaction</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="type">Type</Label>
              <select id="type" {...register('type')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="purchase">Purchase (member buys)</option>
                <option value="allocation">Allocation (free shares)</option>
                <option value="transfer">Transfer (between members)</option>
                <option value="redemption">Redemption (member sells back)</option>
                <option value="adjustment">Adjustment (admin correction)</option>
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="shareClassId">Share class</Label>
              <select id="shareClassId" {...register('shareClassId')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">— Select —</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code}) — {fmtMoney(c.current_value ?? c.par_value)}</option>
                ))}
              </select>
              {errors.shareClassId && <p className="text-xs text-red-600">{errors.shareClassId.message}</p>}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="memberId">{type === 'transfer' ? 'From member' : 'Member'}</Label>
              <select id="memberId" {...register('memberId')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">— Select —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.first_name} {m.last_name} ({m.phone})</option>
                ))}
              </select>
              {errors.memberId && <p className="text-xs text-red-600">{errors.memberId.message}</p>}
            </div>

            {showCounterparty && (
              <div className="space-y-1">
                <Label htmlFor="counterpartyMemberId">To member</Label>
                <select id="counterpartyMemberId" {...register('counterpartyMemberId')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">— Select —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.first_name} {m.last_name} ({m.phone})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="quantity">Quantity</Label>
              <Input id="quantity" type="number" step={1} placeholder="100" {...register('quantity')} />
              {errors.quantity && <p className="text-xs text-red-600">{errors.quantity.message}</p>}
              {type === 'adjustment' && (
                <p className="text-xs text-muted-foreground">Negative values reduce the holding.</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="unitPrice">Unit price (optional)</Label>
              <Input id="unitPrice" type="number" step={0.01} placeholder="Defaults to class current/par value" {...register('unitPrice')} />
            </div>
          </div>

          {showPayment && (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="totalAmount">Total amount (optional)</Label>
                <Input id="totalAmount" type="number" step={0.01} placeholder="Qty × unit price" {...register('totalAmount')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="paymentMethod">Payment method</Label>
                <select id="paymentMethod" {...register('paymentMethod')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">— Select —</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="paymentReference">Reference</Label>
                <Input id="paymentReference" placeholder="M-Pesa receipt or bank ref" {...register('paymentReference')} />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" placeholder="Optional context for the audit log" {...register('notes')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Post transaction
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
