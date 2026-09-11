'use client';

import { Cake } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { PaginatedTable, singlePage, type PaginatedTableColumn } from '@/components/shared/paginated-table';
import { StatusPill } from '@/components/shared/status-pill';
import { SectionHeader } from '@/components/dashboard/sms/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSmsSettings, useUpdateSmsSettings, useBirthdays } from '@/hooks/use-sms-settings';
import { useToast } from '@/hooks/use-toast';
import { formatDate, getErrorMessage } from '@/lib/utils';
import type { UpcomingBirthday, BirthdayDispatch } from '@/lib/api/endpoints';

const upcomingColumns: PaginatedTableColumn<UpcomingBirthday & { id: string }>[] = [
  {
    key: 'name',
    header: 'Member',
    render: (b) => <span className="font-medium text-foreground">{b.firstName} {b.lastName}</span>,
  },
  { key: 'next', header: 'Birthday', render: (b) => formatDate(b.nextBirthday) },
  {
    key: 'in',
    header: 'In',
    hideBelow: 'sm',
    render: (b) => {
      const days = Math.round(
        (new Date(b.nextBirthday).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000,
      );
      return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`;
    },
  },
];

const historyColumns: PaginatedTableColumn<BirthdayDispatch>[] = [
  {
    key: 'name',
    header: 'Member',
    render: (h) => <span className="font-medium text-foreground">{h.firstName} {h.lastName}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    render: (h) => <StatusPill status={h.status} size="sm" />,
  },
  { key: 'channel', header: 'Channel', hideBelow: 'sm', render: (h) => h.channel ?? '—' },
  {
    key: 'sent',
    header: 'Sent',
    hideBelow: 'md',
    render: (h) => h.sentAt ? formatDate(h.sentAt) : formatDate(h.createdAt),
  },
  {
    key: 'reason',
    header: 'Detail',
    hideBelow: 'lg',
    render: (h) => h.reason ?? '—',
  },
];

/**
 * Birthday automation: the toggle that arms it, who is coming up, and what the
 * daily job actually sent.
 *
 * The sending itself shipped in Phase 1 as a platform-wide job. Until now there
 * was no way to turn it on except direct SQL, and no way at all to see whether
 * a message had gone out — so a fully-built feature was invisible from inside
 * the product.
 */
export default function ReminderBirthdaysPage() {
  const { toast } = useToast();
  const { data: settings, isLoading: settingsLoading } = useSmsSettings();
  const updateSettings = useUpdateSmsSettings();
  const { data: birthdays, isLoading, isError, error } = useBirthdays();

  const enabled = settings?.autoSendBirthday ?? false;

  const toggle = () => {
    updateSettings.mutate(
      { autoSendBirthday: !enabled },
      {
        onSuccess: () => toast({
          title: !enabled ? 'Birthday messages on' : 'Birthday messages off',
          description: !enabled
            ? 'Members will get a greeting on their birthday, once a year.'
            : 'No birthday greetings will be sent.',
        }),
        onError: (err) => toast({
          variant: 'destructive', title: 'Could not save', description: getErrorMessage(err),
        }),
      },
    );
  };

  // The API returns rows keyed by memberId; PaginatedTable needs `id`.
  const upcoming = (birthdays?.upcoming ?? []).map((b) => ({ ...b, id: b.memberId }));

  return (
    <div className="space-y-6">
      <PageHeader title="Birthdays" description="Send every member a greeting on their day, automatically" />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="text-sm font-semibold text-foreground">
              Automatic birthday messages {enabled ? 'are on' : 'are off'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Sent once a year per member, each morning, using your Birthday template.
              Members without a date of birth are skipped.
            </p>
          </div>
          <Button
            onClick={toggle}
            variant={enabled ? 'outline' : 'default'}
            loading={updateSettings.isPending}
            disabled={settingsLoading}
          >
            {enabled ? 'Turn off' : 'Turn on'}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <SectionHeader title="Coming up" subtitle="Birthdays in the next 30 days" />
        <PaginatedTable
          data={singlePage(upcoming)}
          isLoading={isLoading}
          isError={isError}
          error={error}
          columns={upcomingColumns}
          onPageChange={() => {}}
          emptyIcon={Cake}
          emptyMessage="No birthdays in the next 30 days"
          emptyDescription="Members need a date of birth on their record to appear here."
        />
      </div>

      <div className="space-y-3">
        <SectionHeader title="Already sent" subtitle="What the daily job dispatched" />
        <PaginatedTable
          data={singlePage(birthdays?.history)}
          isLoading={isLoading}
          columns={historyColumns}
          onPageChange={() => {}}
          emptyIcon={Cake}
          emptyMessage="Nothing sent yet"
          emptyDescription="Greetings appear here once the automation has run."
        />
      </div>
    </div>
  );
}
