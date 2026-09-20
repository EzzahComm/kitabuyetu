'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import { StatusPill } from '@/components/shared/status-pill';
import { useCampaigns, useCreateCampaign } from '@/hooks/use-campaigns';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { formatKES, getErrorMessage } from '@/lib/utils';
import { useHasPermission } from '@/lib/auth/use-permission';

const createSchema = z.object({
  title: z.string().min(3).max(120),
  story: z.string().min(20).max(10_000),
  targetAmount: z.coerce.number().positive(),
  beneficiaryName: z.string().optional(),
});

type CreateCampaignForm = z.infer<typeof createSchema>;

export default function CampaignsPage() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const canManage = useHasPermission('campaigns.manage');

  const { data: campaigns, isLoading } = useCampaigns();
  const createCampaign = useCreateCampaign();

  const form = useForm<CreateCampaignForm>({ resolver: zodResolver(createSchema) });

  const onSubmit = async (values: CreateCampaignForm) => {
    try {
      const campaign = await createCampaign.mutateAsync(values);
      toast({
        title: 'Campaign created as a draft',
        description: 'Submit it for review when you’re ready to go live.',
      });
      setOpen(false);
      form.reset();
      router.push(`/campaigns/${campaign.id}`);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Changi$ha campaigns"
        description="Raise funds for a cause. New campaigns go live once a Kitabu Yetu admin reviews them."
        actions={
          canManage && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New campaign
            </Button>
          )
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !campaigns || campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-base font-semibold">No campaigns yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Create your group&apos;s first Changi$ha campaign to start raising funds for a cause. It goes live once
              approved.
            </p>
            {canManage && (
              <Button onClick={() => setOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> New campaign
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => (
            <Link key={c.id} href={`/campaigns/${c.id}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="flex flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold leading-snug">{c.title}</p>
                    <StatusPill status={c.status} size="sm" />
                  </div>
                  <div>
                    <p className="text-lg font-bold tabular-nums">{formatKES(c.amount_raised)}</p>
                    <p className="text-xs text-muted-foreground">raised of {formatKES(c.target_amount)} target</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" {...form.register('title')} placeholder="e.g. Clean water for Kianjege" />
              {form.formState.errors.title && (
                <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="story">Story</Label>
              <Textarea
                id="story"
                rows={5}
                {...form.register('story')}
                placeholder="What is this campaign for, and why does it matter?"
              />
              {form.formState.errors.story && (
                <p className="text-xs text-destructive">{form.formState.errors.story.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="targetAmount">Target amount (KES)</Label>
              <Input id="targetAmount" type="number" step="0.01" {...form.register('targetAmount')} />
              {form.formState.errors.targetAmount && (
                <p className="text-xs text-destructive">{form.formState.errors.targetAmount.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="beneficiaryName">Beneficiary (optional)</Label>
              <Input
                id="beneficiaryName"
                {...form.register('beneficiaryName')}
                placeholder="Who benefits from this campaign?"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createCampaign.isPending}>
                {createCampaign.isPending ? 'Creating…' : 'Create draft'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
