'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { useContact, useSetOptIn, useCreateOpportunity, useLogActivity } from '@/hooks/use-crm';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage, formatDate } from '@/lib/utils';
import { useHasPermission } from '@/lib/auth/use-permission';
import type { ActivityType, OpportunityStage } from '@/lib/services/crm.service';

const ACTIVITY_TYPES: ActivityType[] = ['note', 'call', 'email', 'sms', 'meeting', 'task'];
const STAGES: OpportunityStage[] = ['draft', 'qualified', 'proposal', 'won', 'lost'];

export default function CrmContactDetailPage() {
  const params = useParams<{ id: string }>();
  const contactId = params.id;
  const { toast } = useToast();
  const canManage = useHasPermission('crm.manage');

  const { data, isLoading } = useContact(contactId);
  const setOptIn = useSetOptIn(contactId);
  const createOpportunity = useCreateOpportunity(contactId);
  const logActivity = useLogActivity(contactId);

  const [oppOpen, setOppOpen] = useState(false);
  const [oppForm, setOppForm] = useState({ title: '', stage: 'draft' as OpportunityStage, amount: '', notes: '' });
  const [noteBody, setNoteBody] = useState('');
  const [noteType, setNoteType] = useState<ActivityType>('note');

  const onToggleOptIn = async (checked: boolean) => {
    try {
      await setOptIn.mutateAsync(checked);
      toast({ title: checked ? 'Opted in to marketing' : 'Opted out of marketing' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onCreateOpportunity = async () => {
    try {
      await createOpportunity.mutateAsync({
        title: oppForm.title,
        stage: oppForm.stage,
        amount: oppForm.amount ? Number(oppForm.amount) : undefined,
        notes: oppForm.notes || undefined,
      });
      toast({ title: 'Opportunity created' });
      setOppForm({ title: '', stage: 'draft', amount: '', notes: '' });
      setOppOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onLogActivity = async () => {
    if (!noteBody.trim()) return;
    try {
      await logActivity.mutateAsync({ activity_type: noteType, body: noteBody });
      setNoteBody('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Contact not found.</p>;

  const { contact, opportunities, activities } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={contact.name}
        description={`${contact.contact_type.replace('_', ' ')}${[contact.email, contact.phone].filter(Boolean).length ? ' · ' + [contact.email, contact.phone].filter(Boolean).join(' · ') : ''}`}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Opportunities</h3>
                {canManage && (
                  <Dialog open={oppOpen} onOpenChange={setOppOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        Add opportunity
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add opportunity</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="title">Title *</Label>
                          <Input
                            id="title"
                            value={oppForm.title}
                            onChange={(e) => setOppForm((f) => ({ ...f, title: e.target.value }))}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="stage">Stage</Label>
                            <Select
                              value={oppForm.stage}
                              onValueChange={(v) => setOppForm((f) => ({ ...f, stage: v as OpportunityStage }))}
                            >
                              <SelectTrigger id="stage">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STAGES.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {s}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="amount">Amount (KES)</Label>
                            <Input
                              id="amount"
                              type="number"
                              value={oppForm.amount}
                              onChange={(e) => setOppForm((f) => ({ ...f, amount: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="opp_notes">Notes</Label>
                          <Textarea
                            id="opp_notes"
                            rows={3}
                            value={oppForm.notes}
                            onChange={(e) => setOppForm((f) => ({ ...f, notes: e.target.value }))}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          onClick={onCreateOpportunity}
                          disabled={!oppForm.title.trim() || createOpportunity.isPending}
                        >
                          {createOpportunity.isPending ? 'Creating…' : 'Create opportunity'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              {opportunities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No opportunities yet.</p>
              ) : (
                <div className="space-y-2">
                  {opportunities.map((o) => (
                    <div key={o.id} className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <p className="text-sm font-medium">{o.title}</p>
                        {o.amount && (
                          <p className="text-xs text-muted-foreground">KES {Number(o.amount).toLocaleString()}</p>
                        )}
                      </div>
                      <Badge variant="secondary">{o.stage}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 space-y-4">
              <h3 className="font-semibold">Activity timeline</h3>
              {canManage && (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex gap-2">
                    <Select value={noteType} onValueChange={(v) => setNoteType(v as ActivityType)}>
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTIVITY_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={noteBody}
                      onChange={(e) => setNoteBody(e.target.value)}
                      placeholder="Log a call, note, meeting…"
                      className="flex-1"
                    />
                    <Button onClick={onLogActivity} disabled={!noteBody.trim() || logActivity.isPending} size="sm">
                      Log
                    </Button>
                  </div>
                </div>
              )}
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity logged yet.</p>
              ) : (
                <div className="space-y-3">
                  {activities.map((a) => (
                    <div key={a.id} className="border-l-2 border-brand-200 pl-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{a.activity_type}</Badge>
                        <span className="text-xs text-muted-foreground">{formatDate(a.occurred_at)}</span>
                      </div>
                      {a.body && <p className="mt-1 text-sm">{a.body}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Marketing consent</p>
                  <p className="text-xs text-muted-foreground">
                    {contact.marketing_opt_in ? 'Opted in' : 'Not opted in — cannot be targeted by any campaign'}
                  </p>
                </div>
                <Switch
                  checked={contact.marketing_opt_in}
                  onCheckedChange={onToggleOptIn}
                  disabled={!canManage || setOptIn.isPending}
                />
              </div>
              {contact.notes && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
                  <p className="mt-1 text-sm">{contact.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
