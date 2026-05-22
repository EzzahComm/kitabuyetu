'use client';

import { useState } from 'react';
import { Search, Users, MoreHorizontal, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminUsers, useUpdateUserRole } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { formatDate } from '@/lib/utils';

const PLATFORM_ROLE_BADGE: Record<string, any> = {
  super_admin:     'destructive',
  support:         'warning',
  ngo_coordinator: 'default',
  member:          'secondary',
};

const ROLE_LABELS: Record<string, string> = {
  super_admin:     'Super Admin',
  support:         'Support',
  ngo_coordinator: 'NGO Coordinator',
  member:          'Member',
};

export default function UsersPage() {
  const { toast } = useToast();
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [editUser,   setEditUser]   = useState<{ id: string; name: string; role: string } | null>(null);
  const [newRole,    setNewRole]    = useState('');

  const { data, isLoading }  = useAdminUsers({ page, limit: 25, search, role: roleFilter });
  const updateRole           = useUpdateUserRole();

  const items: any[] = data?.items ?? [];
  const total        = data?.total ?? 0;
  const totalPages   = Math.ceil(total / 25);

  const handleRoleUpdate = async () => {
    if (!editUser || !newRole) return;
    try {
      await updateRole.mutateAsync({ id: editUser.id, platformRole: newRole });
      toast({ title: `Role updated to ${ROLE_LABELS[newRole] ?? newRole}` });
      setEditUser(null); setNewRole('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Users size={20} className="text-purple-500" /> Platform Users
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {total.toLocaleString()} total members across all organizations
          </p>
        </div>
      </div>

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
              <option value="ngo_coordinator">NGO Coordinator</option>
              <option value="group_admin">Group Admin</option>
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

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">User</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Contact</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Organization</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Group Role</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Platform Role</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i}>{[...Array(7)].map((__, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[100px]" /></td>
                  ))}</tr>
                ))
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-sm text-muted-foreground">No users found</td></tr>
              ) : items.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-purple-700">
                          {u.first_name?.[0]}{u.last_name?.[0]}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{u.first_name} {u.last_name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-gray-600">{u.email ?? '—'}</p>
                    <p className="text-xs text-gray-400">{u.phone_number ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{u.group_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-600 capitalize">{u.group_role?.replace('_', ' ') ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    {u.platform_role && u.platform_role !== 'member' ? (
                      <Badge variant={PLATFORM_ROLE_BADGE[u.platform_role] ?? 'secondary'} className="text-xs">
                        {ROLE_LABELS[u.platform_role] ?? u.platform_role}
                      </Badge>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={u.status === 'active' ? 'success' : 'secondary'} className="text-xs capitalize">
                      {u.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <MoreHorizontal size={14} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => {
                          setEditUser({ id: u.id, name: `${u.first_name} ${u.last_name}`, role: u.platform_role ?? 'member' });
                          setNewRole(u.platform_role ?? 'member');
                        }}>
                          <ShieldCheck size={13} className="mr-2" /> Change Platform Role
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">Page {page} of {totalPages} · {total} users</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs"
                disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs"
                disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

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
              <option value="ngo_coordinator">NGO Coordinator</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditUser(null); setNewRole(''); }}>Cancel</Button>
            <Button onClick={handleRoleUpdate} loading={updateRole.isPending}>Update Role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
