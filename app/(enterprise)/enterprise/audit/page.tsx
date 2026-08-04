'use client';

/**
 * Audit trail scoped to this organization's own branches
 * (ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md Phase 4). New backend
 * (organization.service.ts's listAuditLogs) — audit_logs exists
 * platform-wide but has no organization_id column, so this joins through
 * organization_group_access rather than a direct filter.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { Input } from '@/components/ui/input';
import { organizationApi } from '@/lib/api/endpoints';
import { formatDate } from '@/lib/utils';
import type { PaginatedResult } from '@/types/db.types';
import type { OrganizationAuditLogRow } from '@/lib/services/organization.service';

export default function AuditTrailPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error } = useQuery<PaginatedResult<OrganizationAuditLogRow>>({
    queryKey: ['enterprise', 'audit-logs', page, search],
    queryFn:  () => organizationApi.auditLogs({ page, limit: 30, search: search || undefined }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit trail"
        description="Significant actions taken across every branch in your network. Immutable — no entry can be edited or deleted."
        breadcrumbs={[{ label: 'Portfolio', href: '/enterprise' }, { label: 'Audit Trail' }]}
      />

      <div className="relative max-w-xs">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by resource type…"
          className="pl-8"
        />
      </div>

      <PaginatedTable<OrganizationAuditLogRow & { id: string }>
        data={data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={setPage}
        emptyMessage="No audit activity yet"
        emptyDescription={search ? 'Try a different search term.' : 'Actions taken across your branches will appear here.'}
        emptyIcon={ScrollText}
        columns={[
          {
            key: 'action', header: 'Action',
            render: (r) => <span className="font-mono text-xs font-medium text-foreground">{r.action}</span>,
          },
          {
            key: 'resource', header: 'Resource',
            render: (r) => <span className="capitalize text-muted-foreground">{r.resourceType.replace(/_/g, ' ')}</span>,
          },
          {
            key: 'branch', header: 'Branch',
            render: (r) => <span className="text-muted-foreground">{r.groupName ?? '—'}</span>,
          },
          {
            key: 'actor', header: 'Actor',
            render: (r) => <span className="text-muted-foreground">{r.actorName?.trim() || '—'}</span>,
          },
          {
            key: 'date', header: 'Date',
            render: (r) => <span className="text-muted-foreground">{formatDate(r.createdAt)}</span>,
          },
        ]}
      />
    </div>
  );
}
