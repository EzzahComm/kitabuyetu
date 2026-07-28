'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Info, Loader2, MessageSquare, Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { PageHeader } from '@/components/shared/page-header';
import { StatusPill } from '@/components/shared/status-pill';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';
import type { PaginatedResult } from '@/types/db.types';

type Status = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'dry_run';

interface WhatsAppMessage {
  id: string; member_id: string | null;
  direction: 'outbound' | 'inbound';
  to_phone: string;
  body: string | null;
  status: Status;
  wa_message_id: string | null;
  error_code: string | null; error_message: string | null;
  sent_at: string | null; delivered_at: string | null; read_at: string | null;
  failed_at: string | null; created_at: string;
  member_first_name: string | null; member_last_name: string | null;
}
interface MemberRow { id: string; first_name: string; last_name: string; phone: string }

const composeSchema = z.object({
  memberId: z.string().optional(),
  toPhone:  z.string().optional(),
  body:     z.string().min(1, 'Message body is required').max(4096),
}).refine(
  (v) => Boolean(v.memberId) || Boolean(v.toPhone?.trim()),
  { path: ['memberId'], message: 'Pick a member or enter a phone number' },
);
type ComposeForm = z.infer<typeof composeSchema>;

export default function WhatsAppPage() {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const [recipientMode, setRecipientMode] = useState<'member' | 'phone'>('member');
  const [logPage, setLogPage] = useState(1);

  const statusQ = useQuery<{ configured: boolean }>({
    queryKey: ['whatsapp', 'status'],
    queryFn:  () => api.get<{ configured: boolean }>('/whatsapp/status'),
    staleTime: 60_000,
  });
  const membersQ = useQuery<PaginatedResult<MemberRow>>({
    queryKey: ['whatsapp', 'members'],
    queryFn:  () => api.get<PaginatedResult<MemberRow>>('/members?status=active&limit=200'),
    staleTime: 60_000,
  });
  const logQ = useQuery<PaginatedResult<WhatsAppMessage>>({
    queryKey: ['whatsapp', 'log', logPage],
    queryFn:  () => api.get<PaginatedResult<WhatsAppMessage>>(`/whatsapp/messages?page=${logPage}&limit=50`),
  });

  const members = membersQ.data?.items ?? [];
  const configured = statusQ.data?.configured ?? false;

  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } = useForm<ComposeForm>({
    resolver: zodResolver(composeSchema),
  });
  const bodyVal = useWatch({ control, name: 'body' }) ?? '';

  const onSubmit = async (v: ComposeForm) => {
    try {
      const body: Record<string, unknown> = { body: v.body };
      if (recipientMode === 'member' && v.memberId) body.memberId = v.memberId;
      if (recipientMode === 'phone'  && v.toPhone)  body.toPhone  = v.toPhone.trim();
      await api.post<WhatsAppMessage>('/whatsapp/messages', body);
      toast({ title: 'Message recorded', description: configured ? 'Sent via WhatsApp Cloud API' : 'Logged as dry-run (env not configured)' });
      reset({ body: '' });
      await qc.invalidateQueries({ queryKey: ['whatsapp', 'log'] });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Send failed', description: err instanceof ApiError ? err.message : '' });
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="WhatsApp"
        description="Send WhatsApp Business messages and review the delivery log. Automated triggers come in E10.2."
      />

      {!configured && (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Dry-run mode</p>
            <p className="text-xs">
              Set <code className="rounded bg-amber-100 px-1">WHATSAPP_PHONE_ID</code> and
              <code className="ml-1 rounded bg-amber-100 px-1">WHATSAPP_ACCESS_TOKEN</code> in your environment to enable live sends.
              Messages submitted here are logged with status <Badge variant="warning" className="mx-1">dry_run</Badge> and never leave the system.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Compose */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Compose</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
              {/* Recipient mode toggle */}
              <div className="flex rounded-md border p-0.5">
                <button
                  type="button"
                  onClick={() => setRecipientMode('member')}
                  className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${recipientMode === 'member' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  Group member
                </button>
                <button
                  type="button"
                  onClick={() => setRecipientMode('phone')}
                  className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${recipientMode === 'phone' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  Raw phone
                </button>
              </div>

              {recipientMode === 'member' ? (
                <div className="space-y-1">
                  <Label htmlFor="memberId">Member</Label>
                  <select id="memberId" {...register('memberId')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">— Select —</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.first_name} {m.last_name} ({m.phone})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="toPhone">Phone number</Label>
                  <Input id="toPhone" placeholder="+254712345678" {...register('toPhone')} />
                </div>
              )}
              {errors.memberId && <p className="text-xs text-red-600">{errors.memberId.message}</p>}

              <div className="space-y-1">
                <Label htmlFor="body">Message</Label>
                <Textarea id="body" rows={5} placeholder="Type your message…" {...register('body')} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{errors.body?.message}</span>
                  <span>{bodyVal.length} / 4096</span>
                </div>
              </div>

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                {configured ? 'Send' : 'Send (dry run)'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Log */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Message log</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <PaginatedTable<WhatsAppMessage>
              data={logQ.data}
              isLoading={logQ.isLoading}
              onPageChange={setLogPage}
              emptyMessage="No messages sent yet"
              emptyIcon={MessageSquare}
              columns={[
                { key: 'created_at', header: 'Sent', render: (m) => <span className="font-mono text-xs">{new Date(m.created_at).toLocaleString()}</span> },
                { key: 'to', header: 'To', render: (m) => m.member_first_name ? (
                  <>
                    <p>{m.member_first_name} {m.member_last_name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{m.to_phone}</p>
                  </>
                ) : (
                  <p className="font-mono text-xs">{m.to_phone}</p>
                ) },
                { key: 'body', header: 'Body', className: 'max-w-md', render: (m) => (
                  <div className="text-xs">
                    <p className="truncate" title={m.body ?? ''}>{m.body}</p>
                    {m.error_message && (
                      <p className="mt-1 text-xs text-red-600">⚠ {m.error_message}</p>
                    )}
                  </div>
                ) },
                { key: 'status', header: 'Status', render: (m) => (
                  <StatusPill status={m.status} tone={m.status === 'read' ? 'positive' : undefined} size="sm" />
                ) },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
