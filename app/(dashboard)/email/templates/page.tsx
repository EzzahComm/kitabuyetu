'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { useEmailTemplates, useCreateTemplate, useUpdateTemplate, type EmailTemplate } from '@/hooks/use-email';
import { Plus, Edit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

function TemplateForm({
  initial,
  onSave,
}: {
  initial?: Partial<EmailTemplate & { body: string }>;
  onSave: (data: { templateKey: string; name: string; subject: string; body: string }) => void;
}) {
  const [templateKey, setTemplateKey] = useState(initial?.template_key ?? '');
  const [name, setName]               = useState(initial?.name ?? '');
  const [subject, setSubject]         = useState(initial?.subject ?? '');
  const [body, setBody]               = useState(initial?.body ?? '');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label>Template Key</Label>
          <Input value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} placeholder="e.g. welcome" disabled={!!initial?.id} />
        </div>
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
        </div>
      </div>
      <div>
        <Label>Subject</Label>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject — use {{variable}}" />
      </div>
      <div>
        <Label>HTML Body</Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          placeholder="<p>Dear {{memberName}},</p>"
          className="font-mono text-sm"
        />
        <p className="text-xs text-gray-500 mt-1">Use {'{{variable}}'} for interpolation.</p>
      </div>
      <Button
        className="w-full"
        onClick={() => onSave({ templateKey, name, subject, body })}
        disabled={!templateKey || !name || !subject || !body}
      >
        Save Template
      </Button>
    </div>
  );
}

export default function EmailTemplatesPage() {
  const { data, isLoading } = useEmailTemplates();
  const createMutation      = useCreateTemplate();
  const updateMutation      = useUpdateTemplate();
  const { toast }           = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const templates = data ?? [];

  async function handleCreate(d: { templateKey: string; name: string; subject: string; body: string }) {
    await createMutation.mutateAsync(d);
    toast({ title: 'Template saved' });
    setCreateOpen(false);
  }

  async function handleToggle(tpl: EmailTemplate) {
    await updateMutation.mutateAsync({ id: tpl.id, isActive: !tpl.is_active });
    toast({ title: tpl.is_active ? 'Template disabled' : 'Template enabled' });
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="Email Templates"
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />New Template</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Create Email Template</DialogTitle></DialogHeader>
              <TemplateForm onSave={handleCreate} />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-4">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          : templates.map((tpl) => (
              <Card key={tpl.id}>
                <CardContent className="py-3 px-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm">{tpl.name}</span>
                      <Badge variant="outline" className="text-xs">{tpl.template_key}</Badge>
                      {!tpl.group_id && <Badge variant="secondary" className="text-xs">Global</Badge>}
                      {!tpl.is_active && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{tpl.subject}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggle(tpl)}
                      disabled={!tpl.group_id}
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      {tpl.is_active ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>
    </div>
  );
}
