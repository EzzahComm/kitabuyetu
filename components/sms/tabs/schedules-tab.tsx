'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, PauseCircle, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScheduleCreatePayload, CampaignCreatePayload } from '@/lib/validators/sms.schema';
import { smsApi } from '@/lib/api/endpoints';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { useToast } from '@/hooks/use-toast';
import { formatDate, getErrorMessage } from '@/lib/utils';
import { SectionHeader } from '@/components/shared/dashboard-sections';
import type { SmsSchedule } from '@/types/api.types';
import { StatusBadge } from './helpers';

const SCHEDULE_TYPES = ['one_time', 'daily', 'weekly', 'monthly'];

export function SchedulesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [sName, setSName] = useState('');
  const [sType, setSType] = useState<ScheduleCreatePayload['scheduleType']>('one_time');
  const [sCron, setSCron] = useState('');
  const [sNextRun, setSNextRun] = useState('');
  const [sMessage, setSMessage] = useState('');
  const [recipType, setRecipType] = useState<ScheduleCreatePayload['recipientType']>('all_members');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sms-schedules'],
    queryFn: () => smsApi.schedules(),
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: (b: ScheduleCreatePayload) => smsApi.createSchedule(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-schedules'] });
      toast({ title: 'Schedule created' });
      setShowForm(false);
      setSName('');
      setSMessage('');
      setSCron('');
      setSNextRun('');
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => smsApi.updateSchedule(id, { isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-schedules'] });
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => smsApi.deleteSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-schedules'] });
      toast({ title: 'Schedule deleted' });
    },
  });

  const schedules: SmsSchedule[] = data ?? [];

  return (
    <div className="space-y-4">
      <SectionHeader
        title="SMS Schedules"
        action={
          <Button type="button" size="sm" className="text-xs" onClick={() => setShowForm(!showForm)}>
            <Plus size={13} /> New Schedule
          </Button>
        }
      />

      {showForm && (
        <div className="bg-card rounded-xl border p-5 space-y-3">
          <h3 className="text-sm font-medium">New Schedule</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Name</label>
              <input
                className="w-full text-sm border rounded-lg px-3 py-2"
                value={sName}
                onChange={(e) => setSName(e.target.value)}
                placeholder="Schedule name"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Type</label>
              <select
                aria-label="Schedule type"
                className="w-full text-sm border rounded-lg px-3 py-2"
                value={sType}
                onChange={(e) => setSType(e.target.value as ScheduleCreatePayload['scheduleType'])}
              >
                {SCHEDULE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Recipients</label>
              <select
                aria-label="Select recipients"
                className="w-full text-sm border rounded-lg px-3 py-2"
                value={recipType}
                onChange={(e) => setRecipType(e.target.value as CampaignCreatePayload['recipientType'])}
              >
                <option value="all_members">All Members</option>
                <option value="active_members">Active Members</option>
              </select>
            </div>
            {sType === 'one_time' ? (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Run At</label>
                <input
                  type="datetime-local"
                  aria-label="Schedule run date and time"
                  className="w-full text-sm border rounded-lg px-3 py-2"
                  value={sNextRun}
                  onChange={(e) => setSNextRun(e.target.value)}
                />
              </div>
            ) : (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Cron Expression</label>
                <input
                  className="w-full text-sm border rounded-lg px-3 py-2 font-mono"
                  value={sCron}
                  onChange={(e) => setSCron(e.target.value)}
                  placeholder="0 8 * * *"
                />
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Message</label>
            <textarea
              className="w-full text-sm border rounded-lg px-3 py-2 resize-none"
              rows={3}
              value={sMessage}
              onChange={(e) => setSMessage(e.target.value)}
              placeholder="Message text…"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() =>
                create.mutate({
                  name: sName,
                  scheduleType: sType,
                  message: sMessage,
                  recipientType: recipType,
                  cronExpression: sCron || undefined,
                  nextRunAt: sNextRun ? new Date(sNextRun).toISOString() : undefined,
                })
              }
              disabled={!sName || !sMessage}
              loading={create.isPending}
            >
              {create.isPending ? 'Saving…' : 'Save Schedule'}
            </Button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm border rounded-lg hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <PaginatedTable
        data={singlePage(schedules)}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={() => {}}
        emptyMessage="No schedules yet"
        columns={[
          { key: 'name', header: 'Name', render: (s) => <span className="font-medium text-foreground">{s.name}</span> },
          {
            key: 'type',
            header: 'Type',
            render: (s) => (
              <span className="capitalize text-muted-foreground text-xs">{s.schedule_type.replace(/_/g, ' ')}</span>
            ),
          },
          {
            key: 'cron',
            header: 'Cron / Next Run',
            render: (s) => (
              <span className="text-xs text-muted-foreground font-mono">
                {s.cron_expression ?? (s.next_run_at ? formatDate(s.next_run_at) : '-')}
              </span>
            ),
          },
          {
            key: 'lastRun',
            header: 'Last Run',
            render: (s) => (
              <span className="text-xs text-muted-foreground">{s.last_run_at ? formatDate(s.last_run_at) : '-'}</span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (s) => <StatusBadge status={s.is_active ? 'sent' : 'cancelled'} />,
          },
          {
            key: 'actions',
            header: '',
            render: (s) => (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggle.mutate({ id: s.id, isActive: !s.is_active })}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title={s.is_active ? 'Pause' : 'Resume'}
                >
                  {s.is_active ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
                </button>
                <button
                  type="button"
                  onClick={() => del.mutate(s.id)}
                  aria-label="Delete schedule"
                  className="text-red-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
