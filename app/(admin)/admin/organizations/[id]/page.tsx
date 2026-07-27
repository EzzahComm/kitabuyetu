'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Landmark, Users, Layers, Wallet, TrendingUp,
  MoreHorizontal, PlayCircle, XCircle, Plus, Trash2, Phone, Mail,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAdminOrganization, useUpdateOrganizationStatus,
  useAssignGroupToOrg, useRevokeGroupFromOrg,
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

  const [assignOpen, setAssignOpen]   = useState(false);
  const [pickGroup, setPickGroup]     = useState('');
  const [accessLevel, setAccessLevel] = useState<'read' | 'report'>('read');
  const [revoking, setRevoking]       = useState<{ groupId: string; name: string } | null>(null);

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
          <Badge variant={org.is_active ? 'success' : 'secondary'} className="text-xs">
            {org.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </PageHeader>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard title="Groups Overseen" value={assigned.length} icon={Layers} iconClass="bg-blue-50" />
        <StatCard title="Member Reach" value={memberReach.toLocaleString()} icon={Users} iconClass="bg-purple-50" />
        <StatCard title="Wallet (KES)" value={formatKES(walletKES?.available_balance ?? 0)} icon={Wallet} iconClass="bg-green-50" />
        <StatCard title="Total Disbursed" value={formatKES(walletKES?.total_disbursed ?? 0)} icon={TrendingUp} iconClass="bg-amber-50" />
      </div>

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

        {/* Coordinator + details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Landmark size={14} className="text-purple-500" /> Organization
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div>
              <p className="text-gray-400 mb-0.5">Coordinator</p>
              <p className="font-medium text-gray-900">{org.coordinator_name ?? 'None assigned'}</p>
            </div>
            {org.coordinator_email && (
              <a href={`mailto:${org.coordinator_email}`} className="flex items-center gap-2 text-gray-600 hover:text-blue-600">
                <Mail size={12} /> {org.coordinator_email}
              </a>
            )}
            {(org.coordinator_phone || org.phone) && (
              <a href={`tel:${org.coordinator_phone ?? org.phone}`} className="flex items-center gap-2 text-gray-600 hover:text-blue-600">
                <Phone size={12} /> {org.coordinator_phone ?? org.phone}
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
    </div>
  );
}
