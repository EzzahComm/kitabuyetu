'use client';

/**
 * The SMS Centre's tab bodies, moved verbatim out of app/(dashboard)/sms/page.tsx.
 *
 * They were private module-local functions in that page, which made them
 * unreachable from anywhere else — so the Chama Reminder portal, which is meant
 * to be a thin re-skin over the same machinery, could not reuse a line of it.
 * This is a pure move: no behaviour, markup or query changed, only the
 * declarations became exports.
 *
 * Each tab owns its own queries and mutations, so a page can mount any subset
 * of them in any arrangement without threading state through.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Send, MessageSquare, LayoutTemplate, Clock, BarChart2,
  Plus, Trash2, PauseCircle, PlayCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BulkSmsPayload, CampaignCreatePayload, TemplateCreatePayload, ScheduleCreatePayload } from '@/lib/validators/sms.schema';
import { smsApi } from '@/lib/api/endpoints';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { ExpandableText } from '@/components/shared/expandable-text';
import { useToast } from '@/hooks/use-toast';
import { formatDate, getErrorMessage } from '@/lib/utils';
import { countSegments } from '@/lib/sms/segments';
import { StatusPill } from '@/components/shared/status-pill';
import { SectionHeader, SummaryStatsGrid } from '@/components/dashboard/sms/shared';
import type { SmsTemplate, SmsCampaign, SmsSchedule } from '@/types/api.types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Thin wrapper over the shared StatusPill so existing call sites stay unchanged.
export function StatusBadge({ status }: { status: string }) {
  return <StatusPill status={status} size="sm" />;
}

export function CategoryBadge({ category }: { category: string }) {
  const cls: Record<string, string> = {
    transaction:  'bg-blue-50 text-blue-700',
    loan:         'bg-amber-50 text-amber-700',
    reminder:     'bg-orange-50 text-orange-700',
    birthday:     'bg-pink-50 text-pink-700',
    onboarding:   'bg-teal-50 text-teal-700',
    auth:         'bg-violet-50 text-violet-700',
    announcement: 'bg-indigo-50 text-indigo-700',
    custom:       'bg-muted/50 text-muted-foreground',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${cls[category] ?? 'bg-muted/50 text-muted-foreground'}`}>
      {category}
    </span>
  );
}

export const TABS = [
  { key: 'compose',   label: 'Compose',   icon: Send },
  { key: 'campaigns', label: 'Campaigns', icon: BarChart2 },
  { key: 'templates', label: 'Templates', icon: LayoutTemplate },
  { key: 'schedules', label: 'Schedules', icon: Clock },
  { key: 'logs',      label: 'SMS Logs',  icon: MessageSquare },
] as const;

export type TabKey = (typeof TABS)[number]['key'];

// ─── Compose Tab ─────────────────────────────────────────────────────────────

export function ComposeTab() {
  const { toast } = useToast();
  const [message, setMessage]   = useState('');
  const [target, setTarget]     = useState<'all' | 'active' | 'custom'>('all');
  const [phones, setPhones]     = useState('');
  const [templateId, setTemplateId] = useState('');

  const { data: templates } = useQuery({ queryKey: ['sms-templates'], queryFn: () => smsApi.templates() });

  const sendMutation = useMutation({
    mutationFn: (body: BulkSmsPayload) => smsApi.bulk(body),
    onSuccess: (res) => {
      toast({ title: `Queued ${res.queued} messages for delivery` });
      setMessage(''); setPhones('');
    },
    onError: (err) => toast({ variant: 'destructive', title: 'Send failed', description: getErrorMessage(err) }),
  });

  /**
   * "All Members" / "Active Only" name an audience; they do not enumerate one.
   * This used to build the phone list here from `useMembers({ pageSize: 500 })`
   * — a key `MemberQuerySchema` does not have, so Zod stripped it and the list
   * came back at the default 20. A 150-member group reached 20 of them with no
   * error shown. The server now answers the membership question itself; the
   * client only sends phone numbers a human typed.
   */
  const handleSend = () => {
    if (!message.trim()) return;

    if (target === 'custom') {
      const recipientPhones = phones.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
      if (!recipientPhones.length) {
        toast({ variant: 'destructive', title: 'Add at least one phone number' });
        return;
      }
      sendMutation.mutate({ phones: recipientPhones, message });
      return;
    }

    sendMutation.mutate({
      recipientType: target === 'active' ? 'active_members' : 'all_members',
      message,
    });
  };

  const tplList: SmsTemplate[] = templates ?? [];

  const handleTemplateSelect = (id: string) => {
    setTemplateId(id);
    const tpl = tplList.find((t) => t.id === id);
    if (tpl) setMessage(tpl.body);
  };

  // The SAME counter billing uses (lib/sms/segments.ts). This used to be
  // ceil(len / 160), which was wrong twice over: 160 is the SINGLE-segment
  // size (a concatenated part holds 153), and it ignored encoding entirely, so
  // one emoji silently cut capacity to 67 without changing the estimate. That
  // left three different numbers for one message — what the officer was shown,
  // what the provider billed, and what the group was charged.
  const seg = countSegments(message);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-card rounded-xl border p-5 space-y-4">
          <h2 className="font-semibold text-sm text-foreground">Compose Message</h2>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Load Template</label>
            <select
              aria-label="Load template"
              className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
              value={templateId}
              onChange={(e) => handleTemplateSelect(e.target.value)}
            >
              <option value="">— Select a template —</option>
              {tplList.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Message</label>
            <textarea
              className="w-full text-sm border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              rows={5}
              placeholder="Type your message…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>{seg.characters} chars</span>
              <span>
                {seg.segments} SMS part{seg.segments > 1 ? 's' : ''}
                {seg.encoding === 'ucs2' ? ' · unicode' : ''}
              </span>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-2">Recipients</label>
            <div className="flex gap-2 mb-3">
              {(['all', 'active', 'custom'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTarget(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    target === t ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-input hover:border-ring'
                  }`}
                >
                  {t === 'all' ? 'All Members' : t === 'active' ? 'Active Only' : 'Custom Phones'}
                </button>
              ))}
            </div>
            {target === 'custom' && (
              <textarea
                className="w-full text-sm border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                rows={4}
                placeholder="Enter phone numbers, one per line or comma-separated (254…)"
                value={phones}
                onChange={(e) => setPhones(e.target.value)}
              />
            )}
          </div>

          <Button
            type="button"
            onClick={handleSend}
            disabled={!message.trim()}
            loading={sendMutation.isPending}
          >
            <Send size={15} />
            {sendMutation.isPending ? 'Sending…' : 'Send SMS'}
          </Button>
        </div>
      </div>

    </div>
  );
}

// ─── Campaigns Tab ────────────────────────────────────────────────────────────

export function CampaignsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName]         = useState('');
  const [message, setMessage]   = useState('');
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
      setShowForm(false); setName(''); setMessage(''); setScheduledAt('');
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => smsApi.cancelCampaign(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sms-campaigns'] }); toast({ title: 'Campaign cancelled' }); },
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
              <input className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring" value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Recipients</label>
              <select aria-label="Select recipients" className="w-full text-sm border rounded-lg px-3 py-2" value={recipType} onChange={(e) => setRecipType(e.target.value as CampaignCreatePayload['recipientType'])}>
                <option value="all_members">All Members</option>
                <option value="active_members">Active Members</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Message</label>
            <textarea className="w-full text-sm border rounded-lg px-3 py-2 resize-none" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message text…" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Schedule (optional)</label>
            <input type="datetime-local" aria-label="Schedule date and time" className="text-sm border rounded-lg px-3 py-2" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              // A datetime-local input yields "2026-08-06T14:30" — no timezone
              // offset — but CampaignCreateSchema requires datetime({offset:true}),
              // so every Schedule click 400'd (SMS_MESSAGING_AUDIT_2026-08.md H4).
              // The Schedules tab below already converts correctly; match it.
              onClick={() => create.mutate({
                name,
                message,
                recipientType: recipType,
                scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
              })}
              disabled={!name || !message}
              loading={create.isPending}
            >
              {create.isPending ? 'Creating…' : scheduledAt ? 'Schedule' : 'Send Now'}
            </Button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Cancel</button>
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
          { key: 'recipients', header: 'Recipients', render: (c) => <span className="text-muted-foreground">{c.recipient_count.toLocaleString()}</span> },
          {
            key: 'sentFailed', header: 'Sent / Failed',
            render: (c) => (
              <span className="text-muted-foreground">
                <span className="text-green-600">{c.sent_count}</span>
                {' / '}
                <span className="text-red-500">{c.failed_count}</span>
              </span>
            ),
          },
          {
            key: 'scheduled', header: 'Scheduled',
            render: (c) => <span className="text-muted-foreground text-xs">{c.scheduled_at ? formatDate(c.scheduled_at) : c.completed_at ? formatDate(c.completed_at) : '—'}</span>,
          },
          {
            key: 'actions', header: 'Actions',
            render: (c) => (c.status === 'draft' || c.status === 'scheduled') ? (
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

// ─── Templates Tab ────────────────────────────────────────────────────────────

export function TemplatesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [key, setKey]       = useState('');
  const [name, setName]     = useState('');
  const [body, setBody]     = useState('');
  const [category, setCategory] = useState<TemplateCreatePayload['category']>('custom');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sms-templates'],
    queryFn: () => smsApi.templates(),
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: (b: TemplateCreatePayload) => smsApi.createTemplate(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      toast({ title: 'Template created' });
      setShowForm(false); setKey(''); setName(''); setBody('');
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) }),
  });

  const del = useMutation({
    mutationFn: (id: string) => smsApi.deleteTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sms-templates'] }); toast({ title: 'Template deleted' }); },
  });

  const templates: SmsTemplate[] = data ?? [];
  const bodySeg = countSegments(body);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="SMS Templates"
        action={
          <Button type="button" size="sm" className="text-xs" onClick={() => setShowForm(!showForm)}>
            <Plus size={13} /> New Template
          </Button>
        }
      />

      {showForm && (
        <div className="bg-card rounded-xl border p-5 space-y-3">
          <h3 className="text-sm font-medium">New Template</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Key (snake_case)</label>
              <input className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring" value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s/g, '_'))} placeholder="my_template" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Display Name</label>
              <input className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Template" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Category</label>
            <select aria-label="Template category" className="w-full text-sm border rounded-lg px-3 py-2" value={category} onChange={(e) => setCategory(e.target.value as TemplateCreatePayload['category'])}>
              {['transaction', 'loan', 'reminder', 'birthday', 'onboarding', 'auth', 'announcement', 'custom'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Body <span className="text-muted-foreground">(use {'{{variable}}'} for placeholders)</span>
            </label>
            <textarea
              className="w-full text-sm border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Dear {{first_name}}, your balance is KES {{amount}}."
            />
            <p className="text-xs text-muted-foreground mt-1">
              {bodySeg.characters} chars · {bodySeg.segments} SMS part{bodySeg.segments > 1 ? 's' : ''}
              {bodySeg.encoding === 'ucs2' ? ' · unicode' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => create.mutate({ templateKey: key, name, body, category })}
              disabled={!key || !name || !body}
              loading={create.isPending}
            >
              {create.isPending ? 'Saving…' : 'Save Template'}
            </Button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      <PaginatedTable
        data={singlePage(templates)}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={() => {}}
        emptyMessage="No templates yet"
        columns={[
          { key: 'name', header: 'Name', render: (t) => <span className="font-medium text-foreground">{t.name}</span> },
          { key: 'key', header: 'Key', render: (t) => <span className="font-mono text-xs text-muted-foreground">{t.template_key}</span> },
          { key: 'category', header: 'Category', render: (t) => <CategoryBadge category={t.category} /> },
          { key: 'variables', header: 'Variables', render: (t) => <span className="text-xs text-muted-foreground">{(t.variables ?? []).join(', ') || '—'}</span> },
          { key: 'body', header: 'Body', className: 'max-w-[280px]', render: (t) => <ExpandableText className="text-muted-foreground text-xs">{t.body}</ExpandableText> },
          {
            key: 'type', header: 'Type',
            render: (t) => (
              <span className={`text-xs ${t.is_system ? 'text-blue-500' : 'text-muted-foreground'}`}>
                {t.is_system ? 'System' : 'Custom'}
              </span>
            ),
          },
          {
            key: 'actions', header: '',
            render: (t) => !t.is_system ? (
              <button
                type="button"
                onClick={() => del.mutate(t.id)}
                aria-label="Delete template"
                className="text-red-400 hover:text-red-600 transition-colors"
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

// ─── Schedules Tab ────────────────────────────────────────────────────────────

export function SchedulesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [sName, setSName]           = useState('');
  const [sType, setSType]           = useState<ScheduleCreatePayload['scheduleType']>('one_time');
  const [sCron, setSCron]           = useState('');
  const [sNextRun, setSNextRun]     = useState('');
  const [sMessage, setSMessage]     = useState('');
  const [recipType, setRecipType]   = useState<ScheduleCreatePayload['recipientType']>('all_members');

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
      setShowForm(false); setSName(''); setSMessage(''); setSCron(''); setSNextRun('');
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      smsApi.updateSchedule(id, { isActive }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sms-schedules'] }); },
  });

  const del = useMutation({
    mutationFn: (id: string) => smsApi.deleteSchedule(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sms-schedules'] }); toast({ title: 'Schedule deleted' }); },
  });

  const schedules: SmsSchedule[] = data ?? [];

  // 'birthday'/'loan_due' removed: those are dedicated global jobs
  // (sms_birthday_reminders, notify_loan_due_alerts) now, not creatable
  // schedule rows — see lib/validators/sms.schema.ts's ScheduleCreateSchema.
  const SCHEDULE_TYPES = ['one_time', 'daily', 'weekly', 'monthly'];

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
              <input className="w-full text-sm border rounded-lg px-3 py-2" value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Schedule name" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Type</label>
              <select aria-label="Schedule type" className="w-full text-sm border rounded-lg px-3 py-2" value={sType} onChange={(e) => setSType(e.target.value as ScheduleCreatePayload['scheduleType'])}>
                {SCHEDULE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Recipients</label>
              <select aria-label="Select recipients" className="w-full text-sm border rounded-lg px-3 py-2" value={recipType} onChange={(e) => setRecipType(e.target.value as CampaignCreatePayload['recipientType'])}>
                <option value="all_members">All Members</option>
                <option value="active_members">Active Members</option>
              </select>
            </div>
            {sType === 'one_time' ? (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Run At</label>
                <input type="datetime-local" aria-label="Schedule run date and time" className="w-full text-sm border rounded-lg px-3 py-2" value={sNextRun} onChange={(e) => setSNextRun(e.target.value)} />
              </div>
            ) : (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Cron Expression</label>
                <input className="w-full text-sm border rounded-lg px-3 py-2 font-mono" value={sCron} onChange={(e) => setSCron(e.target.value)} placeholder="0 8 * * *" />
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Message</label>
            <textarea className="w-full text-sm border rounded-lg px-3 py-2 resize-none" rows={3} value={sMessage} onChange={(e) => setSMessage(e.target.value)} placeholder="Message text…" />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() =>
                create.mutate({
                  name: sName, scheduleType: sType, message: sMessage,
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
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Cancel</button>
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
          { key: 'type', header: 'Type', render: (s) => <span className="capitalize text-muted-foreground text-xs">{s.schedule_type.replace(/_/g, ' ')}</span> },
          {
            key: 'cron', header: 'Cron / Next Run',
            render: (s) => <span className="text-xs text-muted-foreground font-mono">{s.cron_expression ?? (s.next_run_at ? formatDate(s.next_run_at) : '—')}</span>,
          },
          { key: 'lastRun', header: 'Last Run', render: (s) => <span className="text-xs text-muted-foreground">{s.last_run_at ? formatDate(s.last_run_at) : '—'}</span> },
          { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.is_active ? 'sent' : 'cancelled'} /> },
          {
            key: 'actions', header: '',
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

// ─── Logs Tab ─────────────────────────────────────────────────────────────────

export function LogsTab() {
  const [page, setPage]     = useState(1);
  const [status, setStatus] = useState('');
  const { toast }           = useToast();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sms-logs', page, status],
    queryFn: () => smsApi.usage({ page, limit: 20, ...(status ? { status } : {}) }),
    staleTime: 30_000,
  });

  const summary = data?.summary;
  const usageStats = useMemo(() => [
    { label: 'Delivered', value: summary?.delivered ?? 0, tone: 'text-emerald-600' },
    { label: 'Sent', value: summary?.sent ?? 0, tone: 'text-blue-600' },
    { label: 'Failed', value: summary?.failed ?? 0, tone: 'text-rose-600' },
    { label: 'Queued', value: summary?.queued ?? 0, tone: 'text-amber-600' },
  ], [summary]);

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
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          >
          <option value="">All statuses</option>
          {['queued', 'sent', 'delivered', 'failed', 'rejected'].map((s) => (
            <option key={s} value={s}>{s}</option>
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
          { key: 'recipient', header: 'Recipient', render: (l) => <span className="font-mono text-xs text-foreground">{l.recipient_phone}</span> },
          { key: 'message', header: 'Message', className: 'max-w-[220px]', render: (l) => <ExpandableText className="text-muted-foreground text-xs">{l.message_text}</ExpandableText> },
          { key: 'status', header: 'Status', render: (l) => <StatusBadge status={l.status} /> },
          { key: 'credits', header: 'Credits', render: (l) => <span className="text-xs text-muted-foreground">{parseFloat(l.credits_deducted).toFixed(2)}</span> },
          { key: 'sentAt', header: 'Sent At', render: (l) => <span className="text-xs text-muted-foreground">{l.sent_at ? formatDate(l.sent_at) : '—'}</span> },
          {
            key: 'dlr', header: 'DLR',
            render: (l) => (l.provider_msg_id && l.status === 'sent') ? (
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

