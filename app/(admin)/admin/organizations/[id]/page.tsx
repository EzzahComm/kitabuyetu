'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Landmark, Users, Layers, Wallet, TrendingUp,
  MoreHorizontal, PlayCircle, XCircle, Plus, Trash2, Phone, Mail, Info, UserCog, RotateCw, Ban, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { StatusPill } from '@/components/shared/status-pill';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  useAdminOrganization, useUpdateOrganizationStatus,
  useAssignGroupToOrg, useRevokeGroupFromOrg,
  useOrgStaff, useAddOrgStaff, useInviteOrgStaff, useChangeOrgStaffRole, useRemoveOrgStaff,
  useOrgInvitations, useResendOrgInvitation, useCancelOrgInvitation,
  useOrganizationPlan, useAssignOrganizationPlan,
} from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';

interface AssignedGroupRow {
  group_id:            string;
  access_level:        string;
  granted_at:          string;
  group_name:          string;
  group_code:          string;
  group_type:          string;
  onboarding_status:   string;
  member_count:        string;
  total_contributions: string;
}

interface AssignableGroupRow {
  id:         string;
  name:       string;
  group_code: string;
  group_type: string;
}

interface OrgWalletRow {
  currency:          string;
  available_balance: string;
  committed_balance: string;
  total_deposited:   string;
  total_disbursed:   string;
  total_returned:    string;
}

