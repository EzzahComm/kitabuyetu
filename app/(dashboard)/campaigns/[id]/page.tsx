'use client';

import { use } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { StatusPill } from '@/components/shared/status-pill';
import { useCampaign, useCampaignDonations, useSubmitCampaignForReview } from '@/hooks/use-campaigns';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import { useHasPermission } from '@/lib/auth/use-permission';

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { toast } = useToast();
  const canManage = useHasPermission('campaigns.manage');

  const { data: campaign, isLoading } = useCampaign(id);
  const { data: donations } = useCampaignDonations(id);
  const submitForReview = useSubmitCampaignForReview(id);

  const onSubmit = async () => {
    try {
      await submitForReview.mutateAsync();
      toast({ title: 'Submitted for review', description: 'A Kitabu Yetu admin will review it shortly.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  if (isLoading || !campaign) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const progressPct = Math.min(
    100,
    Math.round((parseFloat(campaign.amount_raised) / parseFloat(campaign.target_amount)) * 100),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={campaign.title}
        breadcrumbs={[{ label: 'Campaigns', href: '/campaigns' }, { label: campaign.title }]}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill status={campaign.status} />
            {canManage && campaign.status === 'draft' && (
              <Button onClick={onSubmit} disabled={submitForReview.isPending}>
                {submitForReview.isPending ? 'Submitting…' : 'Submit for review'}
              </Button>
            )}
            {campaign.status === 'active' && (
              <Button asChild variant="outline">
                <Link href={`/fundraise/${campaign.slug}`} target="_blank">View public page</Link>
              </Button>
            )}
          </div>
        }
      />

      {campaign.status === 'rejected' && campaign.rejection_reason && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm">
            <p className="font-semibold text-destructive">Rejected</p>
            <p className="mt-1 text-muted-foreground">{campaign.rejection_reason}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground">Raised</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatKES(campaign.amount_raised)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground">Target</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatKES(campaign.target_amount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground">Progress</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{progressPct}%</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Story</CardTitle></CardHeader>
        <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">{campaign.story}</CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Donations ({donations?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!donations || donations.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">No donations yet.</p>
          ) : (
            <div className="divide-y">
              {donations.map((d) => (
                <div key={d.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">{d.is_anonymous ? 'Anonymous' : (d.donor_name || d.donor_phone)}</p>
                    {d.message && <p className="text-xs text-muted-foreground">&ldquo;{d.message}&rdquo;</p>}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{formatKES(d.amount)}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(d.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to campaigns
      </Link>
    </div>
  );
}
