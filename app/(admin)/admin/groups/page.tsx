'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Building2, MoreHorizontal,
  CheckCircle2, PauseCircle, PlayCircle, XCircle,
  ArrowUpRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminGroups, useUpdateGroupStatus } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';

interface AdminGroupRow {
  id:                  string;
  name:                string;
  group_type:          string;
  onboarding_status:   string;
  risk_score:          number;
  created_at:          string;
  plan:                string;
  member_count:        string;
  total_contributions: string;
  active_loans:        string;
}

const STATUS_BADGE: Record<string, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  active:      'success',
  suspended:   'destructive',
  pending:     'warning',
  deactivated: 'secondary',
  kyc_verified:'success',
  kyc_submitted:'warning',
};

const PLAN_BADGE: Record<string, string> = {
  starter:    'bg-gray-100 text-gray-600',
  growth:     'bg-blue-100 text-blue-700',
  enterprise: 'bg-purple-100 text-purple-700',
};

function RiskBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'text-red-600 bg-red-50' :
                score >= 40 ? 'text-amber-600 bg-amber-50' : 'text-green-600 bg-green-50';
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`}>
      {score >= 70 ? 'HIGH' : score >= 40 ? 'MED' : 'LOW'} {score}
    </span>
  );
}

export default function GroupsPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [page,     setPage]     = useState(1);
  const [search,   setSearch]   = useState('');
  const [status,   setStatus]   = useState('');
  const [plan,     setPlan]     = useState('');
  const [confirm,  setConfirm]  = useState<{
    id: string; action: 'approve' | 'suspend' | 'activate' | 'deactivate'; name: string;
  } | null>(null);
  const [reason,   setReason]   = useState('');

  const { data, isLoading } = useAdminGroups({ page, limit: 25, search, status, plan });
  const updateStatus = useUpdateGroupStatus();

  const items: AdminGroupRow[] = data?.items ?? [];
  const total        = data?.total ?? 0;
  const totalPages   = Math.ceil(total / 25);

  const handleAction = async () => {
    if (!confirm) return;
    try {
      await updateStatus.mutateAsync({ id: confirm.id, action: confirm.action, reason });
      toast({ title: `Group ${confirm.action}d successfully` });
      setConfirm(null); setReason('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Groups</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {total.toLocaleString()} total · savings groups on the platform — lifecycle, KYC, subscriptions
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search by name or registration…"
                className="pl-8 h-8 text-sm"
              />
            </div>

            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="h-8 text-sm border border-input rounded-md px-2 bg-background"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="suspended">Suspended</option>
              <option value="deactivated">Deactivated</option>
            </select>

            <select
              value={plan}
              onChange={(e) => { setPlan(e.target.value); setPage(1); }}
              className="h-8 text-sm border border-input rounded-md px-2 bg-background"
            >
              <option value="">All plans</option>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="enterprise">Enterprise</option>
            </select>

            {(search || status || plan) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs"
                onClick={() => { setSearch(''); setStatus(''); setPlan(''); setPage(1); }}>
                Clear
              </Button>
            )}

            <div className="ml-auto text-xs text-muted-foreground">
              {total} result{total !== 1 ? 's' : ''}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Group</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Plan</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Members</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Contributions</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Active Loans</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Risk</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(8)].map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full max-w-[120px]" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-sm text-muted-foreground">
                    No groups found
                  </td>
                </tr>
              ) : items.map((grp) => (
                <tr
                  key={grp.id}
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/admin/groups/${grp.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                        <Building2 size={13} className="text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{grp.name}</p>
                        <p className="text-xs text-gray-400 capitalize">{grp.group_type?.replace('_', ' ')}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${PLAN_BADGE[grp.plan] ?? 'bg-gray-100 text-gray-600'}`}>
                      {grp.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_BADGE[grp.onboarding_status] ?? 'secondary'} className="text-xs capitalize">
                      {grp.onboarding_status?.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{grp.member_count}</td>
                  <td className="px-4 py-3 text-right text-green-600 font-medium">
                    {formatKES(grp.total_contributions)}
                  </td>
                  <td className="px-4 py-3 text-right text-blue-600 font-medium">
                    {formatKES(grp.active_loans)}
                  </td>
                  <td className="px-4 py-3">
                    <RiskBadge score={grp.risk_score ?? 0} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(grp.created_at)}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <MoreHorizontal size={14} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => router.push(`/admin/groups/${grp.id}`)}>
                          <ArrowUpRight size={13} className="mr-2" /> View details
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {grp.onboarding_status === 'pending' && (
                          <DropdownMenuItem className="text-green-700"
                            onClick={() => setConfirm({ id: grp.id, action: 'approve', name: grp.name })}>
                            <CheckCircle2 size={13} className="mr-2" /> Approve
                          </DropdownMenuItem>
                        )}
                        {grp.onboarding_status === 'active' && (
                          <DropdownMenuItem className="text-amber-700"
                            onClick={() => setConfirm({ id: grp.id, action: 'suspend', name: grp.name })}>
                            <PauseCircle size={13} className="mr-2" /> Suspend
                          </DropdownMenuItem>
                        )}
                        {grp.onboarding_status === 'suspended' && (
                          <DropdownMenuItem className="text-green-700"
                            onClick={() => setConfirm({ id: grp.id, action: 'activate', name: grp.name })}>
                            <PlayCircle size={13} className="mr-2" /> Reactivate
                          </DropdownMenuItem>
                        )}
                        {grp.onboarding_status !== 'deactivated' && (
                          <DropdownMenuItem className="text-red-700"
                            onClick={() => setConfirm({ id: grp.id, action: 'deactivate', name: grp.name })}>
                            <XCircle size={13} className="mr-2" /> Deactivate
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              Page {page} of {totalPages} · {total} groups
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs"
                disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs"
                disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Confirm action dialog */}
      <Dialog open={!!confirm} onOpenChange={() => { setConfirm(null); setReason(''); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="capitalize">{confirm?.action} Group</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            You are about to <strong>{confirm?.action}</strong> <strong>{confirm?.name}</strong>.
          </p>
          {confirm?.action === 'suspend' && (
            <div className="space-y-1">
              <Label>Reason (required)</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Policy violation — pending investigation"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirm(null); setReason(''); }}>Cancel</Button>
            <Button
              onClick={handleAction}
              disabled={confirm?.action === 'suspend' && !reason.trim()}
              loading={updateStatus.isPending}
              className={confirm?.action === 'deactivate' || confirm?.action === 'suspend'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-green-600 hover:bg-green-700'}
            >
              Confirm {confirm?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