const TYPE_LABEL: Record<string, string> = {
  bank: 'Bank', sacco: 'SACCO', foundation: 'Foundation', ngo: 'NGO',
  government: 'Government', cooperative: 'Cooperative', faith_based: 'Faith-based', other: 'Other',
};

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
  const assignGroup  = useAssignGroupToOrg();
  const revokeGroup  = useRevokeGroupFromOrg();

  const { data: staff, isLoading: staffLoading } = useOrgStaff(id);
  const addStaff        = useAddOrgStaff();
  const inviteStaff      = useInviteOrgStaff();
  const changeStaffRole = useChangeOrgStaffRole();
  const removeStaff    = useRemoveOrgStaff();

  const { data: invitations, isLoading: invitationsLoading } = useOrgInvitations(id);
  const resendInvitation = useResendOrgInvitation();
  const cancelInvitation = useCancelOrgInvitation();

  const { data: planData, isLoading: planLoading } = useOrganizationPlan(id);
  const assignPlan = useAssignOrganizationPlan();
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planType, setPlanType] = useState<'starter' | 'growth' | 'premium' | 'premium_plus'>('starter');
  const [customFee, setCustomFee]           = useState('');
  const [customGroups, setCustomGroups]     = useState('');
  const [customStaff, setCustomStaff]       = useState('');
  const [customPrograms, setCustomPrograms] = useState('');
  const [customSms, setCustomSms]           = useState('');
  const [customSupport, setCustomSupport]   = useState<'standard' | 'priority' | 'priority_plus'>('priority_plus');

  const [assignOpen, setAssignOpen]   = useState(false);
  const [pickGroup, setPickGroup]     = useState('');
  const [accessLevel, setAccessLevel] = useState<'read' | 'report'>('read');
  const [revoking, setRevoking]       = useState<{ groupId: string; name: string } | null>(null);

  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [staffMode, setStaffMode]       = useState<'direct' | 'invite'>('direct');
  const [staffPhone, setStaffPhone]     = useState('');
  const [staffEmail, setStaffEmail]     = useState('');
  const [staffFirst, setStaffFirst]     = useState('');
  const [staffLast, setStaffLast]       = useState('');
  const [staffRole, setStaffRole]       = useState<'lead' | 'staff'>('staff');
  const [removingStaff, setRemovingStaff] = useState<{ memberId: string; name: string } | null>(null);

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
        <Button variant="link" className="mt-2" onClick={() => router.push('/admin/organizations')}>← Back to organizations</Button>
      </div>
    );
  }

  const assigned:   AssignedGroupRow[]   = org.assignedGroups ?? [];
  const assignable: AssignableGroupRow[] = org.assignableGroups ?? [];
  const wallets:    OrgWalletRow[]       = org.wallets ?? [];
  const walletKES = wallets.find((w) => w.currency === 'KES');
  const memberReach = assigned.reduce((s, g) => s + parseInt(g.member_count ?? '0', 10), 0);

  const doAssign = async () => {
    if (!pickGroup) { toast({ variant: 'destructive', title: 'Pick a group to assign' }); return; }
    try {
      await assignGroup.mutateAsync({ orgId: id, groupId: pickGroup, accessLevel });
      toast({ title: 'Group assigned' });
      setAssignOpen(false); setPickGroup(''); setAccessLevel('read');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Assign failed', description: getErrorMessage(e) });
    }
  };

  const doRevoke = async () => {
    if (!revoking) return;
    try {
      await revokeGroup.mutateAsync({ orgId: id, groupId: revoking.groupId });
      toast({ title: `${revoking.name} unassigned` });
      setRevoking(null);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Revoke failed', description: getErrorMessage(e) });
    }
  };

  const toggleActive = async () => {
    try {
      await updateStatus.mutateAsync({ id, action: org.is_active ? 'deactivate' : 'activate' });
      toast({ title: `Organization ${org.is_active ? 'deactivated' : 'activated'}` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const resetStaffForm = () => {
    setStaffPhone(''); setStaffEmail(''); setStaffFirst(''); setStaffLast(''); setStaffRole('staff');
  };

  const doAddStaff = async () => {
    if (!staffPhone || !staffFirst || !staffLast) {
      toast({ variant: 'destructive', title: 'Phone, first name, and last name are required' });
      return;
    }
    try {
      await addStaff.mutateAsync({
        orgId: id, phone: staffPhone, firstName: staffFirst, lastName: staffLast, orgRole: staffRole,
      });
      toast({ title: 'Staff added' });
      setAddStaffOpen(false); resetStaffForm();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Add staff failed', description: getErrorMessage(e) });
    }
  };

  const doInviteStaff = async () => {
    if (!staffEmail || !staffPhone || !staffFirst || !staffLast) {
      toast({ variant: 'destructive', title: 'Email, phone, first name, and last name are required' });
      return;
    }
    try {
      await inviteStaff.mutateAsync({
        orgId: id, email: staffEmail, phone: staffPhone, firstName: staffFirst, lastName: staffLast, orgRole: staffRole,
      });
      toast({ title: 'Invitation sent', description: `${staffFirst} will get an email to finish setting up their account.` });
      setAddStaffOpen(false); resetStaffForm();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Invite failed', description: getErrorMessage(e) });
    }
  };

  const doResendInvitation = async (invitationId: string) => {
    try {
      await resendInvitation.mutateAsync({ orgId: id, invitationId });
      toast({ title: 'Invitation re-sent' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not resend invitation', description: getErrorMessage(e) });
    }
  };

  const doCancelInvitation = async (invitationId: string) => {
    try {
      await cancelInvitation.mutateAsync({ orgId: id, invitationId });
      toast({ title: 'Invitation cancelled' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not cancel invitation', description: getErrorMessage(e) });
    }
  };

  const doChangeStaffRole = async (memberId: string, orgRole: 'lead' | 'staff') => {
    try {
      await changeStaffRole.mutateAsync({ orgId: id, memberId, orgRole });
      toast({ title: 'Role updated' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not update role', description: getErrorMessage(e) });
    }
  };

  const doRemoveStaff = async () => {
    if (!removingStaff) return;
    try {
      await removeStaff.mutateAsync({ orgId: id, memberId: removingStaff.memberId });
      toast({ title: `${removingStaff.name} removed` });
      setRemovingStaff(null);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Remove failed', description: getErrorMessage(e) });
    }
  };

  const openPlanDialog = () => {
    const current = planData?.subscription;
    setPlanType((current?.plan_type as typeof planType) ?? 'starter');
    setCustomFee(current?.is_custom ? current.monthly_fee : '');
    setCustomGroups(current?.is_custom && current.max_linked_groups != null ? String(current.max_linked_groups) : '');
    setCustomStaff(current?.is_custom && current.max_staff != null ? String(current.max_staff) : '');
    setCustomPrograms(current?.is_custom && current.max_funding_programs != null ? String(current.max_funding_programs) : '');
    setCustomSms(current?.is_custom ? current.sms_allowance_included : '');
    setCustomSupport((current?.support_tier as typeof customSupport) ?? 'priority_plus');
    setPlanDialogOpen(true);
  };

  const submitPlan = async () => {
    if (planType === 'premium_plus' && !(parseFloat(customFee) >= 0)) {
      toast({ variant: 'destructive', title: 'Premium+ requires a monthly fee' });
      return;
    }
    try {
      await assignPlan.mutateAsync({
        organizationId: id,
        planType,
        custom: planType === 'premium_plus' ? {
          monthlyFee:           parseFloat(customFee),
          maxLinkedGroups:      customGroups   ? parseInt(customGroups, 10)   : null,
          maxStaff:             customStaff    ? parseInt(customStaff, 10)    : null,
          maxFundingPrograms:   customPrograms ? parseInt(customPrograms, 10) : null,
          smsAllowanceIncluded: customSms      ? parseFloat(customSms)        : undefined,
          supportTier:          customSupport,
        } : undefined,
      });
      toast({ title: 'Plan updated' });
      setPlanDialogOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not update plan', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader
        title={org.name}
        description={`${org.county || 'No county set'}${org.registration_number ? ` · ${org.registration_number}` : ''}`}
        breadcrumbs={[
          { label: 'Organizations', href: '/admin/organizations' },
          { label: org.name },
        ]}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">Actions <MoreHorizontal size={14} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {org.is_active ? (
                <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={toggleActive}>
                  <XCircle size={13} className="mr-2" /> Deactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={toggleActive}>
                  <PlayCircle size={13} className="mr-2 text-green-600" /> Activate
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {TYPE_LABEL[org.type] ?? org.type}
          </span>
          <StatusPill status={org.is_active ? 'active' : 'inactive'} size="sm" />
        </div>
      </PageHeader>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard title="Groups Overseen" value={assigned.length} icon={Layers} iconClass="bg-blue-50" />
        <StatCard title="Member Reach" value={memberReach.toLocaleString()} icon={Users} iconClass="bg-purple-50" />
        <StatCard title="Wallet (KES)" value={formatKES(walletKES?.available_balance ?? 0)} icon={Wallet} iconClass="bg-green-50" />
        <StatCard title="Total Disbursed" value={formatKES(walletKES?.total_disbursed ?? 0)} icon={TrendingUp} iconClass="bg-amber-50" />
      </div>

      {/* Plan — never self-serve; only assigned/changed here. */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-4">
          <div className="flex items-center gap-2.5">
            <Sparkles className="text-muted-foreground" size={18} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plan</p>
              <p className="text-lg font-semibold text-foreground capitalize">
                {planLoading ? '—' : planData?.subscription
                  ? `${planData.subscription.plan_type.replace('_', '+')} · ${formatKES(planData.subscription.monthly_fee)}/mo`
                  : 'No plan assigned'}
              </p>
            </div>
          </div>
          {planData?.subscription && !planLoading && (
            <p className="text-xs text-muted-foreground">
              {planData.usage.linkedGroups} of {planData.subscription.max_linked_groups ?? '∞'} groups ·{' '}
              {planData.usage.staff} of {planData.subscription.max_staff ?? '∞'} staff ·{' '}
              {planData.usage.activeFundingPrograms} of {planData.subscription.max_funding_programs ?? '∞'} programs
            </p>
          )}
          <Button size="sm" variant="outline" className="ml-auto h-8" onClick={openPlanDialog}>
            {planData?.subscription ? 'Change plan' : 'Assign plan'}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Assigned groups */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Layers size={14} className="text-blue-500" /> Groups Overseen ({assigned.length})
            </CardTitle>
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => setAssignOpen(true)} disabled={assignable.length === 0}>
              <Plus size={13} className="mr-1" /> Assign group
            </Button>
          </CardHeader>
          <CardContent>
            {assigned.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No groups assigned yet. Use “Assign group” to link groups this organization oversees.
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {assigned.map((g) => (
                  <div key={g.group_id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{g.group_name}</p>
                      <p className="text-xs text-gray-400">
                        <span className="font-mono">{g.group_code}</span>
                        {' · '}{parseInt(g.member_count ?? '0').toLocaleString()} members
                        {' · '}{formatKES(g.total_contributions)} contributions
                        <span className="ml-1 uppercase text-[10px] text-gray-400">({g.access_level})</span>
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600 shrink-0"
                      onClick={() => setRevoking({ groupId: g.group_id, name: g.group_name })}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          {/* Staff — multi-staff organizations (migration 101). Coordinator
              info used to be a single read-only name/email/phone here; that
              was also the only place org staff could ever be assigned, and
              only by direct SQL (no UI existed at all). This replaces it
              with the real list + add/remove/re-role actions. */}
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <UserCog size={14} className="text-purple-500" /> Staff ({staff?.length ?? 0})
              </CardTitle>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddStaffOpen(true)}>
                <Plus size={13} className="mr-1" /> Add staff
              </Button>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {staffLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : !staff || staff.length === 0 ? (
                <p className="text-center py-6 text-muted-foreground">
                  No staff yet. Use &quot;Add staff&quot; to give someone access to this organization&apos;s portal.
                </p>
              ) : (
                staff.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border border-gray-100 px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900">{s.firstName} {s.lastName}</p>
                      <p className="truncate text-[11px] text-gray-400">{s.phone}{s.email ? ` · ${s.email}` : ''}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => doChangeStaffRole(s.memberId, s.orgRole === 'lead' ? 'staff' : 'lead')}
                        className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-600 hover:bg-gray-200"
                        title="Click to toggle role"
                      >
                        {s.orgRole}
                      </button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500 hover:text-red-600"
                        onClick={() => setRemovingStaff({ memberId: s.memberId, name: `${s.firstName} ${s.lastName}` })}>
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </div>
                ))
              )}
              <p className="flex items-start gap-1.5 rounded-md bg-gray-50 px-2 py-1.5 text-[11px] leading-snug text-gray-500">
                <Info size={12} className="mt-0.5 shrink-0" />
                Staff sign in and manage this organization (wallet, programs,
                disbursements) through the separate Kitabu Enterprise portal —
                same organization, a different sign-in.
              </p>
            </CardContent>
          </Card>

          {/* Pending invitations — the invite feature (migration 102) shipped
              without any way to see what happened after "Send invite" was
              clicked. This closes that gap: status, resend, cancel. */}
          {(() => {
            const pending = invitations?.filter((i) => i.status !== 'completed') ?? [];
            if (!invitationsLoading && pending.length === 0) return null;
            return (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Mail size={14} className="text-purple-500" /> Pending invitations ({pending.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {invitationsLoading ? (
                    <Skeleton className="h-16 w-full" />
                  ) : (
                    pending.map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between gap-2 rounded-md border border-gray-100 px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900">{inv.firstName} {inv.lastName}</p>
                          <p className="truncate text-[11px] text-gray-400">{inv.email}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <StatusPill status={inv.status} size="sm" />
                          <Button
                            size="sm" variant="ghost" className="h-6 w-6 p-0 text-gray-500 hover:text-gray-700"
                            title="Resend invitation"
                            disabled={resendInvitation.isPending}
                            onClick={() => doResendInvitation(inv.id)}
                          >
                            <RotateCw size={12} />
                          </Button>
                          <Button
                            size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500 hover:text-red-600"
                            title="Cancel invitation"
                            disabled={cancelInvitation.isPending}
                            onClick={() => doCancelInvitation(inv.id)}
                          >
                            <Ban size={12} />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Organization details */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Landmark size={14} className="text-purple-500" /> Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              {org.phone && (
                <a href={`tel:${org.phone}`} className="flex items-center gap-2 text-gray-600 hover:text-blue-600">
                  <Phone size={12} /> {org.phone}
                </a>
              )}
              {org.email && (
                <a href={`mailto:${org.email}`} className="flex items-center gap-2 text-gray-600 hover:text-blue-600">
                  <Mail size={12} /> {org.email}
                </a>
              )}
              <div className="pt-2 border-t border-gray-100 grid grid-cols-2 gap-y-2">
                <div>
                  <p className="text-gray-400 mb-0.5">Onboarded</p>
                  <p className="font-medium text-gray-900">{formatDate(org.created_at)}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-0.5">Committed</p>
                  <p className="font-medium text-gray-900">{formatKES(walletKES?.committed_balance ?? 0)}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-0.5">Deposited</p>
                  <p className="font-medium text-gray-900">{formatKES(walletKES?.total_deposited ?? 0)}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-0.5">Returned</p>
                  <p className="font-medium text-gray-900">{formatKES(walletKES?.total_returned ?? 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add staff dialog */}
      <Dialog open={addStaffOpen} onOpenChange={(o) => { if (!o) { setAddStaffOpen(false); resetStaffForm(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add staff</DialogTitle></DialogHeader>
          <Tabs value={staffMode} onValueChange={(v) => setStaffMode(v as 'direct' | 'invite')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="direct">Add directly</TabsTrigger>
              <TabsTrigger value="invite">Invite by email</TabsTrigger>
            </TabsList>

            <TabsContent value="direct" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Creates the account immediately with a temporary password. Best for someone who&apos;s already a known member.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>First name</Label>
                  <Input value={staffFirst} onChange={(e) => setStaffFirst(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Last name</Label>
                  <Input value={staffLast} onChange={(e) => setStaffLast(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input value={staffPhone} onChange={(e) => setStaffPhone(e.target.value)} placeholder="0712345678" />
              </div>
              <div className="space-y-1">
                <Label>Role</Label>
                <select
                  value={staffRole}
                  onChange={(e) => setStaffRole(e.target.value as 'lead' | 'staff')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="staff">Staff — day-to-day operations</option>
                  <option value="lead">Lead — can also manage other staff</option>
                </select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddStaffOpen(false)}>Cancel</Button>
                <Button onClick={doAddStaff} loading={addStaff.isPending}>Add staff</Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="invite" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Emails a link to confirm and set their own password — they also verify their phone by SMS code.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>First name</Label>
                  <Input value={staffFirst} onChange={(e) => setStaffFirst(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Last name</Label>
                  <Input value={staffLast} onChange={(e) => setStaffLast(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={staffEmail} onChange={(e) => setStaffEmail(e.target.value)} placeholder="name@example.com" />
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input value={staffPhone} onChange={(e) => setStaffPhone(e.target.value)} placeholder="0712345678" />
              </div>
              <div className="space-y-1">
                <Label>Role</Label>
                <select
                  value={staffRole}
                  onChange={(e) => setStaffRole(e.target.value as 'lead' | 'staff')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="staff">Staff — day-to-day operations</option>
                  <option value="lead">Lead — can also manage other staff</option>
                </select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddStaffOpen(false)}>Cancel</Button>
                <Button onClick={doInviteStaff} loading={inviteStaff.isPending}>Send invite</Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Remove staff confirm */}
      <Dialog open={!!removingStaff} onOpenChange={() => setRemovingStaff(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Remove staff</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove <strong>{removingStaff?.name}</strong> from {org.name}? They will lose access to this organization&apos;s portal.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemovingStaff(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={doRemoveStaff} loading={removeStaff.isPending}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign group dialog */}
      <Dialog open={assignOpen} onOpenChange={(o) => { if (!o) { setAssignOpen(false); setPickGroup(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Assign a group</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Group</Label>
              <select
                value={pickGroup}
                onChange={(e) => setPickGroup(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select a group…</option>
                {assignable.map((g) => (
                  <option key={g.id} value={g.id}>{g.name} — {g.group_code}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Access level</Label>
              <select
                value={accessLevel}
                onChange={(e) => setAccessLevel(e.target.value as 'read' | 'report')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="read">Read — view aggregated data</option>
                <option value="report">Report — view + reporting exports</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignOpen(false); setPickGroup(''); }}>Cancel</Button>
            <Button onClick={doAssign} loading={assignGroup.isPending}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirm */}
      <Dialog open={!!revoking} onOpenChange={() => setRevoking(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Unassign group</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove <strong>{revoking?.name}</strong> from {org.name}? The organization will stop overseeing this group.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={doRevoke} loading={revokeGroup.isPending}>Unassign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign / change plan */}
      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{planData?.subscription ? 'Change plan' : 'Assign plan'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              { value: 'starter' as const,      label: 'Starter',  fee: 'KES 2,999/mo' },
              { value: 'growth' as const,       label: 'Growth',   fee: 'KES 4,999/mo' },
              { value: 'premium' as const,      label: 'Premium',  fee: 'KES 8,999/mo' },
              { value: 'premium_plus' as const, label: 'Premium+', fee: 'Custom' },
            ]).map((p) => (
              <button
                key={p.value} type="button"
                onClick={() => setPlanType(p.value)}
                className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  planType === p.value ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/40'
                }`}
              >
                <p className="font-medium">{p.label}</p>
                <p className="text-xs text-muted-foreground">{p.fee}</p>
              </button>
            ))}
          </div>

          {planType === 'premium_plus' && (
            <div className="grid gap-3 sm:grid-cols-2 rounded-md border bg-muted/20 p-3">
              <p className="sm:col-span-2 text-xs text-muted-foreground">
                Negotiated per contract — every term below is entered by hand. Blank limits mean unlimited.
              </p>
              <div className="space-y-1">
                <Label>Monthly fee (KES) <span className="text-red-500">*</span></Label>
                <Input type="number" min={0} value={customFee} onChange={(e) => setCustomFee(e.target.value)} placeholder="e.g. 15000" />
              </div>
              <div className="space-y-1">
                <Label>Support tier</Label>
                <select
                  value={customSupport}
                  onChange={(e) => setCustomSupport(e.target.value as typeof customSupport)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="priority_plus">Priority+</option>
                  <option value="priority">Priority</option>
                  <option value="standard">Standard</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Max linked groups</Label>
                <Input type="number" min={1} value={customGroups} onChange={(e) => setCustomGroups(e.target.value)} placeholder="Unlimited" />
              </div>
              <div className="space-y-1">
                <Label>Max staff seats</Label>
                <Input type="number" min={1} value={customStaff} onChange={(e) => setCustomStaff(e.target.value)} placeholder="Unlimited" />
              </div>
              <div className="space-y-1">
                <Label>Max funding programs</Label>
                <Input type="number" min={1} value={customPrograms} onChange={(e) => setCustomPrograms(e.target.value)} placeholder="Unlimited" />
              </div>
              <div className="space-y-1">
                <Label>SMS allowance/month</Label>
                <Input type="number" min={0} value={customSms} onChange={(e) => setCustomSms(e.target.value)} placeholder="0" />
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Changing the plan cancels the current one and starts a new one immediately — past usage keeps whatever
            terms were in force when it happened.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDialogOpen(false)}>Cancel</Button>
            <Button onClick={submitPlan} loading={assignPlan.isPending}>Save plan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
