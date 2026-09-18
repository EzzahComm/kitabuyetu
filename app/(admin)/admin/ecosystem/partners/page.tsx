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
import { usePartners, useCreatePartner } from '@/hooks/use-admin-ecosystem';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import type { Partner } from '@/lib/services/ecosystem.service';

const PARTNER_TYPES: Partner['type'][] = ['donor', 'lender', 'insurer', 'trainer', 'service_provider', 'investor'];

const EMPTY_FORM = {
  name: '', type: 'lender' as Partner['type'], description: '',
  logo_url: '', website_url: '', contact_email: '', contact_phone: '',
};

export default function AdminEcosystemPartnersPage() {
  const { toast } = useToast();
  const { data: partners, isLoading } = usePartners();
  const create = useCreatePartner();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const onCreate = async () => {
    try {
      await create.mutateAsync({
        name: form.name,
        type: form.type,
        description: form.description || undefined,
        logo_url: form.logo_url || undefined,
        website_url: form.website_url || undefined,
        contact_email: form.contact_email || undefined,
        contact_phone: form.contact_phone || undefined,
      });
      toast({ title: 'Partner created' });
      setForm(EMPTY_FORM);
      setOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ecosystem partners"
        description="Donors, lenders, insurers, trainers, service providers and investors offering opportunities on the marketplace."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>Add partner</Button>
            </DialogTrigger>
            <DialogContent>
            <DialogHeader>
              <DialogTitle>Add partner</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type">Type *</Label>
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as Partner['type'] }))}>
                  <SelectTrigger id="type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PARTNER_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="website_url">Website</Label>
                <Input id="website_url" value={form.website_url} onChange={(e) => setForm((f) => ({ ...f, website_url: e.target.value }))} placeholder="https://…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="contact_email">Contact email</Label>
                  <Input id="contact_email" type="email" value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contact_phone">Contact phone</Label>
                  <Input id="contact_phone" value={form.contact_phone} onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))} />
                </div>
              </div>
            </div>
              <DialogFooter>
                <Button onClick={onCreate} disabled={!form.name.trim() || create.isPending}>
                  {create.isPending ? 'Creating…' : 'Create partner'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !partners || partners.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No partners yet. Add one to start building the marketplace.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {partners.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{p.name}</p>
                    <Badge variant="secondary">{p.type.replace('_', ' ')}</Badge>
                    {!p.is_active && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  {p.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
