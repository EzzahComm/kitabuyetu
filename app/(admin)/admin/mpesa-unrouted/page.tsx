'use client';

import { useState } from 'react';
import { Search, Wallet, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { PaginatedTable } from '@/components/shared/paginated-table';
import {
  useAdminUnroutedPayments, useResolveUnroutedPayment, useAdminGroups, useAdminGroupMembers,
} from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { formatDate, formatKES, getErrorMessage } from '@/lib/utils';

interface UnroutedRow {
  id:                   string;
  receipt:              string;
  phone:                string;
  amount:               string;
  bill_ref:             string | null;
  reason:               string;
  candidate_group_id:   string | null;
  candidate_group_name: string | null;
  created_at:           string;
}

/**
 * Staff/super_admin queue for M-Pesa payments the C2B router couldn't place.
 *
 * Exists alongside the treasurer-facing Unrouted screen inside each group's
 * own dashboard: that one can only resolve a row whose candidate_group_id
 * already matches the signed-in treasurer's group, and the router leaves
 * candidate_group_id NULL whenever it can't even guess a group
 * (reason='unknown_prefix') — which is most rows here. No group's treasurer
 * session can ever reach those, no matter how obvious the right member is
 * from the receipt reference or the payer's name on the C2B payload. This
 * page picks the group explicitly instead of relying on that guess.
 */
export default function MpesaUnroutedPage() {
  const { toast } = useToast();
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<UnroutedRow | null>(null);
  const [action, setAction] = useState<'allocate' | 'dismiss'>('allocate');
  const [groupSearch, setGroupSearch] = useState('');
  const [groupId, setGroupId]   = useState('');
  const [memberId, setMemberId] = useState('');
  const [notes, setNotes]       = useState('');

  const { data, isLoading, isError, error } = useAdminUnroutedPayments({ page, limit: 20, search });
  const resolve = useResolveUnroutedPayment();

  const { data: groupResults } = useAdminGroups({ search: groupSearch, limit: 8 });
  const { data: memberResults } = useAdminGroupMembers(groupId, 1);

  const items: UnroutedRow[] = data?.items ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);
  const totalAmount = items.reduce((sum, r) => sum + Number(r.amount), 0);

  const openResolve = (row: UnroutedRow) => {
    setTarget(row);
    setAction(row.candidate_group_id ? 'allocate' : 'allocate');
    setGroupId(row.candidate_group_id ?? '');
    setGroupSearch('');
    setMemberId('');
    setNotes('');
  };

  const closeResolve = () => setTarget(null);

  const handleSubmit = async () => {
    if (!target) return;
    if (action === 'allocate' && (!groupId || !memberId)) {
      toast({ variant: 'destructive', title: 'Pick a group and a member first' });
      return;
    }
    try {
      await resolve.mutateAsync({
        id: target.id, action,
        groupId: action === 'allocate' ? groupId : (groupId || undefined),
        memberId: action === 'allocate' ? memberId : undefined,
        notes: notes || undefined,
      });
      toast({ title: action === 'allocate' ? 'Payment allocated' : 'Payment dismissed' });
      closeResolve();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Unrouted M-Pesa Payments"
        description="Payments the automatic router couldn't place — allocate to a member, or dismiss (e.g. a confirmed test payment)"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard title="Unresolved" value={total} icon={Wallet} iconClass="bg-amber-50" />
        <StatCard title="Total value" value={formatKES(totalAmount)} icon={Wallet} iconClass="bg-blue-50" />
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search by receipt or account ref…"
                className="pl-8 h-8 text-sm"
              />
            </div>
            <span className="ml-auto text-xs text-gray-400">{total} unresolved</span>
          </div>
        </CardContent>
      </Card>

      <PaginatedTable<UnroutedRow>
        data={{ items, total, page, pageSize: 20, totalPages }}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={setPage}
        emptyMessage="No unrouted payments — the queue is clear"
        columns={[
          {
            key: 'receipt', header: 'Receipt',
            render: (row) => <span className="font-mono text-xs text-gray-700">{row.receipt}</span>,
          },
          { key: 'amount', header: 'Amount', render: (row) => <span className="font-semibold text-sm">{formatKES(Number(row.amount))}</span> },
          {
            key: 'ref', header: 'Account ref',
            render: (row) => <span className="font-mono text-xs text-gray-600">{row.bill_ref ?? '—'}</span>,
          },
          {
            key: 'candidate', header: 'Candidate group',
            render: (row) => row.candidate_group_name
              ? <span className="text-sm">{row.candidate_group_name}</span>
              : <span className="text-xs text-gray-400 italic">none — router couldn&apos;t guess</span>,
          },
          { key: 'reason', header: 'Reason', render: (row) => <span className="text-xs text-gray-500">{row.reason}</span> },
          { key: 'date', header: 'Paid', render: (row) => <span className="text-xs text-gray-500">{formatDate(row.created_at)}</span> },
          {
            key: 'actions', header: '',
            render: (row) => (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openResolve(row)}>
                Resolve
              </Button>
            ),
          },
        ]}
      />

      <Dialog open={!!target} onOpenChange={(open) => { if (!open) closeResolve(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve {target?.receipt}</DialogTitle>
          </DialogHeader>
          {target && (
            <div className="space-y-4">
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 space-y-0.5">
                <p><span className="font-medium">{formatKES(Number(target.amount))}</span> · ref <span className="font-mono">{target.bill_ref ?? '—'}</span></p>
                <p>{target.reason}</p>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button" size="sm" variant={action === 'allocate' ? 'default' : 'outline'}
                  className="flex-1 h-8 text-xs" onClick={() => setAction('allocate')}
                >
                  <CheckCircle2 size={13} className="mr-1.5" /> Allocate
                </Button>
                <Button
                  type="button" size="sm" variant={action === 'dismiss' ? 'default' : 'outline'}
                  className="flex-1 h-8 text-xs" onClick={() => setAction('dismiss')}
                >
                  <XCircle size={13} className="mr-1.5" /> Dismiss
                </Button>
              </div>

              {action === 'allocate' && (
                <>
                  <div className="space-y-1">
                    <Label>Group</Label>
                    {groupId ? (
                      <div className="flex items-center justify-between rounded-md border border-input px-3 py-2 text-sm">
                        <span>{groupResults?.items.find((g) => g.id === groupId)?.name ?? target.candidate_group_name ?? groupId}</span>
                        <button type="button" className="text-xs text-gray-400 hover:text-gray-700" onClick={() => { setGroupId(''); setMemberId(''); }}>
                          Change
                        </button>
                      </div>
                    ) : (
                      <>
                        <Input
                          value={groupSearch}
                          onChange={(e) => setGroupSearch(e.target.value)}
                          placeholder="Search group by name…"
                          className="h-9 text-sm"
                        />
                        {groupSearch && (
                          <div className="max-h-40 overflow-y-auto rounded-md border border-input divide-y">
                            {(groupResults?.items ?? []).map((g) => (
                              <button
                                key={g.id} type="button"
                                className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                                onClick={() => { setGroupId(g.id); setMemberId(''); }}
                              >
                                {g.name}
                              </button>
                            ))}
                            {groupResults?.items.length === 0 && (
                              <p className="px-3 py-2 text-xs text-gray-400">No groups match</p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {groupId && (
                    <div className="space-y-1">
                      <Label>Member</Label>
                      <select
                        value={memberId}
                        onChange={(e) => setMemberId(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">Select a member…</option>
                        {(memberResults?.items ?? []).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.first_name} {m.last_name} ({m.member_code})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              <div className="space-y-1">
                <Label>Notes</Label>
                <textarea
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={action === 'dismiss' ? 'Why this is being dismissed (e.g. confirmed test payment)…' : 'Optional context…'}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeResolve}>Cancel</Button>
            <Button onClick={handleSubmit} loading={resolve.isPending}>
              {action === 'allocate' ? 'Allocate' : 'Dismiss'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
