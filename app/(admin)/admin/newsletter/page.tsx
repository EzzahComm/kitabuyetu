'use client';

import { useState } from 'react';
import { Download, Loader2, Mail, UserCheck, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import {
  useNewsletterSubscribers,
  useNewsletterDigests,
  useMarketingTemplates,
  useComposeNewsletterDigest,
  useUpdateNewsletterDigest,
  useSendNewsletterDigest,
} from '@/hooks/use-admin';
import type { MarketingTemplateKey } from '@/lib/services/newsletter-digest.service';
import { useToast } from '@/hooks/use-toast';
import { downloadAuthenticated } from '@/lib/utils/download';
import { formatDate, getErrorMessage } from '@/lib/utils';

function DigestComposer() {
  const { toast } = useToast();
  const { data: digests, isLoading } = useNewsletterDigests();
  const { data: templates } = useMarketingTemplates();
  const compose = useComposeNewsletterDigest();
  const update = useUpdateNewsletterDigest();
  const send = useSendNewsletterDigest();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const draft = digests?.find((d) => d.id === editingId);

  const onCompose = async (templateKey: MarketingTemplateKey) => {
    try {
      const result = await compose.mutateAsync(templateKey);
      setEditingId(result.id);
      setSubject(result.subject);
      setHtmlBody(result.html_body);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not compose digest', description: getErrorMessage(e) });
    }
  };

  const onSaveEdits = async () => {
    if (!editingId) return;
    try {
      await update.mutateAsync({ id: editingId, subject, htmlBody });
      toast({ title: 'Draft saved' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not save', description: getErrorMessage(e) });
    }
  };

  const onSend = async () => {
    if (!confirmingId) return;
    try {
      await send.mutateAsync(confirmingId);
      toast({ title: 'Digest queued for sending', description: 'Delivery runs over the next few minutes.' });
      setConfirmingId(null);
      setEditingId(null);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not send', description: getErrorMessage(e) });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Marketing email</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Pick a starter template, edit it, and send it to active subscribers to drive signups.
          </p>
          <div className="flex flex-wrap gap-2">
            {templates?.map((t) => (
              <Button
                key={t.key}
                size="sm"
                variant="outline"
                title={t.description}
                onClick={() => onCompose(t.key)}
                disabled={compose.isPending}
              >
                {compose.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t.label}
              </Button>
            ))}
          </div>
        </div>

        {draft && draft.status === 'draft' && (
          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-1.5">
              <Label htmlFor="digest-subject">Subject</Label>
              <Input id="digest-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="digest-body">Body (HTML)</Label>
              <Textarea
                id="digest-body"
                rows={10}
                className="font-mono text-xs"
                value={htmlBody}
                onChange={(e) => setHtmlBody(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Preview</Label>
              {/* Sandboxed with no `allow-scripts`/`allow-same-origin` so an
                  admin editing raw HTML here can't have it execute in this
                  page - the browser enforces that, not string filtering. */}
              <iframe
                title="Digest preview"
                sandbox=""
                srcDoc={htmlBody}
                className="h-80 w-full rounded-md border bg-white"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" onClick={onSaveEdits} disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </Button>
              <Button size="sm" onClick={() => setConfirmingId(editingId)}>
                Send to active subscribers
              </Button>
            </div>
          </div>
        )}

        {!isLoading && digests && digests.length > 0 && (
          <div className="space-y-1.5">
            <Label>Recent digests</Label>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {digests.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="max-w-xs truncate font-medium">{d.subject}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === 'sent' ? 'default' : 'outline'}>{d.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.sent_count}
                      {d.total_recipients ? ` / ${d.total_recipients}` : ''}
                      {d.failed_count > 0 ? ` (${d.failed_count} failed)` : ''}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(d.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!confirmingId} onOpenChange={(v) => !v && setConfirmingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this email?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This sends to every active newsletter subscriber. It cannot be recalled once sending starts.
          </p>
          <DialogFooter>
            <Button onClick={onSend} disabled={send.isPending}>
              {send.isPending ? 'Sending…' : 'Send now'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function NewsletterAdminPage() {
  const { toast } = useToast();
  const { data, isLoading } = useNewsletterSubscribers();
  const [exporting, setExporting] = useState(false);

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadAuthenticated('/api/admin/newsletter/export', {
        fallbackFilename: `newsletter-subscribers-${new Date().toISOString().slice(0, 10)}.csv`,
      });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Export failed', description: getErrorMessage(e) });
    } finally {
      setExporting(false);
    }
  };

  const subscribers = data?.subscribers ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Newsletter"
        description="Public marketing-site subscribers - captured from the site footer and content pages."
        actions={
          <Button variant="outline" size="sm" onClick={onExport} disabled={exporting || !subscribers.length}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Export CSV
          </Button>
        }
      />

      {!isLoading && data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard title="Total ever subscribed" value={data.stats.total} icon={Mail} accent="blue" />
          <StatCard title="Active subscribers" value={data.stats.active} icon={UserCheck} accent="green" />
          <StatCard title="Unsubscribed" value={data.stats.unsubscribed} icon={UserX} accent="gray" />
        </div>
      )}

      <DigestComposer />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : subscribers.length === 0 ? (
            <p className="p-16 text-center text-sm text-muted-foreground">
              No subscribers yet - the signup form is live in the site footer and on the Resources pages.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Subscribed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscribers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.email}</TableCell>
                    <TableCell>{s.name ?? '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{s.source}</TableCell>
                    <TableCell>{formatDate(s.subscribed_at)}</TableCell>
                    <TableCell>
                      {s.unsubscribed_at ? <Badge variant="outline">Unsubscribed</Badge> : <Badge>Active</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
