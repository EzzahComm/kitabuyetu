'use client';

/**
 * Customer members across every branch linked to this organization
 * (ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md Phase 4). New backend
 * (organization.service.ts's listMembers) — distinct from organization
 * staff, which already had its own list (organization-members.service.ts).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Users2 } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatusPill } from '@/components/shared/status-pill';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { Input } from '@/components/ui/input';
import { organizationApi } from '@/lib/api/endpoints';
import { formatDate } from '@/lib/utils';
import type { PaginatedResult } from '@/types/db.types';
import type { OrganizationMemberRow } from '@/lib/services/organization.service';

export default function MembersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<PaginatedResult<OrganizationMemberRow>>({
    queryKey: ['enterprise', 'members', page, search],
    queryFn:  () => organizationApi.members({ page, limit: 25, search: search || undefined }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description="Customer members across every branch in your network."
        breadcrumbs={[{ label: 'Portfolio', href: '/enterprise' }, { label: 'Members' }]}
      />

      <div className="relative max-w-xs">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by name or phone…"
          className="pl-8"
        />
      </div>

      <PaginatedTable<OrganizationMemberRow & { id: string }>
        data={data ? { ...data, items: data.items.map((m) => ({ ...m, id: m.memberId })) } : data}
        isLoading={isLoading}
        onPageChange={setPage}
        emptyMessage="No members found"
        emptyDescription={search ? 'Try a different search term.' : 'Members appear here once branches enrol them.'}
        emptyIcon={Users2}
        columns={[
          {
            key: 'name', header: 'Member',
            render: (r) => (
              <div>
                <p className="font-medium text-foreground">{r.firstName} {r.lastName}</p>
                <p className="text-xs text-muted-foreground">{r.phone}</p>
              </div>
            ),
          },
          {
            key: 'branch', header: 'Branch',
            render: (r) => <span className="text-muted-foreground">{r.groupName}</span>,
          },
          {
            key: 'role', header: 'Role',
            render: (r) => <span className="capitalize text-muted-foreground">{r.role.replace(/_/g, ' ')}</span>,
          },
          {
            key: 'joined', header: 'Joined',
            render: (r) => <span className="text-muted-foreground">{formatDate(r.joinedAt)}</span>,
          },
          {
            key: 'status', header: 'Status',
            render: (r) => (
              <StatusPill
                status={r.isActive ? 'active' : 'inactive'}
                tone={r.isActive ? 'positive' : 'neutral'}
                label={r.isActive ? 'active' : 'inactive'}
                size="sm"
              />
            ),
          },
        ]}
      />
    </div>
  );
}
