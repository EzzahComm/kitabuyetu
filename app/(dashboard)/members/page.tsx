'use client';

import { useState, useMemo } from 'react';
import { Plus, Search, Archive, RotateCcw, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { useMembers, useCreateMember } from '@/hooks/use-members';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { formatDate } from '@/lib/utils';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { membersApi } from '@/lib/api/endpoints';
import { memberKeys } from '@/hooks/use-members';

// ─── Constants mirrored from validators/member.schema.ts ────────────────────
const MEMBER_STATUSES = [
  { value: 'pending_verification', label: 'Pending verification' },
  { value: 'active',               label: 'Active' },
  { value: 'inactive',             label: 'Inactive' },
  { value: 'suspended',            label: 'Suspended' },
  { value: 'rejected',             label: 'Rejected' },
  { value: 'blacklisted',          label: 'Blacklisted' },
  { value: 'exited',               label: 'Exited' },
  { value: 'archived',             label: 'Archived' },
] as const;

const STATUS_BADGE: Record<string, 'default' | 'success' | 'secondary' | 'warning' | 'destructive' | 'outline'> = {
  pending_verification: 'warning',
  active:               'success',
  inactive:             'secondary',
  suspended:            'warning',
  rejected:             'destructive',
  blacklisted:          'destructive',
  exited:               'secondary',
  archived:             'outline',
};

const schema = z.object({
  firstName:        z.string().min(2),
  middleName:       z.string().max(100).optional().or(z.literal('')),
  lastName:         z.string().min(2),
  phone:            z.string().regex(/^(?:\+254|0)[17]\d{8}$/),
  alternativePhone: z.string().regex(/^(?:\+254|0)[17]\d{8}$/).optional().or(z.literal('')),
  email:            z.string().email().optional().or(z.literal('')),
  nationalId:       z.string().optional(),
  occupation:       z.string().max(150).optional().or(z.literal('')),
  countyId:         z.string().uuid('Pick a county').optional().or(z.literal('')),
  role:             z.enum(['member', 'secretary', 'treasurer', 'group_admin']),
});
type FormValues = z.infer<typeof schema>;

interface County { id: string; code: string; name: string; region: string | null }

export default function MembersPage() {
  const [page, setPage]                 = useState(1);
  const [search, setSearch]             = useState('');
  const [status, setStatus]             = useState<string>('');         // '' = "all (excl archived)"
  const [open, setOpen]                 = useState(false);
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy]         = useState(false);
  const { toast }                       = useToast();
  const qc                              = useQueryClient();

  const queryParams = useMemo(() => ({
    page, pageSize: 20,
    ...(search ? { search } : {}),
    ...(status ? { status, includeArchived: status === 'archived' } : {}),
  }), [page, search, status]);

  const { data, isLoading } = useMembers(queryParams);
  const createMember        = useCreateMember();

  // Counties for the create-form dropdown. The endpoint is already CDN-cached
  // server-side; staleTime here just avoids client refetch on every dialog
  // open within the same tab session.
  const { data: countyList = [] } = useQuery<County[]>({
    queryKey: ['jurisdictions', 'counties'],
    queryFn:  () => fetch('/api/v1/jurisdictions/counties').then((r) => r.json()).then((j) => j.data ?? []),
    staleTime: 1000 * 60 * 60,
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'member' },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      // Strip empty strings so the validator's `.optional().nullable()` paths
      // accept them as missing.
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v === '' || v === undefined) continue;
        body[k] = v;
      }
      await createMember.mutateAsync(body);
      toast({ title: 'Member added successfully' });
      setOpen(false);
      reset();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed to add member', description: err.message });
    }
  };

  // ── Selection helpers ─────────────────────────────────────────────────
  const rows: any[] = (data as any)?.items ?? [];
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else              next.add(id);
      return next;
    });
  };
  const toggleAllOnPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) rows.forEach((r) => next.delete(r.id));
      else                   rows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  // ── Bulk actions ──────────────────────────────────────────────────────
  // Both archive and restore route through transitionStatus so the audit
  // columns (archived_at / archived_by) are populated.
  const runBulk = async (action: 'archive' | 'restore') => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    const target = action === 'archive' ? 'archived' : 'active';
    let success = 0; let failed = 0;
    for (const id of ids) {
      try {
        await membersApi.transitionStatus(id, target);
        success += 1;
      } catch {
        failed += 1;
      }
    }
    setSelectedIds(new Set());
    await qc.invalidateQueries({ queryKey: memberKeys.all });
    setBulkBusy(false);
    toast({
      title: `${action === 'archive' ? 'Archived' : 'Restored'} ${success} of ${ids.length}`,
      description: failed > 0 ? `${failed} failed — check the audit log.` : undefined,
      variant: failed > 0 ? 'destructive' : 'default',
    });
  };

  const columns = [
    {
      key: '_select', header: (
        <input
          type="checkbox"
          checked={allOnPageSelected}
          onChange={toggleAllOnPage}
          aria-label="Select all on this page"
        />
      ),
      render: (row: any) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          onChange={() => toggleRow(row.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${row.firstName ?? row.first_name} ${row.lastName ?? row.last_name}`}
        />
      ),
    },
    {
      key: 'name', header: 'Name',
      render: (row: any) => {
        const first = row.firstName ?? row.first_name ?? '';
        const middle = row.middleName ?? row.middle_name ?? '';
        const last = row.lastName ?? row.last_name ?? '';
        const name = [first, middle, last].filter(Boolean).join(' ');
        return (
          <Link href={`/members/${row.id}`} className="font-medium hover:text-brand-600 hover:underline">
            {name}
          </Link>
        );
      },
    },
    { key: 'phone',      header: 'Phone',      render: (row: any) => <span className="font-mono text-xs">{row.phone}</span> },
    { key: 'occupation', header: 'Occupation', render: (row: any) => <span className="text-sm">{row.occupation ?? row.occupation ?? '—'}</span> },
    {
      key: 'groupRole', header: 'Role',
      render: (row: any) => (
        <Badge variant="outline" className="capitalize">
          {(row.groupRole ?? row.group_role)?.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (row: any) => {
        const s = row.groupStatus ?? row.group_status ?? (row.isActive ?? row.is_active ? 'active' : 'inactive');
        return (
          <Badge variant={STATUS_BADGE[s] ?? 'outline'} className="capitalize">
            {s.replace('_', ' ')}
          </Badge>
        );
      },
    },
    { key: 'joinedAt', header: 'Joined', render: (row: any) => formatDate(row.joinedAt ?? row.joined_at ?? row.createdAt ?? row.created_at) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Members</h1>
          <p className="text-sm text-muted-foreground">
            {(data as any)?.total ?? 0} total{status ? ` (${MEMBER_STATUSES.find((s) => s.value === status)?.label.toLowerCase()})` : ' (excluding archived)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/members/import">
              <Upload size={16} className="mr-2" /> Import
            </Link>
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} className="mr-2" /> Add member
          </Button>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name, middle name, or phone…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Filter by status"
        >
          <option value="">All statuses (excl. archived)</option>
          {MEMBER_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Bulk action bar — only when at least one row is selected */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-md border bg-accent">
          <p className="text-sm flex-1">
            <span className="font-semibold">{selectedIds.size}</span> selected
          </p>
          <Button
            type="button" variant="outline" size="sm"
            disabled={bulkBusy}
            onClick={() => runBulk('archive')}
          >
            {bulkBusy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Archive size={14} className="mr-1" />}
            Archive
          </Button>
          <Button
            type="button" variant="outline" size="sm"
            disabled={bulkBusy}
            onClick={() => runBulk('restore')}
          >
            {bulkBusy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <RotateCcw size={14} className="mr-1" />}
            Restore
          </Button>
          <Button
            type="button" variant="ghost" size="sm"
            onClick={() => setSelectedIds(new Set())}
          >Clear</Button>
        </div>
      )}

      <PaginatedTable
        data={data as any}
        isLoading={isLoading}
        columns={columns}
        onPageChange={setPage}
        emptyMessage="No members found"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add new member</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>First name</Label>
                <Input {...register('firstName')} />
                {errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Middle name <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input {...register('middleName')} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>Last name</Label>
                <Input {...register('lastName')} />
                {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input placeholder="0712345678" {...register('phone')} />
                {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Alt. phone <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input placeholder="0712345678" {...register('alternativePhone')} />
                {errors.alternativePhone && <p className="text-xs text-destructive">{errors.alternativePhone.message}</p>}
              </div>
              <div className="space-y-1 col-span-2">
                <Label>Email <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input type="email" {...register('email')} />
              </div>
              <div className="space-y-1">
                <Label>National ID</Label>
                <Input {...register('nationalId')} />
              </div>
              <div className="space-y-1">
                <Label>Occupation <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input {...register('occupation')} />
              </div>
              <div className="space-y-1">
                <Label>County of residence</Label>
                <select
                  {...register('countyId')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue=""
                >
                  <option value="">— Optional —</option>
                  {countyList.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {errors.countyId && <p className="text-xs text-destructive">{errors.countyId.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Role</Label>
                <select
                  {...register('role')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="member">Member</option>
                  <option value="secretary">Secretary</option>
                  <option value="treasurer">Treasurer</option>
                  <option value="group_admin">Chairperson / Admin</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={isSubmitting}>Add member</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
