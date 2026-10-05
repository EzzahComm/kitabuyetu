'use client';

import { useState } from 'react';
import { Plus, Users2 } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { PaginatedTable, type PaginatedTableColumn } from '@/components/shared/paginated-table';
import { StatusPill } from '@/components/shared/status-pill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMembers, useCreateMember } from '@/hooks/use-members';
import { useToast } from '@/hooks/use-toast';
import { formatDate, getErrorMessage } from '@/lib/utils';
import { isValidKenyanPhone } from '@/lib/utils/phone';
import type { GroupMemberRow } from '@/types/api.types';
import type { CreateMemberPayload } from '@/lib/validators/member.schema';

/**
 * Deliberately NOT a reuse of (dashboard)/members. That page carries
 * contributions, loans and share columns, plus the actions that go with them —
 * all of which a Chama Reminder group has no data for and no entitlement to.
 * What matters to a communication product is: who is here, can we reach them,
 * and do we know their birthday — so Add member asks for exactly that, not
 * the full Kitabu Yetu profile (national ID, county, occupation, email).
 */
const columns: PaginatedTableColumn<GroupMemberRow>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (m) => (
      <div>
        <p className="font-medium text-foreground">
          {m.first_name} {m.last_name}
        </p>
        {m.membership_no ? <p className="text-xs text-muted-foreground">{m.membership_no}</p> : null}
      </div>
    ),
  },
  { key: 'phone', header: 'Phone', render: (m) => m.phone },
  {
    key: 'role',
    header: 'Role',
    hideBelow: 'md',
    render: (m) => <span className="capitalize">{m.group_role}</span>,
  },
  {
    key: 'birthday',
    header: 'Birthday',
    hideBelow: 'lg',
    // The one non-obvious column on this page: birthday automation is a
    // headline feature, and it silently skips anyone with no date of birth.
    // Showing the gap is what lets someone close it.
    render: (m) =>
      m.date_of_birth ? formatDate(m.date_of_birth) : <span className="text-muted-foreground">Not set</span>,
  },
  {
    key: 'status',
    header: 'Status',
    render: (m) => <StatusPill status={m.group_status} size="sm" />,
  },
];

const addMemberSchema = z.object({
  firstName: z.string().trim().min(2, 'Enter a first name'),
  lastName: z.string().trim().min(2, 'Enter a last name'),
  phone: z.string().trim().refine(isValidKenyanPhone, 'Enter a valid Kenyan phone number'),
  dateOfBirth: z.string().optional().or(z.literal('')),
  role: z.enum(['member', 'secretary', 'treasurer', 'chairperson']),
});
type AddMemberFormValues = z.infer<typeof addMemberSchema>;

export default function ReminderMembersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const { data, isLoading, isError, error } = useMembers({
    page,
    limit: 25,
    ...(search ? { search } : {}),
  });
  const createMember = useCreateMember();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddMemberFormValues>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { role: 'member' },
  });

  const onSubmit = async (values: AddMemberFormValues) => {
    try {
      const body: CreateMemberPayload = {
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone,
        role: values.role,
        ...(values.dateOfBirth ? { dateOfBirth: values.dateOfBirth } : {}),
      };
      await createMember.mutateAsync(body);
      toast({ title: 'Member added' });
      setOpen(false);
      reset();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to add member', description: getErrorMessage(err) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description="Everyone this group can message"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} className="mr-2" /> Add member
          </Button>
        }
      />

      <Input
        placeholder="Search by name or phone…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="max-w-sm"
      />

      <PaginatedTable
        data={data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        columns={columns}
        onPageChange={setPage}
        emptyIcon={Users2}
        emptyMessage="No members yet"
        emptyDescription="Add members to start sending reminders and greetings."
      />

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <div className="space-y-1 sm:col-span-2">
                <Label>Phone</Label>
                <Input placeholder="0712345678" {...register('phone')} />
                {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>
                  Date of birth <span className="text-xs text-muted-foreground">(optional)</span>
                </Label>
                <Input type="date" {...register('dateOfBirth')} />
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
                  <option value="chairperson">Chairperson</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Add member
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
