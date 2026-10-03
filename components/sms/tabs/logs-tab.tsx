'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { smsApi } from '@/lib/api/endpoints';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { ExpandableText } from '@/components/shared/expandable-text';
import { useToast } from '@/hooks/use-toast';
import { formatDate, getErrorMessage } from '@/lib/utils';
import { SectionHeader, SummaryStatsGrid } from '@/components/shared/dashboard-sections';
import { StatusBadge } from './helpers';

export function LogsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { toast } = useToast();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sms-logs', page, status],
    queryFn: () => smsApi.usage({ page, limit: 20, ...(status ? { status } : {}) }),
    staleTime: 30_000,
  });

  const summary = data?.summary;
  const usageStats = useMemo(
    () => [
      { label: 'Delivered', value: summary?.delivered ?? 0, tone: 'text-emerald-600' },
      { label: 'Sent', value: summary?.sent ?? 0, tone: 'text-blue-600' },
      { label: 'Failed', value: summary?.failed ?? 0, tone: 'text-rose-600' },
      { label: 'Queued', value: summary?.queued ?? 0, tone: 'text-amber-600' },
    ],
    [summary],
  );

  const checkDlr = async (msgId: string) => {
    try {
      await smsApi.dlr(msgId);
      toast({ title: 'DLR checked', description: 'Status updated.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'DLR failed', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="SMS Logs"
        subtitle={summary ? `${summary.totalMessages} total • ${summary.totalCredits} credits` : undefined}
        action={
          <select
            aria-label="Filter by status"
            className="text-xs border rounded-lg px-2.5 py-1.5"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {['queued', 'sent', 'delivered', 'failed', 'rejected'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        }
      />

      <SummaryStatsGrid items={usageStats} />

      <PaginatedTable
        data={data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={setPage}
        emptyMessage="No SMS logs found"
        columns={[
          {
            key: 'recipient',
            header: 'Recipient',
            render: (l) => <span className="font-mono text-xs text-foreground">{l.recipient_phone}</span>,
          },
          {
            key: 'message',
            header: 'Message',
            className: 'max-w-[220px]',
            render: (l) => <ExpandableText className="text-muted-foreground text-xs">{l.message_text}</ExpandableText>,
          },
          { key: 'status', header: 'Status', render: (l) => <StatusBadge status={l.status} /> },
          {
            key: 'credits',
            header: 'Credits',
            render: (l) => (
              <span className="text-xs text-muted-foreground">{parseFloat(l.credits_deducted).toFixed(2)}</span>
            ),
          },
          {
            key: 'sentAt',
            header: 'Sent At',
            render: (l) => (
              <span className="text-xs text-muted-foreground">{l.sent_at ? formatDate(l.sent_at) : '-'}</span>
            ),
          },
          {
            key: 'dlr',
            header: 'DLR',
            render: (l) =>
              l.provider_msg_id && l.status === 'sent' ? (
                <button
                  type="button"
                  onClick={() => checkDlr(l.provider_msg_id!)}
                  className="text-xs text-blue-500 hover:underline"
                >
                  Check
                </button>
              ) : null,
          },
        ]}
      />
    </div>
  );
}
