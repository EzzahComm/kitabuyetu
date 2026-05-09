'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useEmailCampaigns, useCreateCampaign, useCampaignAction } from '@/hooks/use-email';
import { Plus, Play, X, Users, Mail, CheckCircle, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  sending:   'bg-yellow-100 text-yellow-700',
  sent:      'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function EmailCampaignsPage() {
  const { data, isLoading } = useEmailCampaigns();
  const createMutation      = useCreateCampaign();
  const actionMutation      = useCampaignAction();
  const { toast }           = useToast();
  const [open, setOpen]     = useState(false);

  const [name, setName]       = useState('');
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtml]   = useState('');

  const campaigns = data ?? [];

  async function handleCreate(launch: boolean) {
    await createMutation.mutateAsync({ name, subject, htmlBody, launch });
    toast({ title: launch ? 'Campaign launched' : 'Campaign created' });
    setOpen(false);
    setName(''); setSubject(''); setHtml('');
  }

  async function handleLaunch(id: string) {
    await actionMutation.mutateAsync({ id, action: 'launch' });
    toast({ title: 'Campaign launched' });
  }

  async function handleCancel(id: string) {
    await actionMutation.mutateAsync({ id, action: 'cancel' });
    toast({ title: 'Campaign cancelled' });
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Email Campaigns</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />New Campaign</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Create Campaign</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Campaign Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. January Announcement" />
              </div>
              <div>
                <Label>Email Subject</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" />
              </div>
              <div>
                <Label>HTML Body</Label>
                <Textarea value={htmlBody} onChange={(e) => setHtml(e.target.value)} rows={10} placeholder="<p>Dear member...</p>" className="font-mono text-sm" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => handleCreate(false)} disabled={!name || !subject}>
                  Save as Draft
                </Button>
                <Button className="flex-1" onClick={() => handleCreate(true)} disabled={!name || !subject || !htmlBody}>
                  <Play className="h-4 w-4 mr-2" />Launch Now
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
          : campaigns.map((c) => (
              <Card key={c.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">{c.name}</span>
                        <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${STATUS_COLORS[c.status] ?? ''}`}>
                          {c.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">{c.subject}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{c.total_recipients ?? 0} recipients</span>
                        <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{c.sent_count} sent</span>
                        <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3 text-purple-500" />{c.opened_count} opened</span>
                        {c.failed_count > 0 && (
                          <span className="flex items-center gap-1 text-red-500"><AlertTriangle className="h-3 w-3" />{c.failed_count} failed</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {c.status === 'draft' && (
                        <Button size="sm" onClick={() => handleLaunch(c.id)} disabled={actionMutation.isPending}>
                          <Play className="h-3 w-3 mr-1" />Launch
                        </Button>
                      )}
                      {['draft','scheduled'].includes(c.status) && (
                        <Button size="sm" variant="outline" onClick={() => handleCancel(c.id)} disabled={actionMutation.isPending}>
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
        {!isLoading && campaigns.length === 0 && (
          <div className="text-center py-12 text-gray-500">No campaigns yet. Create your first campaign above.</div>
        )}
      </div>
    </div>
  );
}
