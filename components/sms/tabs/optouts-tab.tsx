'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { smsApi } from '@/lib/api/endpoints';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { useToast } from '@/hooks/use-toast';
import { formatDate, getErrorMessage } from '@/lib/utils';
import { SectionHeader } from '@/components/shared/dashboard-sections';
import type { SmsOptOut } from '@/lib/api/endpoints';

export function OptOutsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sms-opt-outs'],
    queryFn: () => smsApi.optOuts(),
    staleTime: 30_000,
  });

  const add = useMutation({
    mutationFn: () => smsApi.addOptOut(phone.trim(), note.trim() || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-opt-outs'] });
      toast({ title: 'Opt-out recorded', description: 'This number will not be messaged by this group.' });
      setPhone('');
      setNote('');
    },
    onError: (e) =>
      toast({ variant: 'destructive', title: 'Could not record opt-out', description: getErrorMessage(e) }),
  });

  const remove = useMutation({
    mutationFn: (p: string) => smsApi.removeOptOut(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-opt-outs'] });
      toast({ title: 'Opted back in' });
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Could not opt in', description: getErrorMessage(e) }),
  });

  const rows = useMemo(() => (data?.optOuts ?? []).map((o: SmsOptOut) => ({ ...o, id: o.phone })), [data?.optOuts]);

  return (
    <div className="space-y-4">
      <SectionHeader title="Opt-outs" />

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        A member can ask any officer to stop messaging them. Record it here and this group will not send to that number
        again — automated reminders included. Opting out is per group, because each group messages separately.
      </div>

      <div className="bg-card rounded-xl border p-5 space-y-3">
        <h3 className="text-sm font-medium">Record an opt-out</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="optout-phone" className="text-xs text-muted-foreground block mb-1">
              Phone number
            </label>
            <input
              id="optout-phone"
              className="w-full text-sm border rounded-lg px-3 py-2"
              placeholder="07XX XXX XXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="optout-note" className="text-xs text-muted-foreground block mb-1">
              How the request reached you (optional)
            </label>
            <input
              id="optout-note"
              className="w-full text-sm border rounded-lg px-3 py-2"
              placeholder="e.g. asked at the monthly meeting"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          className="text-xs"
          disabled={!phone.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          <Plus size={13} /> {add.isPending ? 'Recording…' : 'Record opt-out'}
        </Button>
      </div>

      <PaginatedTable
        data={singlePage(rows)}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={() => {}}
        emptyMessage="Nobody has opted out of this group's messages."
        emptyIcon={BellOff}
        emptyDescription="When a member asks an officer to stop messaging them, record it above."
        columns={[
          {
            key: 'phone',
            header: 'Phone',
            render: (o) => <span className="font-mono text-xs">{o.phone}</span>,
          },
          {
            key: 'recorded',
            header: 'Recorded',
            render: (o) => (
              <span className="text-xs text-muted-foreground">
                {formatDate(o.optedOutAt)} · {o.source === 'officer' ? 'by an officer' : o.source}
              </span>
            ),
          },
          {
            key: 'note',
            header: 'Note',
            hideBelow: 'sm',
            render: (o) => <span className="text-xs text-muted-foreground">{o.note ?? '—'}</span>,
          },
          {
            key: 'actions',
            header: '',
            render: (o) => (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-xs"
                disabled={remove.isPending}
                onClick={() => remove.mutate(o.phone)}
              >
                <Trash2 size={13} /> Opt back in
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
