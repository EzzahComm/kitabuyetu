'use client';

import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
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

const schema = z.object({
  firstName:  z.string().min(2),
  lastName:   z.string().min(2),
  phone:      z.string().regex(/^(?:\+254|0)[17]\d{8}$/),
  email:      z.string().email().optional().or(z.literal('')),
  nationalId: z.string().optional(),
  role:       z.enum(['member', 'secretary', 'treasurer', 'group_admin']),
});
type FormValues = z.infer<typeof schema>;

export default function MembersPage() {
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [open, setOpen]       = useState(false);
  const { toast }             = useToast();

  const { data, isLoading } = useMembers({ page, pageSize: 20, search: search || undefined });
  const createMember        = useCreateMember();

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'member' },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await createMember.mutateAsync(values);
      toast({ title: 'Member added successfully' });
      setOpen(false);
      reset();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed to add member', description: err.message });
    }
  };

  const columns = [
    {
      key: 'name', header: 'Name',
      render: (row: any) => (
        <Link href={`/members/${row.id}`} className="font-medium hover:text-brand-600 hover:underline">
          {row.firstName} {row.lastName}
        </Link>
      ),
    },
    { key: 'phone', header: 'Phone', render: (row: any) => <span className="font-mono text-sm">{row.phone}</span> },
    {
      key: 'groupRole', header: 'Role',
      render: (row: any) => <Badge variant="outline" className="capitalize">{row.groupRole?.replace('_', ' ')}</Badge>,
    },
    {
      key: 'status', header: 'Status',
      render: (row: any) => (
        <Badge variant={row.isActive ? 'success' : 'secondary'}>{row.isActive ? 'Active' : 'Inactive'}</Badge>
      ),
    },
    { key: 'joinedAt', header: 'Joined', render: (row: any) => formatDate(row.joinedAt ?? row.createdAt) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Members</h1>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} total members</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} className="mr-2" /> Add member
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      <PaginatedTable data={data as any} isLoading={isLoading} columns={columns} onPageChange={setPage} emptyMessage="No members found" />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add new member</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>First name</Label>
                <Input {...register('firstName')} />
                {errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Last name</Label>
                <Input {...register('lastName')} />
                {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
              </div>
              <div className="space-y-1 col-span-2">
                <Label>Phone</Label>
                <Input placeholder="0712345678" {...register('phone')} />
                {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
              </div>
              <div className="space-y-1 col-span-2">
                <Label>Email (optional)</Label>
                <Input type="email" {...register('email')} />
              </div>
              <div className="space-y-1">
                <Label>National ID</Label>
                <Input {...register('nationalId')} />
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
