'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, MoreHorizontal, ShieldCheck, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/page-header';
import { StatusPill } from '@/components/shared/status-pill';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PaginatedTable } from '@/components/shared/paginated-table';
import {
  useAdminUsers, useUpdateUserRole, useAssignableRoles, useAssignGroupRole,
} from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { formatDate, getErrorMessage } from '@/lib/utils';

interface AdminUserRow {
  id:                 string;
  first_name:         string;
  last_name:          string;
  email:              string | null;
  phone_number:       string | null;
  platform_role:      string | null;
  created_at:         string;
  group_id:           string | null;
  member_code:        string | null;
  group_role:         string | null;
  role_id:            string | null;
  status:             string | null;
  joined_at:          string | null;
  group_name:         string | null;
  role_name:          string | null;
  organization_name:  string | null;
}

const PLATFORM_ROLE_BADGE: Record<string, 'destructive' | 'warning' | 'default' | 'secondary'> = {
  super_admin:     'destructive',
  support:         'warning',
  organization_coordinator: 'default',
  member:          'secondary',
};

const ROLE_LABELS: Record<string, string> = {
  super_admin:     'Super Admin',
  support:         'Support',
  organization_coordinator: 'Organization Coordinator',
  member:          'Member',
};

export default function UsersPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [editUser,   setEditUser]   = useState<{ id: string; name: string; role: string } | null>(null);
  const [newRole,    setNewRole]    = useState('');
  // Group-role assignment modal state
  const [roleUser,   setRoleUser]   = useState<AdminUserRow | null>(null);
  const [selRoleId,  setSelRoleId]  = useState('');

  const { data, isLoading }  = useAdminUsers({ page, limit: 25, search, role: roleFilter });
  const updateRole           = useUpdateUserRole();
  const assignRole           = useAssignGroupRole();
  const { data: rolesData, isLoading: rolesLoading } = useAssignableRoles(roleUser?.group_id);
  const assignableRoles = rolesData?.items ?? [];

  const items: AdminUserRow[] = data?.items ?? [];
  const total        = data?.total ?? 0;
  const totalPages   = Math.ceil(total / 25);

  const handleRoleUpdate = async () => {
    if (!editUser || !newRole) return;
    try {
      await updateRole.mutateAsync({ id: editUser.id, platformRole: newRole });
      toast({ title: `Role updated to ${ROLE_LABELS[newRole] ?? newRole}` });
      setEditUser(null); setNewRole('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const openAssignRole = (u: AdminUserRow) => {
    setRoleUser(u);
    setSelRoleId(u.role_id ?? '');
  };

  const handleAssignRole = async () => {
    if (!roleUser?.group_id) {
      toast({ variant: 'destructive', title: 'No group', description: 'This member has no active group membership to assign a role in.' });
      return;
    }
    if (!selRoleId) return;
    try {
      const res = await assignRole.mutateAsync({
        memberId: roleUser.id,
        groupId:  roleUser.group_id,
        roleId:   selRoleId,
      });
      const roleName = res?.newRole?.name ?? assignableRoles.find((r) => r.id === selRoleId)?.name ?? 'role';
      toast({ title: `Assigned ${roleName}`, description: `${roleUser.first_name} ${roleUser.last_name} in ${roleUser.group_name ?? 'group'}` });
      setRoleUser(null); setSelRoleId('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Assignment failed', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Platform Users"
        description={`${total.toLocaleString()} total members across all organizations`}
      />

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search by name, email, or phone…"
                className="pl-8 h-8 text-sm"
              />
            </div>
            <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
              className="h-8 text-sm border border-input rounded-md px-2 bg-background">
              <option value="">All roles</option>
              <option value="super_admin">Super Admin</option>
              <option value="support">Support</option>
              <option value="organization_coordinator">Organization Coordinator</option>
              <option value="chairperson">Group Admin</option>
              <option value="member">Member</option>
            </select>
            {(search || roleFilter) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs"
                onClick={() => { setSearch(''); setRoleFilter(''); setPage(1); }}>
                Clear
              </Button>
            )}
            <span className="ml-auto text-xs text-gray-400">{total} users</span>
          </div>
        </CardContent>
      </Card>

      <PaginatedTable<AdminUserRow>
        data={{ items, total, page, pageSize: 25, totalPages }}
        isLoading={isLoading}
        onPageChange={setPage}
        emptyMessage="No users found"
        onRowClick={(u) => {
          if (u.group_id) router.push(`/admin/groups/${u.group_id}/members/${u.id}`);
          else toast({ title: 'No active group membership', description: 'This user has no group to show a detail page for.' });
        }}
        columns={[
          {
            key: 'user', header: 'User',
            render: (u) => (
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-purple-700">
                    {u.first_name?.[0]}{u.last_name?.[0]}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">{u.first_name} {u.last_name}</p>
                  {u.member_code && <p className="text-[11px] font-mono text-gray-400">{u.member_code}</p>}
                </div>
              </div>
            ),
          },
          {
            key: 'contact', header: 'Contact',
            render: (u) => (
              <>
                <p className="text-xs text-gray-600">{u.email ?? '—'}</p>
                <p className="text-xs text-gray-400">{u.phone_number ?? '—'}</p>
              </>
            ),
          },
          { key: 'org', header: 'Organization', render: (u) => <span className="text-sm text-gray-600">{u.organization_name ?? '—'}</span> },
          { key: 'group', header: 'Group', render: (u) => <span className="text-sm text-gray-600">{u.group_name ?? '—'}</span> },
          {
            key: 'groupRole', header: 'Group Role',
            render: (u) => (
              <span className="text-xs text-gray-600 capitalize">
                {u.role_name ?? u.group_role?.replace('_', ' ') ?? '—'}
              </span>
            ),
          },
          {
            key: 'platformRole', header: 'Platform Role',
            render: (u) => u.platform_role && u.platform_role !== 'member' ? (
              <Badge variant={PLATFORM_ROLE_BADGE[u.platform_role] ?? 'secondary'} className="text-xs">
                {ROLE_LABELS[u.platform_role] ?? u.platform_role}
              </Badge>
            ) : (
              <span className="text-xs text-gray-400">—</span>
            ),
          },
          {
            key: 'status', header: 'Status',
            render: (u) => (
              <StatusPill status={u.status === 'active' ? 'active' : 'inactive'} size="sm" />
            ),
          },
          { key: 'joined', header: 'Joined', render: (u) => <span className="text-xs text-gray-500">{formatDate(u.joined_at ?? u.created_at)}</span> },
          {
            key: 'actions', header: '',
            render: (u) => (
              <div onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                      <MoreHorizontal size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={!u.group_id}
                      onClick={() => openAssignRole(u)}
                    >
                      <UserCog size={13} className="mr-2" /> Assign Group Role
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      setEditUser({ id: u.id, name: `${u.first_name} ${u.last_name}`, role: u.platform_role ?? 'member' });
                      setNewRole(u.platform_role ?? 'member');
                    }}>
                      <ShieldCheck size={13} className="mr-2" /> Change Platform Role
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ),
          },
        ]}
      />

      {/* Role change dialog */}
      <Dialog open={!!editUser} onOpenChange={() => { setEditUser(null); setNewRole(''); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Change Platform Role</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Updating platform role for <strong>{editUser?.name}</strong>
          </p>
          <div className="space-y-1">
            <Label>Platform Role</Label>
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="member">Member (no platform access)</option>
              <option value="support">Support Officer</option>
              <option value="organization_coordinator">Organization Coordinator</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditUser(null); setNewRole(''); }}>Cancel</Button>
            <Button onClick={handleRoleUpdate} loading={updateRole.isPending}>Update Role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign group role dialog */}
      <Dialog open={!!roleUser} onOpenChange={() => { setRoleUser(null); setSelRoleId(''); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Assign group role</DialogTitle></DialogHeader>

          {roleUser && (
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-500">Name</span><span className="font-medium text-gray-900">{roleUser.first_name} {roleUser.last_name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Member No.</span><span className="font-mono text-xs text-gray-700">{roleUser.member_code ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Organization</span><span className="text-gray-700">{roleUser.organization_name ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Group</span><span className="text-gray-700">{roleUser.group_name ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Current role</span><span className="text-gray-700 capitalize">{roleUser.role_name ?? roleUser.group_role?.replace('_', ' ') ?? '—'}</span></div>
            </div>
          )}

          <div className="space-y-1">
            <Label>Role</Label>
            <select
              value={selRoleId}
              onChange={(e) => setSelRoleId(e.target.value)}
              disabled={rolesLoading || assignableRoles.length === 0}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
            >
              <option value="">
                {rolesLoading ? 'Loading roles…' : assignableRoles.length === 0 ? 'No roles available' : 'Select a role…'}
              </option>
              {assignableRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.is_system ? '' : ' (custom)'}
                </option>
              ))}
            </select>
            {selRoleId && (() => {
              const r = assignableRoles.find((x) => x.id === selRoleId);
              return r?.description
                ? <p className="text-xs text-muted-foreground">{r.description}</p>
                : null;
            })()}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setRoleUser(null); setSelRoleId(''); }}>Cancel</Button>
            <Button
              onClick={handleAssignRole}
              loading={assignRole.isPending}
              disabled={!selRoleId || selRoleId === roleUser?.role_id}
            >
              Assign role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
