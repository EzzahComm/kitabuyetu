'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/shared/status-pill';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { PageHeader } from '@/components/shared/page-header';
import { useContributions } from '@/hooks/use-contributions';
import { api } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import type { Contribution } from '@/types/db.types';

type ContributionRow = Contribution & { member_name: string };

export default function ContributionsPage() {
  const [page, setPage] = useState(1);
  const { toast } = useToast();
  const { data, isLoading, isError, error } = useContributions({ page, pageSize: 20 });

  const columns = [
    {
      key: 'memberName',
      header: 'Member',
      render: (row: ContributionRow) => <span className="font-medium">{row.member_name ?? row.member_id}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (row: ContributionRow) => <span className="font-semibold text-green-600">{formatKES(row.amount)}</span>,
    },
    { key: 'period', header: 'Date', render: (row: ContributionRow) => formatDate(row.contribution_date) },
    {
      key: 'paymentMethod',
      header: 'Method',
      render: (row: ContributionRow) => (
        <Badge variant="outline" className="capitalize">
          {row.payment_method?.replace('_', ' ')}
        </Badge>
      ),
    },
    { key: 'status', header: 'Status', render: (row: ContributionRow) => <StatusPill status={row.status} /> },
    { key: 'createdAt', header: 'Recorded', render: (row: ContributionRow) => formatDate(row.created_at) },
    {
      key: 'receipt',
      header: '',
      render: (row: ContributionRow) =>
        row.status === 'completed' ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
            onClick={() =>
              api
                .openBlob(`/contributions/${row.id}/receipt`)
                .catch((e) =>
                  toast({ variant: 'destructive', title: 'Receipt failed', description: getErrorMessage(e) }),
                )
            }
          >
            <FileText size={13} /> Receipt
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Contributions" description={`${data?.total ?? 0} total records`} />

      <PaginatedTable
        data={data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        columns={columns}
        onPageChange={setPage}
        emptyMessage="No contributions recorded yet"
      />
    </div>
  );
}
