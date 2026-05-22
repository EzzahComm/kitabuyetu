'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Building2, ShieldCheck, AlertTriangle,
  Users, Coins, TrendingUp, Headphones,
  MoreHorizontal, CheckCircle2, Ban, RefreshCw, XCircle,
  Calendar, Phone, Mail, FileText, Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminOrganization, useUpdateOrganizationStatus } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate } from '@/lib/utils';

const STATUS_VARIANT: Record<string, any> = {
  active:      'success',
  pending:     'warning',
  suspended:   'destructive',
  deactivated: 'secondary',
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
  ngo_group:  'NGO Group',
};

const ACTION_DOT: Record<string, string> = {
  INSERT: 'bg-green-500',
  UPDATE: 'bg-blue-500',
  DELETE: 'bg-red-500',
};

function StatCard({
  icon: Icon, label, value, color = 'text-gray-900', sub,
}: {
  icon: React.ElementType; label: string; value: string | number; color?: string; sub?: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-gray-400" />
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();

  const { data: org, isLoading } = useAdminOrganization(id);
  const updateStatus = useUpdateOrganizationStatus();

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
      toast({ title: `Organization ${confirmAction.label.toLowerCase()}d successfully` });
      setConfirmAction(null);
      setReason('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
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

  if (!org) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">Organization not found</p>
        <Button variant="link" className="mt-2" onClick={() => router.back()}>← Go back</Button>
      </div>
    );
  }

  const stats = org.stats ?? {};

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0"
          onClick={() => router.push('/admin/organizations')}>
          <ArrowLeft size={16} />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900 truncate">{org.name}</h1>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded border capitalize ${PLAN_BADGE[org.plan] ?? PLAN_BADGE.starter}`}>
              {org.plan ?? 'starter'}
            </span>
            <Badge variant={STATUS_VARIANT[org.onboarding_status] ?? 'secondary'} className="text-xs capitalize">
              {org.onboarding_status?.replace('_', ' ')}
            </Badge>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {TYPE_LABELS[org.group_type] ?? org.group_type}
            {org.registration_number && (
              <span className="ml-2 font-mono text-xs text-gray-400">· {org.registration_number}</span>
            )}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              Actions <MoreHorizontal size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {org.onboarding_status === 'pending' && (
              <DropdownMenuItem onClick={() => setConfirmAction({ action: 'approve', label: 'Approve' })}>
                <CheckCircle2 size={13} className="mr-2 text-green-600" /> Approve Organization
              </DropdownMenuItem>
            )}
            {org.onboarding_status === 'active' && (
              <DropdownMenuItem onClick={() => setConfirmAction({ action: 'suspend', label: 'Suspend' })}
                className="text-red-600 focus:text-red-600">
                <Ban size={13} className="mr-2" /> Suspend Organization
              </DropdownMenuItem>
            )}
            {org.onboarding_status === 'suspended' && (
              <DropdownMenuItem onClick={() => setConfirmAction({ action: 'activate', label: 'Reactivate' })}>
                <RefreshCw size={13} className="mr-2 text-blue-600" /> Reactivate
              </DropdownMenuItem>
            )}
            {org.onboarding_status !== 'deactivated' && (
              <DropdownMenuItem onClick={() => setConfirmAction({ action: 'deactivate', label: 'Deactivate' })}
                className="text-gray-600">
                <XCircle size={13} className="mr-2" /> Deactivate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Suspended banner */}
      {org.onboarding_status === 'suspended' && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" />
          <div>
            <p className="font-semibold">Organization suspended on {formatDate(org.suspended_at)}</p>
            {org.suspended_reason && <p className="text-xs mt-0.5 text-red-600">{org.suspended_reason}</p>}
          </div>
        </div>
      )}

      {/* KPI stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={Users}    label="Active Members"    value={parseInt(stats.active_members ?? '0').toLocaleString()} color="text-blue-600" />
        <StatCard icon={Coins}    label="Total Contributions" value={formatKES(stats.total_contributions ?? 0)} color="text-green-600" />
        <StatCard icon={TrendingUp} label="Active Loans"    value={formatKES(stats.active_loans_amount ?? 0)}
          sub={`${parseInt(stats.active_loans_count ?? '0')} loans`} color="text-purple-600" />
        <StatCard icon={Headphones} label="Open Tickets"   value={parseInt(stats.open_tickets ?? '0').toLocaleString()}
          color={parseInt(stats.open_tickets ?? '0') > 0 ? 'text-amber-600' : 'text-gray-400'} />
      </div>

      {/* Info grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Organization details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 size={14} className="text-blue-500" /> Organization Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
              <div>
                <p className="text-gray-400 mb-0.5">Type</p>
                <p className="font-medium text-gray-900 capitalize">{TYPE_LABELS[org.group_type] ?? org.group_type}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5">Subscription</p>
                <p className="font-medium text-gray-900 capitalize">{org.subscription_status ?? 'None'}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5">Plan Period End</p>
                <p className="font-medium text-gray-900">{org.current_period_end ? formatDate(org.current_period_end) : '—'}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5">Member Since</p>
                <p className="font-medium text-gray-900">{formatDate(org.created_at)}</p>
              </div>
              {org.kyc_verified_at && (
                <div className="col-span-2">
                  <p className="text-gray-400 mb-0.5">KYC Verified</p>
                  <p className="font-medium text-green-600 flex items-center gap-1">
                    <ShieldCheck size={12} /> {formatDate(org.kyc_verified_at)}
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
                      className={`h-full rounded-full ${(org.risk_score ?? 0) >= 70 ? 'bg-red-500' : (org.risk_score ?? 0) >= 40 ? 'bg-amber-500' : 'bg-green-500'}`}
                      style={{ width: `${org.risk_score ?? 0}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-700">{org.risk_score ?? 0}</span>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Engagement Score</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${org.engagement_score ?? 0}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-700">{org.engagement_score ?? 0}</span>
                </div>
              </div>
            </div>

            {org.admin_notes && (
              <div className="pt-2.5 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Admin Notes</p>
                <p className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2.5 leading-relaxed">{org.admin_notes}</p>
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
            {org.admin_name ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-purple-700">
                      {org.admin_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{org.admin_name}</p>
                    <p className="text-xs text-gray-500">Group Admin</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {org.admin_email && (
                    <a href={`mailto:${org.admin_email}`}
                      className="flex items-center gap-2 text-xs text-gray-600 hover:text-blue-600 transition-colors">
                      <Mail size={12} /> {org.admin_email}
                    </a>
                  )}
                  {org.admin_phone && (
                    <a href={`tel:${org.admin_phone}`}
                      className="flex items-center gap-2 text-xs text-gray-600 hover:text-blue-600 transition-colors">
                      <Phone size={12} /> {org.admin_phone}
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

      {/* Recent activity */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity size={14} className="text-gray-500" /> Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {org.recentActivity?.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No recent activity</p>
          ) : (
            <div className="space-y-1">
              {(org.recentActivity ?? []).map((log: any, i: number) => (
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
            <DialogTitle>{confirmAction?.label} Organization</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmAction?.action === 'suspend'
              ? `This will immediately restrict access for all members of "${org.name}".`
              : confirmAction?.action === 'deactivate'
              ? `This will permanently deactivate "${org.name}" and revoke all access.`
              : `Confirm that you want to ${confirmAction?.label?.toLowerCase()} "${org.name}".`}
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
