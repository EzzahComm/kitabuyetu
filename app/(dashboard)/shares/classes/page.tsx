'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Layers, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/page-header';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';

interface ShareClass {
  id: string; name: string; code: string; description: string | null;
  par_value: string; current_value: string | null;
  min_per_member: number | null; max_per_member: number | null;
  voting_weight: string; transfer_allowed: boolean; lock_period_days: number;
  is_active: boolean;
}

const fmtMoney = (v: string | number | null | undefined) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(v ?? 0));

const schema = z.object({
  name:             z.string().min(2),
  code:             z.string().min(1).max(20).regex(/^[A-Z0-9_-]+$/i, 'Alphanumeric, -_ allowed'),
  description:      z.string().max(1000).optional().or(z.literal('')),
  parValue:         z.coerce.number().positive(),
  currentValue:     z.coerce.number().nonnegative().optional().or(z.literal('')),
  minPerMember:     z.coerce.number().int().nonnegative().optional().or(z.literal('')),
  maxPerMember:     z.coerce.number().int().positive().optional().or(z.literal('')),
  votingWeight:     z.coerce.number().nonnegative().default(1),
  transferAllowed:  z.coerce.boolean().default(true),
  lockPeriodDays:   z.coerce.number().int().nonnegative().default(0),
});
type FormValues = z.infer<typeof schema>;

export default function ShareClassesPage() {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const [open, setOpen]       = useState(false);
  const [editing, setEditing] = useState<ShareClass | null>(null);

  const classesQ = useQuery<{ items: ShareClass[] }>({
    queryKey: ['share-classes', 'all'],
    queryFn:  () => api.get<{ items: ShareClass[] }>('/share-classes'),
  });
  const classes = classesQ.data?.items ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { votingWeight: 1, transferAllowed: true, lockPeriodDays: 0 },
  });

  const openCreate = () => { setEditing(null); reset({ votingWeight: 1, transferAllowed: true, lockPeriodDays: 0 }); setOpen(true); };
  const openEdit   = (c: ShareClass) => {
    setEditing(c);
    reset({
      name: c.name, code: c.code, description: c.description ?? '',
      parValue: Number(c.par_value),
      currentValue: c.current_value ? Number(c.current_value) : ('' as unknown as number),
      minPerMember: c.min_per_member ?? ('' as unknown as number),
      maxPerMember: c.max_per_member ?? ('' as unknown as number),
      votingWeight: Number(c.voting_weight),
      transferAllowed: c.transfer_allowed,
      lockPeriodDays: c.lock_period_days,
    });
    setOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    try {
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v === '' || v === undefined) continue;
        body[k] = v;
      }
      if (editing) {
        await api.patch(`/share-classes/${editing.id}`, body);
        toast({ title: 'Class updated' });
      } else {
        await api.post('/share-classes', body);
        toast({ title: 'Class created' });
      }
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['share-classes'] });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Save failed';
      toast({ variant: 'destructive', title: 'Failed', description: msg });
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link href="/shares" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <PageHeader
          title="Share Classes"
          description="Define the price, limits, and rules for each class of shares."
          actions={<Button onClick={openCreate}><Plus size={16} className="mr-2" /> New class</Button>}
          className="flex-1"
        />
      </div>

      {classesQ.isLoading ? (
        <Card><CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin" />
        </CardContent></Card>
      ) : classes.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Layers className="h-10 w-10 text-muted-foreground" />
          <p className="font-medium">No share classes yet</p>
          <p className="max-w-md text-sm text-muted-foreground">Create your first class — e.g. <em>Ordinary Shares</em> at KES 100 par value with a 30-day lock period.</p>
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3 text-right">Par value</th>
                  <th className="px-4 py-3 text-right">Current value</th>
                  <th className="px-4 py-3 text-right">Per-member cap</th>
                  <th className="px-4 py-3 text-right">Voting</th>
                  <th className="px-4 py-3 text-right">Lock days</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.id} className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30" onClick={() => openEdit(c)}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{c.name}</p>
                      {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                    </td>
                    <td className="px-4 py-3"><Badge variant="outline">{c.code}</Badge></td>
                    <td className="px-4 py-3 text-right font-mono">{fmtMoney(c.par_value)}</td>
                    <td className="px-4 py-3 text-right font-mono">{c.current_value ? fmtMoney(c.current_value) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono">{c.min_per_member ?? 0}–{c.max_per_member ?? '∞'}</td>
                    <td className="px-4 py-3 text-right font-mono">{c.voting_weight}</td>
                    <td className="px-4 py-3 text-right font-mono">{c.lock_period_days}</td>
                    <td className="px-4 py-3">
                      <Badge variant={c.is_active ? 'success' : 'secondary'}>{c.is_active ? 'active' : 'inactive'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); setOpen(v); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New share class'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="name">Name</Label>
                <Input id="name" placeholder="Ordinary Shares" {...register('name')} />
                {errors.name && <p className="text-xs text-red-600">{errors.name.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="code">Code</Label>
                <Input id="code" placeholder="ORD" {...register('code')} />
                {errors.code && <p className="text-xs text-red-600">{errors.code.message}</p>}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="description">Description</Label>
              <Input id="description" placeholder="Optional" {...register('description')} />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="parValue">Par value</Label>
                <Input id="parValue" type="number" step={0.01} placeholder="100.00" {...register('parValue')} />
                {errors.parValue && <p className="text-xs text-red-600">{errors.parValue.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="currentValue">Current value (optional)</Label>
                <Input id="currentValue" type="number" step={0.01} placeholder="Defaults to par value" {...register('currentValue')} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="minPerMember">Min / member</Label>
                <Input id="minPerMember" type="number" step={1} placeholder="0" {...register('minPerMember')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="maxPerMember">Max / member</Label>
                <Input id="maxPerMember" type="number" step={1} placeholder="∞" {...register('maxPerMember')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lockPeriodDays">Lock period (days)</Label>
                <Input id="lockPeriodDays" type="number" step={1} {...register('lockPeriodDays')} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="votingWeight">Voting weight</Label>
                <Input id="votingWeight" type="number" step={0.0001} {...register('votingWeight')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="transferAllowed">Transfers allowed</Label>
                <select id="transferAllowed" {...register('transferAllowed')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editing ? 'Save changes' : 'Create class'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
