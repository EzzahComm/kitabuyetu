'use client';

/**
 * The SMS Centre's operational surfaces (SMS-REAUDIT-2026-09-02 F3/F6).
 *
 * Split out of tabs.tsx rather than appended to it: that file was already
 * ~900 lines and holds the *messaging* tabs (compose, campaigns, templates,
 * schedules, logs). These two answer a different question — not "send
 * something" but "what happened, and what still needs a decision" — and the
 * re-audit is likely to add more of them.
 *
 * Both are here because the endpoints behind them shipped in #130 with no UI
 * at all, which is what made T3-5's closure test ("a DSAR is answerable from
 * the UI") untrue despite the service layer being correct and tested.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { smsApi, type SmsFailure, type ReminderHistoryRow } from '@/lib/api/endpoints';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { ExpandableText } from '@/components/shared/expandable-text';
import { formatDate } from '@/lib/utils';
import { StatusPill } from '@/components/shared/status-pill';
import { SectionHeader } from '@/components/shared/dashboard-sections';

// ─── Failed messages ─────────────────────────────────────────────────────────

export function FailuresTab() {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sms-failures', page],
    queryFn: () => smsApi.failures({ page, limit: 20 }),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-4">
      <SectionHeader title="Failed messages" subtitle="Failed messages are kept for review and are never resent." />

      <PaginatedTable
        data={data ?? singlePage<SmsFailure>([])}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={setPage}
        emptyMessage="No failed messages."
        columns={[
          {
            key: 'phone',
            header: 'To',
            render: (f) => <span className="font-mono text-xs">{f.phone}</span>,
          },
          {
            key: 'message',
            header: 'Message',
            hideBelow: 'md',
            className: 'max-w-[220px]',
            render: (f) => <ExpandableText className="text-muted-foreground text-xs">{f.message}</ExpandableText>,
          },
          {
            key: 'reason',
            header: 'Why it failed',
            render: (f) => <span className="text-xs text-muted-foreground">{f.failure_reason ?? '—'}</span>,
          },
          {
            key: 'attempts',
            header: 'Past retries',
            hideBelow: 'sm',
            render: (f) => <span className="text-xs text-muted-foreground">{f.retry_count}</span>,
          },
        ]}
      />
    </div>
  );
}

// ─── Automation history ──────────────────────────────────────────────────────

/**
 * What the automations actually did.
 *
 * `reminder_dispatch_log` has recorded every automated reminder since
 * migration 106 and had no reader in the product: an officer could see that
 * credits were spent but not which automation spent them, which member it
 * reached, or why a particular member heard nothing.
 *
 * SUPPRESSED rows are shown, not filtered. A suppressed row is the record that
 * someone opted out and was honoured — the single most useful row here when
 * answering a member who asks what you have been sending them.
 */
export function ReminderHistoryTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sms-reminder-history', page, status],
    queryFn: () => smsApi.reminderHistory({ page, limit: 20, ...(status ? { status } : {}) }),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Automation history"
        subtitle={data ? `${data.total} reminder${data.total === 1 ? '' : 's'}` : undefined}
        action={
          <select
            aria-label="Filter by outcome"
            className="text-xs border rounded-lg px-2.5 py-1.5"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All outcomes</option>
            {['sent', 'suppressed', 'failed', 'pending'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        }
      />

      <PaginatedTable
        data={data ?? singlePage<ReminderHistoryRow>([])}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={setPage}
        emptyMessage="No automated reminders yet."
        emptyDescription="Loan and contribution reminders appear here once they run."
        columns={[
          {
            key: 'member',
            header: 'Member',
            render: (r) => <span className="text-xs">{r.member_name ?? '—'}</span>,
          },
          {
            key: 'what',
            header: 'Reminder',
            hideBelow: 'sm',
            render: (r) => (
              <span className="text-xs text-muted-foreground">
                {r.reference_type.replace(/_/g, ' ')} · {r.reminder_stage.replace(/_/g, ' ')}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Outcome',
            render: (r) => <StatusPill status={r.status} size="sm" />,
          },
          {
            key: 'why',
            header: 'Detail',
            hideBelow: 'md',
            // For a suppressed row this carries the reason the member was NOT
            // contacted, which is the point of showing those rows at all.
            render: (r) => <span className="text-xs text-muted-foreground">{r.reason ?? r.channel ?? '—'}</span>,
          },
          {
            key: 'when',
            header: 'When',
            hideBelow: 'sm',
            render: (r) => (
              <span className="text-xs text-muted-foreground">{formatDate(r.sent_at ?? r.created_at)}</span>
            ),
          },
        ]}
      />
    </div>
  );
}
