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
  useOpportunities, useCreateOpportunity, usePublishOpportunity, useCloseOpportunity,
} from '@/hooks/use-admin-ecosystem';
import { usePartners } from '@/hooks/use-admin-ecosystem';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage, formatDate } from '@/lib/utils';
import type { Opportunity } from '@/lib/services/ecosystem.service';

const OPPORTUNITY_TYPES: Opportunity['opportunity_type'][] = ['grant', 'loan', 'insurance', 'training', 'service'];

const STATUS_VARIANT: Record<Opportunity['status'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  published: 'default',
  closed: 'secondary',
  archived: 'destructive',
};

const EMPTY_FORM = {
  partner_id: '', title: '', description: '', opportunity_type: 'grant' as Opportunity['opportunity_type'],
  category: '', amount_min: '', amount_max: '', currency: 'KES', terms_summary: '', application_url: '', featured: false,
};

export default function AdminEcosystemOpportunitiesPage() {
  const { toast } = useToast();
  const { data: opportunities, isLoading } = useOpportunities();
  const { data: partners } = usePartners();
  const create = useCreateOpportunity();
  const publish = usePublishOpportunity();
  const close = useCloseOpportunity();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const onCreate = async () => {
    try {
      await create.mutateAsync({
        partner_id: form.partner_id,
        title: form.title,
        description: form.description,
        opportunity_type: form.opportunity_type,
        category: form.category || undefined,
        amount_min: form.amount_min ? Number(form.amount_min) : undefined,
        amount_max: form.amount_max ? Number(form.amount_max) : undefined,
        currency: form.currency,
        terms_summary: form.terms_summary || undefined,
        eligibility_rules: { rules: [] },
        application_url: form.application_url || undefined,
        featured: form.featured,
      });
      toast({ title: 'Opportunity created', description: 'It is saved as a draft — publish it to make it visible.' });
      setForm(EMPTY_FORM);
      setOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onPublish = async (id: string) => {
    try {
      await publish.mutateAsync(id);
      toast({ title: 'Opportunity published' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onClose = async (id: string) => {
    try {
      await close.mutateAsync(id);
      toast({ title: 'Opportunity closed' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketplace opportunities"
        description="Grants, loans, insurance, training and services from partners. Drafts stay hidden until published."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button disabled={!partners || partners.length === 0}>Create opportunity</Button>
            </DialogTrigger>
            <DialogContent>
            <DialogHeader>
              <DialogTitle>Create opportunity</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="partner">Partner *</Label>
                <Select value={form.partner_id} onValueChange={(v) => setForm((f) => ({ ...f, partner_id: v }))}>
                  <SelectTrigger id="partner"><SelectValue placeholder="Select a partner" /></SelectTrigger>
                  <SelectContent>
                    {(partners || []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="title">Title *</Label>
                <Input id="title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description *</Label>
                <Textarea id="description" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="opportunity_type">Type *</Label>
                  <Select value={form.opportunity_type} onValueChange={(v) => setForm((f) => ({ ...f, opportunity_type: v as Opportunity['opportunity_type'] }))}>
                    <SelectTrigger id="opportunity_type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OPPORTUNITY_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="category">Category</Label>
                  <Input id="category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="amount_min">Min amount (KES)</Label>
                  <Input id="amount_min" type="number" value={form.amount_min} onChange={(e) => setForm((f) => ({ ...f, amount_min: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="amount_max">Max amount (KES)</Label>
                  <Input id="amount_max" type="number" value={form.amount_max} onChange={(e) => setForm((f) => ({ ...f, amount_max: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="terms_summary">Terms summary</Label>
                <Textarea id="terms_summary" rows={2} value={form.terms_summary} onChange={(e) => setForm((f) => ({ ...f, terms_summary: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="application_url">External application URL (optional)</Label>
                <Input id="application_url" value={form.application_url} onChange={(e) => setForm((f) => ({ ...f, application_url: e.target.value }))} placeholder="Leave blank to use the in-app application form" />
              </div>
            </div>
              <DialogFooter>
                <Button
                  onClick={onCreate}
                  disabled={!form.partner_id || !form.title.trim() || !form.description.trim() || create.isPending}
                >
                  {create.isPending ? 'Creating…' : 'Create draft'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !opportunities || opportunities.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No opportunities yet. Add a partner first, then create one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {opportunities.map((o) => (
            <Card key={o.id}>
              <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{o.title}</p>
                    <Badge variant={STATUS_VARIANT[o.status]}>{o.status}</Badge>
                    <Badge variant="outline">{o.opportunity_type}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{o.description}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Created {formatDate(o.created_at)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {o.status === 'draft' && (
                    <Button size="sm" onClick={() => onPublish(o.id)} disabled={publish.isPending}>
                      Publish
                    </Button>
                  )}
                  {o.status === 'published' && (
                    <Button size="sm" variant="outline" onClick={() => onClose(o.id)} disabled={close.isPending}>
                      Close
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
