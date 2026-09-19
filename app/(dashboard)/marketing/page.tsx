'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import {
  useAudiences, useCreateAudience, useCampaigns, useCreateCampaign,
  useSubmitCampaign, useApproveCampaign, useRejectCampaign, useCancelCampaign,
} from '@/hooks/use-marketing-campaigns';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage, formatDate } from '@/lib/utils';
import { useHasPermission } from '@/lib/auth/use-permission';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import type { AudienceSource, Campaign, Channel } from '@/lib/services/marketing-campaigns.service';

const SOURCES: { value: AudienceSource; label: string }[] = [
  { value: 'all_members', label: 'All members' },
  { value: 'active_members', label: 'Active members only' },
  { value: 'crm_contacts_opted_in', label: 'Opted-in contacts (CRM)' },
];

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
];

const STATUS_VARIANT: Record<Campaign['status'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  pending_review: 'secondary',
  approved: 'secondary',
  rejected: 'destructive',
  sending: 'default',
  completed: 'default',
  cancelled: 'outline',
};

export default function MarketingCampaignsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canManage = useHasPermission('crm.manage');
  const isChairperson = isTenantUser(user) && user.groupRole === 'chairperson';

  const { data: audiences } = useAudiences();
  const { data: campaigns, isLoading } = useCampaigns();
  const createAudience = useCreateAudience();
  const createCampaign = useCreateCampaign();
  const submitCampaign = useSubmitCampaign();
  const approveCampaign = useApproveCampaign();
  const rejectCampaign = useRejectCampaign();
  const cancelCampaign = useCancelCampaign();

  const [audienceOpen, setAudienceOpen] = useState(false);
  const [audienceForm, setAudienceForm] = useState({ name: '', source: 'all_members' as AudienceSource });

  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignForm, setCampaignForm] = useState({
    title: '', message: '', audience_id: '', channel: 'sms' as Channel, subject: '',
  });

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const onCreateAudience = async () => {
    try {
      await createAudience.mutateAsync(audienceForm);
      toast({ title: 'Audience created' });
      setAudienceForm({ name: '', source: 'all_members' });
      setAudienceOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onCreateCampaign = async () => {
    try {
      await createCampaign.mutateAsync({
        ...campaignForm,
        subject: campaignForm.channel === 'email' ? campaignForm.subject : undefined,
      });
      toast({ title: 'Campaign created as draft' });
      setCampaignForm({ title: '', message: '', audience_id: '', channel: 'sms', subject: '' });
      setCampaignOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onSubmit = async (id: string) => {
    try {
      await submitCampaign.mutateAsync(id);
      toast({ title: 'Submitted for review' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onApprove = async (id: string) => {
    try {
      await approveCampaign.mutateAsync(id);
      toast({ title: 'Approved — sending now' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onReject = async () => {
    if (!rejectingId) return;
    try {
      await rejectCampaign.mutateAsync({ id: rejectingId, reason: rejectReason });
      toast({ title: 'Campaign rejected' });
      setRejectingId(null);
      setRejectReason('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onCancel = async (id: string) => {
    try {
      await cancelCampaign.mutateAsync(id);
      toast({ title: 'Campaign cancelled' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing campaigns"
        description="SMS and email campaigns to your members or opted-in contacts. Every campaign needs chairperson approval before it sends."
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Dialog open={audienceOpen} onOpenChange={setAudienceOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">New audience</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New audience</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="aud_name">Name *</Label>
                      <Input id="aud_name" value={audienceForm.name} onChange={(e) => setAudienceForm((f) => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="aud_source">Who&rsquo;s in it *</Label>
                      <Select value={audienceForm.source} onValueChange={(v) => setAudienceForm((f) => ({ ...f, source: v as AudienceSource }))}>
                        <SelectTrigger id="aud_source"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={onCreateAudience} disabled={!audienceForm.name.trim() || createAudience.isPending}>
                      {createAudience.isPending ? 'Creating…' : 'Create audience'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={campaignOpen} onOpenChange={setCampaignOpen}>
                <DialogTrigger asChild>
                  <Button disabled={!audiences || audiences.length === 0}>New campaign</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New campaign</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="c_title">Title *</Label>
                      <Input id="c_title" value={campaignForm.title} onChange={(e) => setCampaignForm((f) => ({ ...f, title: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="c_channel">Channel *</Label>
                      <Select value={campaignForm.channel} onValueChange={(v) => setCampaignForm((f) => ({ ...f, channel: v as Channel }))}>
                        <SelectTrigger id="c_channel"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="c_audience">Audience *</Label>
                      <Select value={campaignForm.audience_id} onValueChange={(v) => setCampaignForm((f) => ({ ...f, audience_id: v }))}>
                        <SelectTrigger id="c_audience"><SelectValue placeholder="Select an audience" /></SelectTrigger>
                        <SelectContent>
                          {(audiences || []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {campaignForm.channel === 'email' && (
                      <div className="space-y-1.5">
                        <Label htmlFor="c_subject">Subject *</Label>
                        <Input id="c_subject" value={campaignForm.subject} onChange={(e) => setCampaignForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Email subject line" />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="c_message">Message *</Label>
                      <Textarea id="c_message" rows={4} value={campaignForm.message} onChange={(e) => setCampaignForm((f) => ({ ...f, message: e.target.value }))} placeholder="What should this message say?" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={onCreateCampaign}
                      disabled={
                        !campaignForm.title.trim() ||
                        !campaignForm.message.trim() ||
                        !campaignForm.audience_id ||
                        (campaignForm.channel === 'email' && !campaignForm.subject.trim()) ||
                        createCampaign.isPending
                      }
                    >
                      {createCampaign.isPending ? 'Creating…' : 'Create draft'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          ) : undefined
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !campaigns || campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No campaigns yet. Create an audience, then a campaign, to reach your members or opted-in contacts by SMS or email.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{c.title}</p>
                    <Badge variant="outline">{c.channel === 'email' ? 'Email' : 'SMS'}</Badge>
                    <Badge variant={STATUS_VARIANT[c.status]}>{c.status.replace('_', ' ')}</Badge>
                  </div>
                  {c.channel === 'email' && c.subject && (
                    <p className="mt-1 text-sm font-medium">{c.subject}</p>
                  )}
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{c.message}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {c.status === 'completed' || c.status === 'sending'
                      ? `${c.sent_count}/${c.recipient_count} sent, ${c.failed_count} failed`
                      : `Created ${formatDate(c.created_at)}`}
                  </p>
                  {c.status === 'rejected' && c.rejection_reason && (
                    <p className="mt-1 text-xs text-destructive">Rejected: {c.rejection_reason}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {c.status === 'draft' && canManage && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => onCancel(c.id)} disabled={cancelCampaign.isPending}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => onSubmit(c.id)} disabled={submitCampaign.isPending}>
                        Submit for review
                      </Button>
                    </>
                  )}
                  {c.status === 'pending_review' && isChairperson && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => { setRejectingId(c.id); setRejectReason(''); }}>
                        Reject
                      </Button>
                      <Button size="sm" onClick={() => onApprove(c.id)} disabled={approveCampaign.isPending}>
                        Approve & send
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!rejectingId} onOpenChange={(v) => !v && setRejectingId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject campaign</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason *</Label>
            <Textarea id="reason" rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why is this campaign being rejected?" />
          </div>
          <DialogFooter>
            <Button onClick={onReject} disabled={!rejectReason.trim() || rejectCampaign.isPending} variant="destructive">
              {rejectCampaign.isPending ? 'Rejecting…' : 'Reject campaign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
