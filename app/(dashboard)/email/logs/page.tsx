'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/shared/status-pill';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { useEmailLogs, type EmailLog } from '@/hooks/use-email';

export default function EmailLogsPage() {
  const [status, setStatus]   = useState('');
  const [category, setCategory] = useState('');
  const [days, setDays]       = useState(30);
  const [page, setPage]       = useState(1);

  const { data, isLoading } = useEmailLogs({
    status: status || undefined,
    category: category || undefined,
    days,
    page,
  });

  const logs = data?.data ?? [];
  const meta = data?.meta;

  function fmt(d: string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' });
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="Email Logs" />

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={status} onValueChange={(v) => { setStatus(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {['sent','queued','failed','bounced','dry_run'].map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={(v) => { setCategory(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {['transactional','billing','loan','contribution','auth','campaign','financial_report'].map((c) => (
              <SelectItem key={c} value={c} className="capitalize">{c.replace('_',' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(days)} onValueChange={(v) => { setDays(Number(v)); setPage(1); }}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 days</SelectItem>
            <SelectItem value="14">14 days</SelectItem>
            <SelectItem value="30">30 days</SelectItem>
            <SelectItem value="90">90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {meta ? `${meta.total.toLocaleString()} emails` : 'Email Logs'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <PaginatedTable
            data={meta ? { items: logs, total: meta.total, page: meta.page, pageSize: meta.limit, totalPages: Math.ceil(meta.total / meta.limit) } : null}
            isLoading={isLoading}
            onPageChange={setPage}
            emptyMessage="No email logs found"
            columns={[
              { key: 'to', header: 'To', className: 'font-mono text-xs', render: (log: EmailLog) => log.to },
              { key: 'subject', header: 'Subject', className: 'max-w-[200px] truncate text-sm', render: (log: EmailLog) => log.subject ?? '—' },
              {
                key: 'template_key', header: 'Template',
                render: (log: EmailLog) => log.template_key
                  ? <Badge variant="outline" className="text-xs">{log.template_key}</Badge>
                  : '—',
              },
              { key: 'status', header: 'Status', render: (log: EmailLog) => <StatusPill status={log.status} size="sm" /> },
              { key: 'provider', header: 'Provider', className: 'text-xs text-gray-500', render: (log: EmailLog) => log.provider ?? '—' },
              { key: 'sent_at', header: 'Sent', className: 'text-xs', render: (log: EmailLog) => fmt(log.sent_at) },
              { key: 'opened_at', header: 'Opened', className: 'text-xs', render: (log: EmailLog) => log.opened_at ? fmt(log.opened_at) : '—' },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
