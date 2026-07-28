'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, ShieldCheck, AlertTriangle,
  Users, Coins, TrendingUp, Headphones,
  MoreHorizontal, CheckCircle2, Ban, RefreshCw, XCircle,
  Phone, Mail, Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { StatusPill } from '@/components/shared/status-pill';
import { PaginatedTable } from '@/components/shared/paginated-table';
import type { Tone } from '@/lib/ui/tokens';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminGroup, useUpdateGroupStatus, useAdminGroupMembers } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';

interface GroupActivityRow {
  action:     string;
  table_name: string;
  created_at: string;
}

interface GroupMemberRow {
  id:          string;
  first_name:  string;
  last_name:   string;
  email:       string | null;
  phone:       string;
  member_code: string | null;
  group_role:  string;
  status:      string;
  joined_at:   string;
}

// active/pending/suspended are already mapped by STATUS_TONE; deactivated is
// group-onboarding-specific and needs an explicit override.
const GROUP_STATUS_TONE: Record<string, Tone> = {
  deactivated: 'neutral',
};

const PLAN_BADGE: Record<string, string> = {
  starter:    'bg-gray-100 text-gray-700 border-gray-200',
  growth:     'bg-blue-100 text-blue-700 border-blue-200',
  enterprise: 'bg-purple-100 text-purple-700 border-purple-200',
};

const TYPE_LABELS: Record<string, string> = {
  chama:      'Chama',
  sacco:      'SACCO',
  welfare:    'Welfare',
  investment: 'Investment',
  organization_group:  'Organization Group',
};

const ACTION_DOT: Record<string, string> = {
  INSERT: 'bg-green-500',
  UPDATE: 'bg-blue-500',
  DELETE: 'bg-red-500',
};

