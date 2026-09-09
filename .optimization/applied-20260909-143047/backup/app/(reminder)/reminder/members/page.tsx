'use client';

import { useState } from 'react';
import { Users2 } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { PaginatedTable, type PaginatedTableColumn } from '@/components/shared/paginated-table';
import { StatusPill } from '@/components/shared/status-pill';
import { Input } from '@/components/ui/input';
import { useMembers } from '@/hooks/use-members';
import { formatDate } from '@/lib/utils';
import type { GroupMemberRow } from '@/types/api.types';

/**
 * Deliberately NOT a reuse of (dashboard)/members. That page carries
 * contributions, loans and share columns, plus the actions that go with them —
 * all of which a Chama Reminder group has no data for and no entitlement to.
 * What matters to a communication product is: who is here, can we reach them,
 * and do we know their birthday.
 */
const columns: PaginatedTableColumn<GroupMemberRow>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (m) => (
      <div>
        <p className="font-medium text-foreground">{m.first_name} {m.last_name}</p>
        {m.membership_no ? (
          <p className="text-xs text-muted-foreground">{m.membership_no}</p>
        ) : null}
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
    render: (m) => m.date_of_birth
      ? formatDate(m.date_of_birth)
      : <span className="text-muted-foreground">Not set</span>,
  },
  {
    key: 'status',
    header: 'Status',
    render: (m) => <StatusPill status={m.group_status} size="sm" />,
  },
];

export default function ReminderMembersPage() {
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error } = useMembers({
    page,
    limit: 25,
    ...(search ? { search } : {}),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Members" description="Everyone this group can message" />

      <Input
        placeholder="Search by name or phone…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
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
    </div>
  );
}
