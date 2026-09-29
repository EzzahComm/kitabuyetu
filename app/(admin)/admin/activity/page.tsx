'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { useAdminActivity, useRetryDelivery } from '@/hooks/use-admin-activity';
import { useAdminGroupOptions } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { ALL_EVENT_TYPES } from '@/lib/notifications/activity-events';
import type { ActivityListRow } from '@/lib/notifications/activity-query';
import { formatKES, getErrorMessage } from '@/lib/utils';

const SEVERITY_STYLE: Record<string, string> = {
  INFO: 'bg-blue-50 text-blue-700 border-blue-200',
  WARNING: 'bg-amber-50 text-amber-700 border-amber-200',
  HIGH: 'bg-red-50 text-red-700 border-red-200',
  CRITICAL: 'bg-red-700 text-white border-red-800',
};

const DELIVERY_STYLE: Record<string, string> = {
  SENT: 'text-green-700',
  DELIVERED: 'text-green-700',
  PENDING: 'text-muted-foreground',
  QUEUED: 'text-muted-foreground',
  RETRYING: 'text-amber-700',
  FAILED: 'text-red-700',
  CANCELLED: 'text-muted-foreground',
};

const selectClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm';

export default function AdminActivityPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState('');
  const [severity, setSeverity] = useState('');
  const [groupId, setGroupId] = useState('');
  const [channel, setChannel] = useState<'' | 'sms' | 'email'>('');
  const [transaction, setTransaction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);

  const { data, isLoading, isError, error } = useAdminActivity({
    page,
    limit: 50,
    eventType: eventType || undefined,
    severity: severity || undefined,
    groupId: groupId || undefined,
    channel: channel || undefined,
    transaction: transaction || undefined,
    from: from || undefined,
    to: to || undefined,
    failedOnly,
  });
  const { data: groupOptions } = useAdminGroupOptions();
  const retry = useRetryDelivery();

  const reset = () => setPage(1);

  const onRetry = async (id: string) => {
    try {
      await retry.mutateAsync(id);
      toast({ title: 'Retry queued' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform activity"
        description="Every material event on the platform, and whether the SMS and email alerts to Kitabu Yetu administrators were delivered."
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <select
            className={selectClass}
            value={eventType}
            onChange={(e) => (setEventType(e.target.value), reset())}
            aria-label="Event type"
          >
            <option value="">All events</option>
            {ALL_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            value={severity}
            onChange={(e) => (setSeverity(e.target.value), reset())}
            aria-label="Severity"
          >
            <option value="">All severities</option>
            {['INFO', 'WARNING', 'HIGH', 'CRITICAL'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            className={selectClass}
            value={groupId}
            onChange={(e) => (setGroupId(e.target.value), reset())}
            aria-label="Group"
          >
            <option value="">All groups</option>
            {(groupOptions ?? []).map((g: { id: string; name: string }) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            value={channel}
            onChange={(e) => (setChannel(e.target.value as '' | 'sms' | 'email'), reset())}
            aria-label="Channel"
          >
            <option value="">SMS + email</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
          </select>
          <Input
            className="h-9 w-44"
            placeholder="Transaction / reference"
            value={transaction}
            onChange={(e) => (setTransaction(e.target.value), reset())}
          />
          <Input
            className="h-9 w-40"
            type="date"
            value={from}
            onChange={(e) => (setFrom(e.target.value), reset())}
            aria-label="From"
          />
          <Input
            className="h-9 w-40"
            type="date"
            value={to}
            onChange={(e) => (setTo(e.target.value), reset())}
            aria-label="To"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={failedOnly} onChange={(e) => (setFailedOnly(e.target.checked), reset())} />
            Delivery failures only
          </label>
        </CardContent>
      </Card>

      <PaginatedTable<ActivityListRow>
        data={data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={setPage}
        emptyMessage="No activity matches these filters."
        columns={[
          {
            key: 'event',
            header: 'Event',
            render: (r) => (
              <div className="min-w-0">
                <p className="font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {r.ref}
                  {r.aggregate ? ' · in digest' : ''}
                </p>
                {r.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.description}</p>}
              </div>
            ),
          },
          {
            key: 'severity',
            header: 'Severity',
            render: (r) => (
              <span
                className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${SEVERITY_STYLE[r.severity]}`}
              >
                {r.severity}
              </span>
            ),
          },
          {
            key: 'who',
            header: 'Actor / group',
            hideBelow: 'md',
            render: (r) => (
              <div className="text-sm">
                <p>{r.actor?.name ?? '—'}</p>
                <p className="text-xs text-muted-foreground">
                  {[r.group_name, r.organization_name].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
            ),
          },
          {
            key: 'amount',
            header: 'Amount / ref',
            hideBelow: 'lg',
            render: (r) => (
              <div className="text-sm">
                <p>{r.amount ? formatKES(Number(r.amount)) : '—'}</p>
                <p className="text-xs text-muted-foreground">{[r.reference, r.status].filter(Boolean).join(' · ')}</p>
              </div>
            ),
          },
          {
            key: 'delivery',
            header: 'Notifications',
            render: (r) =>
              r.deliveries.length === 0 ? (
                <span className="text-xs text-muted-foreground">{r.aggregate ? 'Digest' : 'None'}</span>
              ) : (
                <ul className="space-y-1">
                  {r.deliveries.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 text-xs">
                      <span className={`font-semibold ${DELIVERY_STYLE[d.status] ?? ''}`}>
                        {d.channel.toUpperCase()} {d.status}
                      </span>
                      {d.attempt_count > 1 && <span className="text-muted-foreground">({d.attempt_count} tries)</span>}
                      {d.status === 'FAILED' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          onClick={() => onRetry(d.id)}
                          disabled={retry.isPending}
                        >
                          Retry
                        </Button>
                      )}
                      {d.error_message && (d.status === 'FAILED' || d.status === 'RETRYING') && (
                        <span className="max-w-[16rem] truncate text-red-700" title={d.error_message}>
                          {d.error_message}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ),
          },
          {
            key: 'time',
            header: 'When',
            hideBelow: 'sm',
            render: (r) => (
              <span className="whitespace-nowrap text-sm">{new Date(r.created_at).toLocaleString('en-KE')}</span>
            ),
          },
        ]}
      />
    </div>
  );
}
