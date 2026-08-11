'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Building2, MoreHorizontal,
  CheckCircle2, PauseCircle, PlayCircle, XCircle,
  ArrowUpRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/page-header';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { StatusPill } from '@/components/shared/status-pill';
import type { Tone } from '@/lib/ui/tokens';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useAdminGroups, useUpdateGroupStatus } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import type { SubscriptionProduct } from '@/types/enums';

interface AdminGroupRow {
  id:                  string;
  name:                string;
  group_type:          string;
  onboarding_status:   string;
  health_score:        number | null;
  health_rag:          'green' | 'amber' | 'red' | null;
  created_at:          string;
  plan:                string;
  member_count:        string;
  total_contributions: string;
  active_loans:        string;
}

// active/suspended/pending are already mapped by STATUS_TONE; only the
// group-onboarding-specific statuses need an explicit override here.
const GROUP_STATUS_TONE: Record<string, Tone> = {
  deactivated:   'neutral',
  kyc_verified:  'positive',
  kyc_submitted: 'pending',
};

const PLAN_BADGE: Record<string, string> = {
  starter:    'bg-gray-100 text-gray-600',
  growth:     'bg-blue-100 text-blue-700',
  enterprise: 'bg-purple-100 text-purple-700',
};

// Sourced from governance_health_scores (the health-scoring engine,
// SUPER_ADMIN_PLATFORM_AUDIT.md §2.10) — null until that group's first
// monthly computation run has happened, not a fake zero.
function HealthBadge({ score, rag }: { score: number | null; rag: 'green' | 'amber' | 'red' | null }) {
  if (score === null || rag === null) {
    return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">Not yet scored</span>;
  }
  const color = rag === 'red' ? 'text-red-600 bg-red-50' :
                rag === 'amber' ? 'text-amber-600 bg-amber-50' : 'text-green-600 bg-green-50';
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`}>
      {rag.toUpperCase()} {score}
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
  // Which product the Plan column describes and the plan filter applies to.
  // Not blank-able: every group has a product, so "all products" would mean
  // showing a group once per product — exactly the duplication migration 127's
  // LATERAL exists to prevent.
  const [product,  setProduct]  = useState<SubscriptionProduct>('kitabu_yetu');
  const [confirm,  setConfirm]  = useState<{
    id: string; action: 'approve' | 'suspend' | 'activate' | 'deactivate'; name: string;
  } | null>(null);
  const [reason,   setReason]   = useState('');

  const { data, isLoading, isError, error } = useAdminGroups({ page, limit: 25, search, status, plan, product });
  const updateStatus = useUpdateGroupStatus();

  const items: AdminGroupRow[] = data?.items ?? [];
  const total        = data?.total ?? 0;
  const totalPages   = Math.ceil(total / 25);
  const tableData     = data ? { items, total, page: data.page, pageSize: 25, totalPages } : null;

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
      <PageHeader
        title="Groups"
        description={`${total.toLocaleString()} total · savings groups on the platform — lifecycle, KYC, subscriptions`}
      />

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
              value={product}
              onChange={(e) => { setProduct(e.target.value as SubscriptionProduct); setPage(1); }}
              className="h-8 text-sm border border-input rounded-md px-2 bg-background"
              aria-label="Product"
            >
              <option value="kitabu_yetu">Kitabu Yetu</option>
              <option value="chama_reminder">Chama Reminder</option>
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

            {(search || status || plan || product !== 'kitabu_yetu') && (
              <Button variant="ghost" size="sm" className="h-8 text-xs"
                onClick={() => {
                  setSearch(''); setStatus(''); setPlan(''); setProduct('kitabu_yetu'); setPage(1);
                }}>
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
      <PaginatedTable
        data={tableData}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={setPage}
        emptyMessage="No groups found"
        onRowClick={(grp) => router.push(`/admin/groups/${grp.id}`)}
        columns={[
          {
            key: 'group', header: 'Group',
            render: (grp) => (
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                  <Building2 size={13} className="text-blue-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{grp.name}</p>
                  <p className="text-xs text-gray-400 capitalize">{grp.group_type?.replace('_', ' ')}</p>
                </div>
              </div>
            ),
          },
          {
            key: 'plan', header: 'Plan',
            render: (grp) => (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${PLAN_BADGE[grp.plan] ?? 'bg-gray-100 text-gray-600'}`}>
                {grp.plan}
              </span>
            ),
          },
          {
            key: 'status', header: 'Status',
            render: (grp) => (
              <StatusPill status={grp.onboarding_status} tone={GROUP_STATUS_TONE[grp.onboarding_status]} size="sm" />
            ),
          },
          { key: 'member_count', header: 'Members', className: 'text-right', render: (grp) => <span className="font-medium">{grp.member_count}</span> },
          {
            key: 'total_contributions', header: 'Contributions', className: 'text-right',
            render: (grp) => <span className="text-green-600 font-medium">{formatKES(grp.total_contributions)}</span>,
          },
          {
            key: 'active_loans', header: 'Active Loans', className: 'text-right',
            render: (grp) => <span className="text-blue-600 font-medium">{formatKES(grp.active_loans)}</span>,
          },
          { key: 'health_score', header: 'Health', render: (grp) => <HealthBadge score={grp.health_score} rag={grp.health_rag} /> },
          { key: 'created_at', header: 'Joined', render: (grp) => <span className="text-xs text-gray-500">{formatDate(grp.created_at)}</span> },
          {
            key: 'actions', header: '',
            render: (grp) => (
              <div onClick={(e) => e.stopPropagation()}>
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
              </div>
            ),
          },
        ]}
      />

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
