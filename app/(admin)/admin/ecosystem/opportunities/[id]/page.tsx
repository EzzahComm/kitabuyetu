'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { EligibilityRulesEditor } from '@/components/ecosystem/eligibility-rules-editor';
import {
  useOpportunity, useUpdateOpportunity, usePublishOpportunity, useCloseOpportunity,
} from '@/hooks/use-admin-ecosystem';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import type { EligibilityRule, Opportunity } from '@/lib/services/ecosystem.service';

const STATUS_VARIANT: Record<Opportunity['status'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline', published: 'default', closed: 'secondary', archived: 'destructive',
};

export default function AdminOpportunityDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data: opportunity, isLoading } = useOpportunity(params.id);
  const updateOpportunity = useUpdateOpportunity(params.id);
  const publish = usePublishOpportunity();
  const close = useCloseOpportunity();

  const [seededId, setSeededId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '', description: '', category: '', amount_min: '', amount_max: '', terms_summary: '', application_url: '',
  });
  const [rules, setRules] = useState<EligibilityRule[]>([]);
  // Seeded during render (not a useEffect) the moment the opportunity first
  // arrives — same pattern used for the HR employee detail page, avoiding a
  // setState-in-effect cascading-render lint error.
  if (opportunity && opportunity.id !== seededId) {
    setSeededId(opportunity.id);
    setForm({
      title: opportunity.title,
      description: opportunity.description,
      category: opportunity.category ?? '',
      amount_min: opportunity.amount_min != null ? String(opportunity.amount_min) : '',
      amount_max: opportunity.amount_max != null ? String(opportunity.amount_max) : '',
      terms_summary: opportunity.terms_summary ?? '',
      application_url: opportunity.application_url ?? '',
    });
    setRules(opportunity.eligibility_rules?.rules ?? []);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!opportunity) return <p className="text-sm text-muted-foreground">Opportunity not found.</p>;

  const onSave = async () => {
    try {
      await updateOpportunity.mutateAsync({
        title: form.title,
        description: form.description,
        category: form.category || undefined,
        amount_min: form.amount_min ? Number(form.amount_min) : undefined,
        amount_max: form.amount_max ? Number(form.amount_max) : undefined,
        terms_summary: form.terms_summary || undefined,
        application_url: form.application_url || undefined,
        eligibility_rules: { rules },
      });
      toast({ title: 'Opportunity updated' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onPublish = async () => {
    try {
      await publish.mutateAsync(opportunity.id);
      toast({ title: 'Opportunity published' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onClose = async () => {
    try {
      await close.mutateAsync(opportunity.id);
      toast({ title: 'Opportunity closed' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-5">
      <Link href="/admin/ecosystem/opportunities" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All opportunities
      </Link>

      <PageHeader
        title={opportunity.title}
        description={opportunity.opportunity_type}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[opportunity.status]}>{opportunity.status}</Badge>
            {opportunity.status === 'draft' && (
              <Button size="sm" onClick={onPublish} disabled={publish.isPending}>Publish</Button>
            )}
            {opportunity.status === 'published' && (
              <Button size="sm" variant="outline" onClick={onClose} disabled={close.isPending}>Close</Button>
            )}
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Input id="category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="application_url">External application URL</Label>
              <Input id="application_url" value={form.application_url} onChange={(e) => setForm((f) => ({ ...f, application_url: e.target.value }))} placeholder="Leave blank for the in-app form" />
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

          <EligibilityRulesEditor value={rules} onChange={setRules} />

          <Button onClick={onSave} disabled={updateOpportunity.isPending}>
            {updateOpportunity.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
