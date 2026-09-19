'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { useContacts, useCreateContact } from '@/hooks/use-crm';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import { useHasPermission } from '@/lib/auth/use-permission';
import type { ContactType } from '@/lib/services/crm.service';

const CONTACT_TYPES: ContactType[] = [
  'donor', 'lender', 'insurer', 'trainer', 'service_provider',
  'professional', 'partner_rep', 'lead', 'media', 'government', 'other',
];

const EMPTY_FORM = {
  contact_type: 'lead' as ContactType, name: '', email: '', phone: '', notes: '', marketing_opt_in: false,
};

export default function CrmContactsPage() {
  const { toast } = useToast();
  const canManage = useHasPermission('crm.manage');
  const { data: contacts, isLoading } = useContacts();
  const createContact = useCreateContact();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const onCreate = async () => {
    try {
      await createContact.mutateAsync({
        contact_type: form.contact_type,
        name: form.name,
        email: form.email || undefined,
        phone: form.phone || undefined,
        notes: form.notes || undefined,
        marketing_opt_in: form.marketing_opt_in,
      });
      toast({ title: 'Contact created' });
      setForm(EMPTY_FORM);
      setOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts"
        description="Donors, lenders, insurers, trainers, professionals and other relationships outside your membership."
        actions={
          <div className="flex gap-2">
            <Link href="/crm/pipeline">
              <Button variant="outline">View pipeline</Button>
            </Link>
            {canManage && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>Add contact</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add contact</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name *</Label>
                    <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact_type">Type *</Label>
                    <Select value={form.contact_type} onValueChange={(v) => setForm((f) => ({ ...f, contact_type: v as ContactType }))}>
                      <SelectTrigger id="contact_type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CONTACT_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="phone">Phone</Label>
                      <Input id="phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea id="notes" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                  </div>
                  <div className="flex items-start gap-3 rounded-md border p-3">
                    <Switch
                      id="marketing_opt_in"
                      checked={form.marketing_opt_in}
                      onCheckedChange={(v) => setForm((f) => ({ ...f, marketing_opt_in: v }))}
                    />
                    <div className="space-y-0.5">
                      <Label htmlFor="marketing_opt_in" className="font-normal">This contact has agreed to receive marketing communications</Label>
                      <p className="text-xs text-muted-foreground">
                        Leave unchecked unless they&rsquo;ve explicitly consented — a contact can&rsquo;t be targeted by any campaign until this is on.
                      </p>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={onCreate} disabled={!form.name.trim() || createContact.isPending}>
                    {createContact.isPending ? 'Creating…' : 'Create contact'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            )}
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !contacts || contacts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No contacts yet. Add donors, partners, or leads to start tracking relationships here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {contacts.map((c) => (
            <Link key={c.id} href={`/crm/${c.id}`}>
              <Card className="hover:shadow-md transition">
                <CardContent className="flex items-center justify-between gap-3 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{c.name}</p>
                      <Badge variant="secondary">{c.contact_type.replace('_', ' ')}</Badge>
                      {c.marketing_opt_in && <Badge variant="outline">Opted in</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details on file'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
