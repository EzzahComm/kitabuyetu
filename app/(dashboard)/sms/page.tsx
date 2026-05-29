'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Send, MessageSquare, LayoutTemplate, Clock, BarChart2,
  RefreshCw, Plus, Trash2, PauseCircle, PlayCircle, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { smsApi } from '@/lib/api/endpoints';
import { useToast } from '@/hooks/use-toast';
import { formatDate } from '@/lib/utils';
import { useMembers } from '@/hooks/use-members';
import { StatusPill } from '@/components/shared/status-pill';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SmsLog {
  id: string;
  recipient_phone: string;
  message_text: string;
  status: string;
  credits_deducted: string;
  provider_msg_id: string | null;
  sent_at: string | null;
  created_at: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  message: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  scheduled_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface Template {
  id: string;
  template_key: string;
  name: string;
  body: string;
  category: string;
  is_system: boolean;
  is_active: boolean;
  variables: string[];
}

interface Schedule {
  id: string;
  name: string;
  schedule_type: string;
  is_active: boolean;
  cron_expression: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  template_name: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Thin wrapper over the shared StatusPill so existing call sites stay unchanged.
function StatusBadge({ status }: { status: string }) {
  return <StatusPill status={status} size="sm" />;
}

function CategoryBadge({ category }: { category: string }) {
  const cls: Record<string, string> = {
    transaction:  'bg-blue-50 text-blue-700',
    loan:         'bg-amber-50 text-amber-700',
    reminder:     'bg-orange-50 text-orange-700',
    birthday:     'bg-pink-50 text-pink-700',
    onboarding:   'bg-teal-50 text-teal-700',
    auth:         'bg-violet-50 text-violet-700',
    announcement: 'bg-indigo-50 text-indigo-700',
    custom:       'bg-gray-50 text-gray-600',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${cls[category] ?? 'bg-gray-50 text-gray-600'}`}>
      {category}
    </span>
  );
}

const TABS = [
  { key: 'compose',   label: 'Compose',   icon: Send },
  { key: 'campaigns', label: 'Campaigns', icon: BarChart2 },
  { key: 'templates', label: 'Templates', icon: LayoutTemplate },
  { key: 'schedules', label: 'Schedules', icon: Clock },
  { key: 'logs',      label: 'SMS Logs',  icon: MessageSquare },
] as const;

type TabKey = (typeof TABS)[number]['key'];

// ─── Compose Tab ─────────────────────────────────────────────────────────────

function ComposeTab() {
  const { toast } = useToast();
  const [message, setMessage]   = useState('');
  const [target, setTarget]     = useState<'all' | 'active' | 'custom'>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [phones, setPhones]     = useState('');
  const [templateId, setTemplateId] = useState('');

  const { data: members } = useMembers({ pageSize: 500 });
  const { data: templates } = useQuery({ queryKey: ['sms-templates'], queryFn: () => smsApi.templates() });

  const sendMutation = useMutation({
    mutationFn: (body: unknown) => smsApi.bulk(body),
    onSuccess: (res: any) => {
      toast({ title: `Queued ${res?.data?.queued ?? 0} messages for delivery` });
      setMessage(''); setSelected([]); setPhones('');
    },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Send failed', description: err.message }),
  });

  const handleSend = () => {
    if (!message.trim()) return;
    let recipientPhones: string[] = [];
    if (target === 'custom') {
      recipientPhones = phones.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
    } else if (target === 'active') {
      recipientPhones = (members?.items ?? []).filter((m: any) => m.status === 'active').map((m: any) => m.phone);
    } else {
      recipientPhones = (members?.items ?? []).map((m: any) => m.phone);
    }
    sendMutation.mutate({ phones: recipientPhones, message });
  };

  const tplList: Template[] = (templates as any)?.data ?? [];

  const handleTemplateSelect = (id: string) => {
    setTemplateId(id);
    const tpl = tplList.find((t) => t.id === id);
    if (tpl) setMessage(tpl.body);
  };

  const charCount = message.length;
  const smsPages  = Math.max(1, Math.ceil(charCount / 160));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white rounded-xl border p-5 space-y-4">
          <h2 className="font-semibold text-sm text-gray-900">Compose Message</h2>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Load Template</label>
            <select
              aria-label="Load template"
              className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label className="text-xs font-medium text-gray-700 block mb-1">Message</label>
            <textarea
              className="w-full text-sm border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={5}
              placeholder="Type your message…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>{charCount} chars</span>
              <span>{smsPages} SMS part{smsPages > 1 ? 's' : ''}</span>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-2">Recipients</label>
            <div className="flex gap-2 mb-3">
              {(['all', 'active', 'custom'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTarget(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    target === t ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {t === 'all' ? 'All Members' : t === 'active' ? 'Active Only' : 'Custom Phones'}
                </button>
              ))}
            </div>
            {target === 'custom' && (
              <textarea
                className="w-full text-sm border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
                placeholder="Enter phone numbers, one per line or comma-separated (254…)"
                value={phones}
                onChange={(e) => setPhones(e.target.value)}
              />
            )}
          </div>

          <button
            type="button"
            onClick={handleSend}
            disabled={!message.trim() || sendMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Send size={15} />
            {sendMutation.isPending ? 'Sending…' : 'Send SMS'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <BalanceCard />
      </div>
    </div>
  );
}

// ─── Balance Card ─────────────────────────────────────────────────────────────

function BalanceCard() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['sms-provider-balance'],
    queryFn:  () => smsApi.providerBalance(),
    staleTime: 5 * 60_000,
  });

  const refresh = useMutation({
    mutationFn: () => smsApi.checkBalance(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sms-provider-balance'] }); },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Balance check failed', description: e.message }),
  });

  const bal = (data as any)?.data;

  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Provider Balance</span>
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          title="Refresh balance"
        >
          <RefreshCw size={14} className={refresh.isPending ? 'animate-spin' : ''} />
        </button>
      </div>
      {isLoading ? (
        <div className="h-8 bg-gray-100 rounded animate-pulse" />
      ) : (
        <p className="text-2xl font-bold text-gray-900">
          KES {bal?.balance != null ? Number(bal.balance).toFixed(2) : '—'}
        </p>
      )}
      {bal?.lastChecked && (
        <p className="text-xs text-gray-400 mt-1">Checked {formatDate(bal.lastChecked)}</p>
      )}
    </div>
  );
}

// ─── Campaigns Tab ────────────────────────────────────────────────────────────

function CampaignsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName]         = useState('');
  const [message, setMessage]   = useState('');
  const [recipType, setRecipType] = useState('all_members');
  const [scheduledAt, setScheduledAt] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['sms-campaigns'],
    queryFn: () => smsApi.campaigns(),
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: (body: unknown) => smsApi.createCampaign(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-campaigns'] });
      toast({ title: 'Campaign created' });
      setShowForm(false); setName(''); setMessage(''); setScheduledAt('');
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e.message }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => smsApi.cancelCampaign(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sms-campaigns'] }); toast({ title: 'Campaign cancelled' }); },
  });

  const campaigns: Campaign[] = (data as any)?.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">SMS Campaigns</h2>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={13} /> New Campaign
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <h3 className="text-sm font-medium text-gray-800">New Campaign</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 block mb-1">Name</label>
              <input className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Recipients</label>
              <select aria-label="Select recipients" className="w-full text-sm border rounded-lg px-3 py-2" value={recipType} onChange={(e) => setRecipType(e.target.value)}>
                <option value="all_members">All Members</option>
                <option value="active_members">Active Members</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Message</label>
            <textarea className="w-full text-sm border rounded-lg px-3 py-2 resize-none" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message text…" />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Schedule (optional)</label>
            <input type="datetime-local" aria-label="Schedule date and time" className="text-sm border rounded-lg px-3 py-2" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => create.mutate({ name, message, recipientType: recipType, scheduledAt: scheduledAt || null })}
              disabled={!name || !message || create.isPending}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {create.isPending ? 'Creating…' : scheduledAt ? 'Schedule' : 'Send Now'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading campaigns…</div>
        ) : campaigns.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No campaigns yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Name', 'Status', 'Recipients', 'Sent / Failed', 'Scheduled', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-gray-600">{c.recipient_count.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className="text-green-600">{c.sent_count}</span>
                    {' / '}
                    <span className="text-red-500">{c.failed_count}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.scheduled_at ? formatDate(c.scheduled_at) : c.completed_at ? formatDate(c.completed_at) : '—'}</td>
                  <td className="px-4 py-3">
                    {(c.status === 'draft' || c.status === 'scheduled') && (
                      <button
                        type="button"
                        onClick={() => cancel.mutate(c.id)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Cancel"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [key, setKey]       = useState('');
  const [name, setName]     = useState('');
  const [body, setBody]     = useState('');
  const [category, setCategory] = useState('custom');

  const { data, isLoading } = useQuery({
    queryKey: ['sms-templates'],
    queryFn: () => smsApi.templates(),
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: (b: unknown) => smsApi.createTemplate(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      toast({ title: 'Template created' });
      setShowForm(false); setKey(''); setName(''); setBody('');
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e.message }),
  });

  const del = useMutation({
    mutationFn: (id: string) => smsApi.deleteTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sms-templates'] }); toast({ title: 'Template deleted' }); },
  });

  const templates: Template[] = (data as any)?.data ?? [];
  const charCount = body.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">SMS Templates</h2>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={13} /> New Template
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <h3 className="text-sm font-medium">New Template</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 block mb-1">Key (snake_case)</label>
              <input className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s/g, '_'))} placeholder="my_template" />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Display Name</label>
              <input className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Template" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Category</label>
            <select aria-label="Template category" className="w-full text-sm border rounded-lg px-3 py-2" value={category} onChange={(e) => setCategory(e.target.value)}>
              {['transaction', 'loan', 'reminder', 'birthday', 'onboarding', 'auth', 'announcement', 'custom'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">
              Body <span className="text-gray-400">(use {'{{variable}}'} for placeholders)</span>
            </label>
            <textarea
              className="w-full text-sm border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Dear {{first_name}}, your balance is KES {{amount}}."
            />
            <p className="text-xs text-gray-400 mt-1">{charCount} chars</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => create.mutate({ templateKey: key, name, body, category })}
              disabled={!key || !name || !body || create.isPending}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {create.isPending ? 'Saving…' : 'Save Template'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading templates…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Name', 'Key', 'Category', 'Variables', 'Body', 'Type', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {templates.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.template_key}</td>
                  <td className="px-4 py-3"><CategoryBadge category={t.category} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{(t.variables ?? []).join(', ') || '—'}</td>
                  <td className="px-4 py-3 max-w-[280px] truncate text-gray-600 text-xs">{t.body}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${t.is_system ? 'text-blue-500' : 'text-gray-400'}`}>
                      {t.is_system ? 'System' : 'Custom'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {!t.is_system && (
                      <button
                        type="button"
                        onClick={() => del.mutate(t.id)}
                        aria-label="Delete template"
                        className="text-red-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Schedules Tab ────────────────────────────────────────────────────────────

function SchedulesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [sName, setSName]           = useState('');
  const [sType, setSType]           = useState('one_time');
  const [sCron, setSCron]           = useState('');
  const [sNextRun, setSNextRun]     = useState('');
  const [sMessage, setSMessage]     = useState('');
  const [recipType, setRecipType]   = useState('all_members');

  const { data, isLoading } = useQuery({
    queryKey: ['sms-schedules'],
    queryFn: () => smsApi.schedules(),
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: (b: unknown) => smsApi.createSchedule(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-schedules'] });
      toast({ title: 'Schedule created' });
      setShowForm(false); setSName(''); setSMessage(''); setSCron(''); setSNextRun('');
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e.message }),
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

  const schedules: Schedule[] = (data as any)?.data ?? [];

  const SCHEDULE_TYPES = ['one_time', 'daily', 'weekly', 'monthly', 'birthday', 'loan_due'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">SMS Schedules</h2>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={13} /> New Schedule
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <h3 className="text-sm font-medium">New Schedule</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 block mb-1">Name</label>
              <input className="w-full text-sm border rounded-lg px-3 py-2" value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Schedule name" />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Type</label>
              <select aria-label="Schedule type" className="w-full text-sm border rounded-lg px-3 py-2" value={sType} onChange={(e) => setSType(e.target.value)}>
                {SCHEDULE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Recipients</label>
              <select aria-label="Select recipients" className="w-full text-sm border rounded-lg px-3 py-2" value={recipType} onChange={(e) => setRecipType(e.target.value)}>
                <option value="all_members">All Members</option>
                <option value="active_members">Active Members</option>
              </select>
            </div>
            {sType === 'one_time' ? (
              <div>
                <label className="text-xs text-gray-600 block mb-1">Run At</label>
                <input type="datetime-local" aria-label="Schedule run date and time" className="w-full text-sm border rounded-lg px-3 py-2" value={sNextRun} onChange={(e) => setSNextRun(e.target.value)} />
              </div>
            ) : (
              <div>
                <label className="text-xs text-gray-600 block mb-1">Cron Expression</label>
                <input className="w-full text-sm border rounded-lg px-3 py-2 font-mono" value={sCron} onChange={(e) => setSCron(e.target.value)} placeholder="0 8 * * *" />
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Message</label>
            <textarea className="w-full text-sm border rounded-lg px-3 py-2 resize-none" rows={3} value={sMessage} onChange={(e) => setSMessage(e.target.value)} placeholder="Message text…" />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                create.mutate({
                  name: sName, scheduleType: sType, message: sMessage,
                  recipientType: recipType,
                  cronExpression: sCron || undefined,
                  nextRunAt: sNextRun ? new Date(sNextRun).toISOString() : undefined,
                })
              }
              disabled={!sName || !sMessage || create.isPending}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {create.isPending ? 'Saving…' : 'Save Schedule'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading schedules…</div>
        ) : schedules.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No schedules yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Name', 'Type', 'Cron / Next Run', 'Last Run', 'Status', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {schedules.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 capitalize text-gray-600 text-xs">{s.schedule_type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                    {s.cron_expression ?? (s.next_run_at ? formatDate(s.next_run_at) : '—')}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{s.last_run_at ? formatDate(s.last_run_at) : '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.is_active ? 'sent' : 'cancelled'} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggle.mutate({ id: s.id, isActive: !s.is_active })}
                        className="text-gray-400 hover:text-gray-700 transition-colors"
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Logs Tab ─────────────────────────────────────────────────────────────────

function LogsTab() {
  const [page, setPage]     = useState(1);
  const [status, setStatus] = useState('');
  const { toast }           = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['sms-logs', page, status],
    queryFn: () => smsApi.usage({ page, limit: 20, ...(status ? { status } : {}) }),
    staleTime: 30_000,
  });

  const result = (data as any)?.data;
  const logs: SmsLog[] = result?.items ?? [];
  const totalPages     = result?.totalPages ?? 1;

  const checkDlr = async (msgId: string) => {
    try {
      await smsApi.dlr(msgId);
      toast({ title: 'DLR checked', description: 'Status updated.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'DLR failed', description: e.message });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-900">SMS Logs</h2>
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
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No SMS logs found</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Recipient', 'Message', 'Status', 'Credits', 'Sent At', 'DLR'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{l.recipient_phone}</td>
                  <td className="px-4 py-3 max-w-[220px] truncate text-gray-600 text-xs">{l.message_text}</td>
                  <td className="px-4 py-3"><StatusBadge status={l.status} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{parseFloat(l.credits_deducted).toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{l.sent_at ? formatDate(l.sent_at) : '—'}</td>
                  <td className="px-4 py-3">
                    {l.provider_msg_id && l.status === 'sent' && (
                      <button
                        type="button"
                        onClick={() => checkDlr(l.provider_msg_id!)}
                        className="text-xs text-blue-500 hover:underline"
                      >
                        Check
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)} className="p-1.5 rounded border hover:bg-gray-50 disabled:opacity-40"><ChevronLeft size={14} /></button>
            <button type="button" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="p-1.5 rounded border hover:bg-gray-50 disabled:opacity-40"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SmsPage() {
  const [tab, setTab] = useState<TabKey>('compose');

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">SMS Centre</h1>
        <p className="text-sm text-gray-500 mt-0.5">Send, schedule, and track messages via TextSMS Kenya</p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'compose'   && <ComposeTab />}
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'schedules' && <SchedulesTab />}
      {tab === 'logs'      && <LogsTab />}
    </div>
  );
}
