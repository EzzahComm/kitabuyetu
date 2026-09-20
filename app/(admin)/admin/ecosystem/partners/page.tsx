'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { usePartners, useCreatePartner, useUpdatePartner } from '@/hooks/use-admin-ecosystem';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import type { Partner } from '@/lib/services/ecosystem.service';

const PARTNER_TYPES: Partner['type'][] = ['donor', 'lender', 'insurer', 'trainer', 'service_provider', 'investor'];

const EMPTY_FORM = {
  name: '',
  type: 'lender' as Partner['type'],
  description: '',
  logo_url: '',
  website_url: '',
  contact_email: '',
  contact_phone: '',
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
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="type">Type *</Label>
                  <Select
                    value={form.type}
                    onValueChange={(v) => setForm((f) => ({ ...f, type: v as Partner['type'] }))}
                  >
                    <SelectTrigger id="type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PARTNER_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t.replace('_', ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="website_url">Website</Label>
                  <Input
                    id="website_url"
                    value={form.website_url}
                    onChange={(e) => setForm((f) => ({ ...f, website_url: e.target.value }))}
                    placeholder="https://…"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="contact_email">Contact email</Label>
                    <Input
                      id="contact_email"
                      type="email"
                      value={form.contact_email}
                      onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact_phone">Contact phone</Label>
                    <Input
                      id="contact_phone"
                      value={form.contact_phone}
                      onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
                    />
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
            <PartnerCard key={p.id} partner={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function PartnerCard({ partner }: { partner: Partner }) {
  const { toast } = useToast();
  const update = useUpdatePartner(partner.id);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({
    name: partner.name,
    type: partner.type,
    description: partner.description ?? '',
    website_url: partner.website_url ?? '',
    contact_email: partner.contact_email ?? '',
    contact_phone: partner.contact_phone ?? '',
  });

  const onToggleActive = async (isActive: boolean) => {
    try {
      await update.mutateAsync({ is_active: isActive });
      toast({ title: isActive ? 'Partner activated' : 'Partner deactivated' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onSave = async () => {
    try {
      await update.mutateAsync({
        name: form.name,
        type: form.type,
        description: form.description || undefined,
        website_url: form.website_url || undefined,
        contact_email: form.contact_email || undefined,
        contact_phone: form.contact_phone || undefined,
      });
      toast({ title: 'Partner updated' });
      setEditOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold">{partner.name}</p>
            <Badge variant="secondary">{partner.type.replace('_', ' ')}</Badge>
            {!partner.is_active && <Badge variant="outline">Inactive</Badge>}
          </div>
          {partner.description && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{partner.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch checked={partner.is_active} onCheckedChange={onToggleActive} disabled={update.isPending} />
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Edit
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit {partner.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`name-${partner.id}`}>Name *</Label>
                  <Input
                    id={`name-${partner.id}`}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`type-${partner.id}`}>Type *</Label>
                  <Select
                    value={form.type}
                    onValueChange={(v) => setForm((f) => ({ ...f, type: v as Partner['type'] }))}
                  >
                    <SelectTrigger id={`type-${partner.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        ['donor', 'lender', 'insurer', 'trainer', 'service_provider', 'investor'] as Partner['type'][]
                      ).map((t) => (
                        <SelectItem key={t} value={t}>
                          {t.replace('_', ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`description-${partner.id}`}>Description</Label>
                  <Textarea
                    id={`description-${partner.id}`}
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`website-${partner.id}`}>Website</Label>
                  <Input
                    id={`website-${partner.id}`}
                    value={form.website_url}
                    onChange={(e) => setForm((f) => ({ ...f, website_url: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`email-${partner.id}`}>Contact email</Label>
                    <Input
                      id={`email-${partner.id}`}
                      type="email"
                      value={form.contact_email}
                      onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`phone-${partner.id}`}>Contact phone</Label>
                    <Input
                      id={`phone-${partner.id}`}
                      value={form.contact_phone}
                      onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={onSave} disabled={!form.name.trim() || update.isPending}>
                  {update.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