export default function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();

  const { data: grp, isLoading } = useAdminGroup(id);
  const updateStatus = useUpdateGroupStatus();

  const [memberPage, setMemberPage] = useState(1);
  const { data: membersData, isLoading: membersLoading } = useAdminGroupMembers(id, memberPage);

  const [confirmAction, setConfirmAction] = useState<{
    action: 'approve' | 'suspend' | 'activate' | 'deactivate';
    label: string;
  } | null>(null);
  const [reason, setReason] = useState('');

  const handleAction = async () => {
    if (!confirmAction) return;
    const needsReason = confirmAction.action === 'suspend';
    if (needsReason && !reason.trim()) return;

    try {
      await updateStatus.mutateAsync({
        id,
        action: confirmAction.action,
        reason: reason || undefined,
      });
      toast({ title: `Group ${confirmAction.label.toLowerCase()}d successfully` });
      setConfirmAction(null);
      setReason('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!grp) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">Group not found</p>
        <Button variant="link" className="mt-2" onClick={() => router.back()}>← Go back</Button>
      </div>
    );
  }

  const stats = grp.stats ?? {};
  const activity: GroupActivityRow[] = grp.recentActivity ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader
        title={grp.name}
        description={`${TYPE_LABELS[grp.group_type] ?? grp.group_type}${grp.registration_number ? ` · ${grp.registration_number}` : ''}`}
        breadcrumbs={[
          { label: 'Groups', href: '/admin/groups' },
          { label: grp.name },
        ]}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                Actions <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {grp.onboarding_status === 'pending' && (
                <DropdownMenuItem onClick={() => setConfirmAction({ action: 'approve', label: 'Approve' })}>
                  <CheckCircle2 size={13} className="mr-2 text-green-600" /> Approve Group
                </DropdownMenuItem>
              )}
              {grp.onboarding_status === 'active' && (
                <DropdownMenuItem onClick={() => setConfirmAction({ action: 'suspend', label: 'Suspend' })}
                  className="text-red-600 focus:text-red-600">
                  <Ban size={13} className="mr-2" /> Suspend Group
                </DropdownMenuItem>
              )}
              {grp.onboarding_status === 'suspended' && (
                <DropdownMenuItem onClick={() => setConfirmAction({ action: 'activate', label: 'Reactivate' })}>
                  <RefreshCw size={13} className="mr-2 text-blue-600" /> Reactivate
                </DropdownMenuItem>
              )}
              {grp.onboarding_status !== 'deactivated' && (
                <DropdownMenuItem onClick={() => setConfirmAction({ action: 'deactivate', label: 'Deactivate' })}
                  className="text-gray-600">
                  <XCircle size={13} className="mr-2" /> Deactivate
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded border capitalize ${PLAN_BADGE[grp.plan] ?? PLAN_BADGE.starter}`}>
            {grp.plan ?? 'starter'}
          </span>
          <StatusPill status={grp.onboarding_status} tone={GROUP_STATUS_TONE[grp.onboarding_status]} size="sm" />
        </div>
      </PageHeader>

      {/* Suspended banner */}
      {grp.onboarding_status === 'suspended' && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" />
          <div>
            <p className="font-semibold">Group suspended on {formatDate(grp.suspended_at)}</p>
            {grp.suspended_reason && <p className="text-xs mt-0.5 text-red-600">{grp.suspended_reason}</p>}
          </div>
        </div>
      )}

      {/* KPI stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          title="Active Members"
          value={parseInt(stats.active_members ?? '0').toLocaleString()}
          icon={Users}
          iconClass="bg-blue-50"
        />
        <StatCard
          title="Total Contributions"
          value={formatKES(stats.total_contributions ?? 0)}
          icon={Coins}
          iconClass="bg-green-50"
        />
        <StatCard
          title="Active Loans"
          value={formatKES(stats.active_loans_amount ?? 0)}
          description={`${parseInt(stats.active_loans_count ?? '0')} loans`}
          icon={TrendingUp}
          iconClass="bg-purple-50"
        />
        <StatCard
          title="Open Tickets"
          value={parseInt(stats.open_tickets ?? '0').toLocaleString()}
          icon={Headphones}
          iconClass={parseInt(stats.open_tickets ?? '0') > 0 ? 'bg-amber-50' : 'bg-gray-100'}
          className={parseInt(stats.open_tickets ?? '0') > 0 ? 'border-amber-200' : ''}
        />
      </div>

      {/* Info grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Group details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 size={14} className="text-blue-500" /> Group Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
              <div>
                <p className="text-gray-400 mb-0.5">Type</p>
                <p className="font-medium text-gray-900 capitalize">{TYPE_LABELS[grp.group_type] ?? grp.group_type}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5">Subscription</p>
                <p className="font-medium text-gray-900 capitalize">{grp.subscription_status ?? 'None'}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5">Plan Period End</p>
                <p className="font-medium text-gray-900">{grp.current_period_end ? formatDate(grp.current_period_end) : '—'}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5">Registered</p>
                <p className="font-medium text-gray-900">{formatDate(grp.created_at)}</p>
              </div>
              {grp.kyc_verified_at && (
                <div className="col-span-2">
                  <p className="text-gray-400 mb-0.5">KYC Verified</p>
                  <p className="font-medium text-green-600 flex items-center gap-1">
                    <ShieldCheck size={12} /> {formatDate(grp.kyc_verified_at)}
                  </p>
                </div>
              )}
            </div>

            {/* Risk / Engagement scores */}
            <div className="pt-2.5 border-t border-gray-100 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Risk Score</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${(grp.risk_score ?? 0) >= 70 ? 'bg-red-500' : (grp.risk_score ?? 0) >= 40 ? 'bg-amber-500' : 'bg-green-500'}`}
                      style={{ width: `${grp.risk_score ?? 0}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-700">{grp.risk_score ?? 0}</span>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Engagement Score</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${grp.engagement_score ?? 0}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-700">{grp.engagement_score ?? 0}</span>
                </div>
              </div>
            </div>

            {grp.admin_notes && (
              <div className="pt-2.5 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Admin Notes</p>
                <p className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2.5 leading-relaxed">{grp.admin_notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Admin contact */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users size={14} className="text-purple-500" /> Group Administrator
            </CardTitle>
          </CardHeader>
          <CardContent>
            {grp.admin_name ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-purple-700">
                      {grp.admin_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{grp.admin_name}</p>
                    <p className="text-xs text-gray-500">Chairperson</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {grp.admin_email && (
                    <a href={`mailto:${grp.admin_email}`}
                      className="flex items-center gap-2 text-xs text-gray-600 hover:text-blue-600 transition-colors">
                      <Mail size={12} /> {grp.admin_email}
                    </a>
                  )}
                  {grp.admin_phone && (
                    <a href={`tel:${grp.admin_phone}`}
                      className="flex items-center gap-2 text-xs text-gray-600 hover:text-blue-600 transition-colors">
                      <Phone size={12} /> {grp.admin_phone}
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">No admin assigned</p>
            )}

            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Financial Summary</p>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Total Payments Collected</span>
                  <span className="font-semibold text-gray-900">{formatKES(stats.total_payments ?? 0)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Active Loan Portfolio</span>
                  <span className="font-semibold text-blue-600">{formatKES(stats.active_loans_amount ?? 0)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Members — SUPER_ADMIN_PLATFORM_AUDIT.md §2.1/§2.5 Phase 1: this
          page previously had no member table at all, only aggregate stats. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users size={14} className="text-blue-500" /> Members ({membersData?.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PaginatedTable<GroupMemberRow>
            data={membersData ? {
              items: membersData.items as GroupMemberRow[], total: membersData.total,
              page: membersData.page, pageSize: membersData.limit,
              totalPages: Math.ceil(membersData.total / membersData.limit),
            } : null}
            isLoading={membersLoading}
            onPageChange={setMemberPage}
            emptyMessage="No active members"
            onRowClick={(m) => router.push(`/admin/groups/${id}/members/${m.id}`)}
            columns={[
              {
                key: 'name', header: 'Name',
                render: (m) => (
                  <div>
                    <p className="font-medium text-gray-900">{m.first_name} {m.last_name}</p>
                    {m.member_code && <p className="text-[11px] font-mono text-gray-400">{m.member_code}</p>}
                  </div>
                ),
              },
              { key: 'contact', header: 'Contact', render: (m) => <span className="text-xs text-gray-600">{m.phone}{m.email ? ` · ${m.email}` : ''}</span> },
              { key: 'role', header: 'Role', render: (m) => <span className="text-xs text-gray-600 capitalize">{m.group_role?.replace('_', ' ')}</span> },
              { key: 'joined', header: 'Joined', render: (m) => <span className="text-xs text-gray-500">{formatDate(m.joined_at)}</span> },
            ]}
          />
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity size={14} className="text-gray-500" /> Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No recent activity</p>
          ) : (
            <div className="space-y-1">
              {activity.map((log, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${ACTION_DOT[log.action] ?? 'bg-gray-400'}`} />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-gray-700">{log.action}</span>
                    <span className="text-xs text-gray-400 mx-1.5">·</span>
                    <span className="text-xs text-gray-600 font-mono">{log.table_name}</span>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{formatDate(log.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm action dialog */}
      <Dialog open={!!confirmAction} onOpenChange={() => { setConfirmAction(null); setReason(''); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirmAction?.label} Group</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmAction?.action === 'suspend'
              ? `This will immediately restrict access for all members of "${grp.name}".`
              : confirmAction?.action === 'deactivate'
              ? `This will permanently deactivate "${grp.name}" and revoke all access.`
              : `Confirm that you want to ${confirmAction?.label?.toLowerCase()} "${grp.name}".`}
          </p>
          {confirmAction?.action === 'suspend' && (
            <div className="space-y-1">
              <Label>Reason for suspension <span className="text-red-500">*</span></Label>
              <textarea
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Provide a reason that will be logged…"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmAction(null); setReason(''); }}>
              Cancel
            </Button>
            <Button
              onClick={handleAction}
              loading={updateStatus.isPending}
              disabled={confirmAction?.action === 'suspend' && !reason.trim()}
              variant={confirmAction?.action === 'suspend' || confirmAction?.action === 'deactivate' ? 'destructive' : 'default'}
            >
              Confirm {confirmAction?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
