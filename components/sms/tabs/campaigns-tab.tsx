'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CampaignCreatePayload } from '@/lib/validators/sms.schema';
import { smsApi } from '@/lib/api/endpoints';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { useToast } from '@/hooks/use-toast';
import { formatDate, getErrorMessage } from '@/lib/utils';
import { SectionHeader } from '@/components/shared/dashboard-sections';
import type { SmsCampaign } from '@/types/api.types';
import { StatusBadge } from './helpers';

export function CampaignsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [recipType, setRecipType] = useState<CampaignCreatePayload['recipientType']>('all_members');
  const [scheduledAt, setScheduledAt] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sms-campaigns'],
    queryFn: () => smsApi.campaigns(),
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: (body: CampaignCreatePayload) => smsApi.createCampaign(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-campaigns'] });
      toast({ title: 'Campaign created' });
      setShowForm(false);
      setName('');
      setMessage('');
      setScheduledAt('');
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => smsApi.cancelCampaign(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-campaigns'] });
      toast({ title: 'Campaign cancelled' });
    },
  });

  const campaigns: SmsCampaign[] = data?.items ?? [];

  return (
    <div className="space-y-4">
      <SectionHeader
        title="SMS Campaigns"
        action={
          <Button type="button" size="sm" className="text-xs" onClick={() => setShowForm(!showForm)}>
            <Plus size={13} /> New Campaign
          </Button>
        }
      />

      {showForm && (
        <div className="bg-card rounded-xl border p-5 space-y-3">
          <h3 className="text-sm font-medium text-foreground">New Campaign</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Name</label>
              <input
                className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Campaign name"
              />
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
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Message</label>
            <textarea
              className="w-full text-sm border rounded-lg px-3 py-2 resize-none"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Message text…"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Schedule (optional)</label>
            <input
              type="datetime-local"
              aria-label="Schedule date and time"
              className="text-sm border rounded-lg px-3 py-2"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() =>
                create.mutate({
                  name,
                  message,
                  recipientType: recipType,
                  scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
                })
              }
              disabled={!name || !message}
              loading={create.isPending}
            >
              {create.isPending ? 'Creating…' : scheduledAt ? 'Schedule' : 'Send Now'}
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
        data={singlePage(campaigns)}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={() => {}}
        emptyMessage="No campaigns yet"
        columns={[
          { key: 'name', header: 'Name', render: (c) => <span className="font-medium text-foreground">{c.name}</span> },
          { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
          {
            key: 'recipients',
            header: 'Recipients',
            render: (c) => <span className="text-muted-foreground">{c.recipient_count.toLocaleString()}</span>,
          },
          {
            key: 'sentFailed',
            header: 'Sent / Failed',
            render: (c) => (
              <span className="text-muted-foreground">
                <span className="text-green-600">{c.sent_count}</span>
                {' / '}
                <span className="text-red-500">{c.failed_count}</span>
              </span>
            ),
          },
          {
            key: 'scheduled',
            header: 'Scheduled',
            render: (c) => (
              <span className="text-muted-foreground text-xs">
                {c.scheduled_at ? formatDate(c.scheduled_at) : c.completed_at ? formatDate(c.completed_at) : '—'}
              </span>
            ),
          },
          {
            key: 'actions',
            header: 'Actions',
            render: (c) =>
              c.status === 'draft' || c.status === 'scheduled' ? (
                <button
                  type="button"
                  onClick={() => cancel.mutate(c.id)}
                  className="text-red-400 hover:text-red-600 transition-colors"
                  title="Cancel"
                >
                  <Trash2 size={14} />
                </button>
              ) : null,
          },
        ]}
      />
    </div>
  );
}
