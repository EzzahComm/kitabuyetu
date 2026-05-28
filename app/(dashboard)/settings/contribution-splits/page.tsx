'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';

interface SplitRow {
  accountCode: string;
  mode:        'percentage' | 'fixed';
  value:       string;       // kept as string for the input
  priority:    number;
}
interface ServerSplit {
  account_code: string;
  percentage:   string | null;
  fixed_amount: string | null;
  priority:     number;
}

// Sensible credit-side targets from the seeded chart of accounts (mig 032).
const ACCOUNT_SUGGESTIONS: { code: string; name: string }[] = [
  { code: '2101', name: 'Member Savings' },
  { code: '4001', name: 'Member Contributions' },
  { code: '4002', name: 'Interest Income — Loans' },
  { code: '4003', name: 'Registration Fees' },
  { code: '4004', name: 'Other Income' },
];

const DEFAULT_CODE = '4001';

export default function ContributionSplitsPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery<{ items: ServerSplit[] }>({
    queryKey: ['contribution-splits'],
    queryFn:  () => api.get<{ items: ServerSplit[] }>('/settings/contribution-splits'),
  });

  // Seed the editable rows from the server snapshot. React's documented
  // "adjust state when data changes" pattern: compare the loaded snapshot to a
  // state sentinel and setState during render (not in an effect, not via a
  // ref) so the strict react-hooks rules stay satisfied. react-query keeps a
  // stable `data` reference between renders, so this runs once per load.
  const [seededFrom, setSeededFrom] = useState<{ items: ServerSplit[] } | null>(null);
  if (data && data !== seededFrom) {
    setSeededFrom(data);
    setRows(data.items.map((s) => ({
      accountCode: s.account_code,
      mode:        s.fixed_amount != null ? 'fixed' : 'percentage',
      value:       s.fixed_amount != null ? s.fixed_amount : (s.percentage ?? ''),
      priority:    s.priority,
    })));
  }

  const pctTotal = rows
    .filter((r) => r.mode === 'percentage')
    .reduce((sum, r) => sum + (parseFloat(r.value) || 0), 0);

  const addRow = () =>
    setRows((prev) => [...prev, { accountCode: '', mode: 'percentage', value: '', priority: (prev.length + 1) * 10 }]);

  const updateRow = (i: number, patch: Partial<SplitRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    // Client-side validation mirrors the server schema for fast feedback.
    for (const r of rows) {
      if (!r.accountCode.trim()) { toast({ variant: 'destructive', title: 'Every row needs an account code' }); return; }
      if (!r.value || parseFloat(r.value) <= 0) { toast({ variant: 'destructive', title: `Enter a positive value for ${r.accountCode}` }); return; }
    }
    if (pctTotal > 100.01) { toast({ variant: 'destructive', title: `Percentages total ${pctTotal.toFixed(2)}% — must be ≤ 100` }); return; }

    setSaving(true);
    try {
      await api.put('/settings/contribution-splits', {
        rules: rows.map((r) => ({
          accountCode: r.accountCode.trim(),
          percentage:  r.mode === 'percentage' ? parseFloat(r.value) : null,
          fixedAmount: r.mode === 'fixed'      ? parseFloat(r.value) : null,
          priority:    r.priority,
        })),
      });
      toast({ title: 'Split rules saved' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save failed', description: err instanceof ApiError ? err.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/settings"><Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft size={16} /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold">Contribution splits</h1>
          <p className="text-sm text-muted-foreground">
            Auto-allocate incoming M-Pesa contributions across ledger accounts.
          </p>
        </div>
      </div>

      <Card className="bg-muted/40 border-dashed">
        <CardContent className="py-3 flex gap-2 text-sm text-muted-foreground">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>
            Fixed amounts are taken first, then the rest is split by percentage. Anything left over
            (or all of it, if no rules) goes to <strong>Member Contributions (4001)</strong>.
          </span>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : (
        <div className="space-y-3">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No splits configured — 100% goes to {DEFAULT_CODE} (Member Contributions).</p>
          )}
          {rows.map((row, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border p-3">
              <div className="space-y-1 flex-1 min-w-[140px]">
                <Label className="text-xs">Account code</Label>
                <Input
                  list="account-codes"
                  value={row.accountCode}
                  onChange={(e) => updateRow(i, { accountCode: e.target.value })}
                  placeholder="e.g. 2101"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <select
                  aria-label="Split type"
                  value={row.mode}
                  onChange={(e) => updateRow(i, { mode: e.target.value as SplitRow['mode'] })}
                  className="flex h-10 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed (KES)</option>
                </select>
              </div>
              <div className="space-y-1 w-28">
                <Label className="text-xs">{row.mode === 'percentage' ? 'Percent' : 'Amount'}</Label>
                <Input
                  type="number" step="0.01" min="0"
                  value={row.value}
                  onChange={(e) => updateRow(i, { value: e.target.value })}
                />
              </div>
              <div className="space-y-1 w-20">
                <Label className="text-xs">Priority</Label>
                <Input
                  type="number" min="0"
                  value={row.priority}
                  onChange={(e) => updateRow(i, { priority: parseInt(e.target.value, 10) || 0 })}
                />
              </div>
              <Button variant="ghost" size="icon" className="h-10 w-10 text-destructive" onClick={() => removeRow(i)}>
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
          <datalist id="account-codes">
            {ACCOUNT_SUGGESTIONS.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
          </datalist>

          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" onClick={addRow}><Plus size={15} className="mr-2" /> Add rule</Button>
            <span className={`text-sm ${pctTotal > 100.01 ? 'text-destructive' : 'text-muted-foreground'}`}>
              Percentage total: {pctTotal.toFixed(2)}%
            </span>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={save} loading={saving}>Save splits</Button>
      </div>
    </div>
  );
}
