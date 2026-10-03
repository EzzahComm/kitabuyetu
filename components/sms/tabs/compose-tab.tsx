'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BulkSmsPayload } from '@/lib/validators/sms.schema';
import { smsApi } from '@/lib/api/endpoints';
import { useToast } from '@/hooks/use-toast';
import { formatDate, getErrorMessage } from '@/lib/utils';
import { countSegments } from '@/lib/sms/segments';
import type { SmsTemplate } from '@/types/api.types';
import type { SmsBulkPreview } from '@/lib/api/endpoints';

export function ComposeTab() {
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState<'all' | 'active' | 'custom'>('all');
  const [phones, setPhones] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [preview, setPreview] = useState<SmsBulkPreview | null>(null);

  const { data: templates } = useQuery({ queryKey: ['sms-templates'], queryFn: () => smsApi.templates() });

  const sendMutation = useMutation({
    mutationFn: (body: BulkSmsPayload) => smsApi.bulk(body),
    onSuccess: (res) => {
      toast({ title: `Queued ${res.queued} messages for delivery` });
      setMessage('');
      setPhones('');
    },
    onError: (err) => toast({ variant: 'destructive', title: 'Send failed', description: getErrorMessage(err) }),
  });

  const previewMutation = useMutation({
    mutationFn: (body: BulkSmsPayload) =>
      smsApi.previewBulk({
        message: body.message,
        ...(body.phones ? { phones: body.phones } : { recipientType: body.recipientType }),
      }),
    onSuccess: (p) => setPreview(p),
    onError: (err) =>
      toast({
        variant: 'destructive',
        title: 'Could not price this send',
        description: getErrorMessage(err),
      }),
  });

  const buildPayload = (): BulkSmsPayload | null => {
    if (target === 'custom') {
      const recipientPhones = phones
        .split(/[\n,;]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (!recipientPhones.length) {
        toast({ variant: 'destructive', title: 'Add at least one phone number' });
        return null;
      }
      return { phones: recipientPhones, message };
    }
    return { recipientType: target === 'active' ? 'active_members' : 'all_members', message };
  };

  const handleSend = () => {
    if (!message.trim()) return;
    const payload = buildPayload();
    if (!payload) return;
    previewMutation.mutate(payload);
  };

  const confirmSend = () => {
    const payload = buildPayload();
    if (!payload) return;
    setPreview(null);
    sendMutation.mutate(payload);
  };

  const tplList: SmsTemplate[] = templates ?? [];

  const handleTemplateSelect = (id: string) => {
    setTemplateId(id);
    const tpl = tplList.find((t) => t.id === id);
    if (tpl) setMessage(tpl.body);
  };

  const seg = countSegments(message);
  const hasVariables = message.includes('{{');

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
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
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
            {hasVariables && (
              <p className="text-xs text-muted-foreground mt-1">
                Variables change the final length — Review and send shows the real cost.
              </p>
            )}
            {seg.encoding === 'ucs2' && (
              <p className="text-xs text-amber-700 mt-1">
                This message uses a special character (curly quote, dash or emoji), which more than halves how much fits
                in each SMS part. Replacing it with a plain one usually costs less to send.
              </p>
            )}
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
                    target === t
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'text-muted-foreground border-input hover:border-ring'
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

          {preview && (
            <div
              className={`rounded-lg border px-4 py-3 space-y-2 ${
                preview.affordable ? 'border-border bg-muted/40' : 'border-rose-200 bg-rose-50'
              }`}
            >
              <p className="text-sm font-medium">
                {preview.recipients} recipient{preview.recipients === 1 ? '' : 's'} · {preview.creditsRequired} credit
                {preview.creditsRequired === 1 ? '' : 's'}
              </p>
              <p className="text-xs text-muted-foreground">
                {preview.segmentsPerMessage} SMS part{preview.segmentsPerMessage === 1 ? '' : 's'} each.
                {preview.optedOut > 0 &&
                  ` ${preview.optedOut} opted-out number${preview.optedOut === 1 ? '' : 's'} excluded.`}{' '}
                Balance after: {Math.max(preview.balance.available - preview.creditsRequired, 0)} of{' '}
                {preview.balance.available}.
              </p>

              {!preview.affordable && (
                <p className="text-xs font-medium text-rose-700">
                  Not enough credits — this needs {preview.creditsRequired} and {preview.balance.available} are
                  available.
                </p>
              )}
              {preview.recipients === 0 && (
                <p className="text-xs font-medium text-rose-700">This would reach nobody.</p>
              )}
              {preview.requiresConfirmation && preview.affordable && preview.recipients > 0 && (
                <p className="text-xs font-medium text-amber-700">
                  That is a large send. Check the recipient count before confirming.
                </p>
              )}
              {preview.unresolvableVariables.length > 0 && (
                <p className="text-xs font-medium text-amber-700">
                  {preview.unresolvableVariables.map((v) => `{{${v}}}`).join(', ')}{' '}
                  {preview.unresolvableVariables.length === 1 ? 'has' : 'have'} no value for these recipients and will
                  be removed, leaving a gap in the message. Delete{' '}
                  {preview.unresolvableVariables.length === 1 ? 'it' : 'them'} or pick a different template.
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={confirmSend}
                  disabled={!preview.affordable || preview.recipients === 0}
                  loading={sendMutation.isPending}
                >
                  <Send size={14} />
                  {preview.requiresConfirmation ? `Yes, send to ${preview.recipients}` : 'Confirm and send'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPreview(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {!preview && (
            <Button type="button" onClick={handleSend} disabled={!message.trim()} loading={previewMutation.isPending}>
              <Send size={15} />
              {previewMutation.isPending ? 'Checking…' : 'Review and send'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
