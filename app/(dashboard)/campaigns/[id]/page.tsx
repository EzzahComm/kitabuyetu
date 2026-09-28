'use client';

import { use, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/page-header';
import { StatusPill } from '@/components/shared/status-pill';
import {
  useCampaign,
  useCampaignDonations,
  useSubmitCampaignForReview,
  useSetCampaignPayoutPhone,
} from '@/hooks/use-campaigns';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import { useHasPermission } from '@/lib/auth/use-permission';
import { CampaignWithdrawals } from './withdrawals';

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { toast } = useToast();
  const canManage = useHasPermission('campaigns.manage');
  const canManagePayouts = useHasPermission('payouts.manage');

  const { data: campaign, isLoading } = useCampaign(id);
  const { data: donations } = useCampaignDonations(id);
  const submitForReview = useSubmitCampaignForReview(id);
  const setPayoutPhone = useSetCampaignPayoutPhone(id);
  const [payoutPhoneDraft, setPayoutPhoneDraft] = useState('');

  const onSubmit = async () => {
    try {
      await submitForReview.mutateAsync();
      toast({ title: 'Submitted for review', description: 'A Kitabu Yetu admin will review it shortly.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onSavePayoutPhone = async () => {
    try {
      await setPayoutPhone.mutateAsync(payoutPhoneDraft);
      toast({ title: 'Payout phone saved' });
      setPayoutPhoneDraft('');
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
              <Button
                onClick={onSubmit}
                disabled={submitForReview.isPending || !campaign.payout_phone}
                title={campaign.payout_phone ? undefined : 'Set a payout phone number first'}
              >
                {submitForReview.isPending ? 'Submitting…' : 'Submit for review'}
              </Button>
            )}
            {campaign.status === 'active' && (
              <Button asChild variant="outline">
                <Link href={`/fundraise/${campaign.slug}`} target="_blank">
                  View public page
                </Link>
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

      {canManage && campaign.status === 'draft' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payout phone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Where withdrawn funds are sent once this campaign is live. Required before submitting for review, and can
              only be changed while still a draft.
            </p>
            <div className="flex items-center gap-2 max-w-sm">
              <Input
                placeholder={campaign.payout_phone ?? '07XXXXXXXX'}
                value={payoutPhoneDraft}
                onChange={(e) => setPayoutPhoneDraft(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={onSavePayoutPhone}
                disabled={!payoutPhoneDraft || setPayoutPhone.isPending}
              >
                {setPayoutPhone.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
            {campaign.payout_phone && (
              <p className="text-xs text-muted-foreground">Currently set: {campaign.payout_phone}</p>
            )}
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
        <CardHeader>
          <CardTitle className="text-base">Story</CardTitle>
        </CardHeader>
        <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">{campaign.story}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Donations ({donations?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!donations || donations.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">No donations yet.</p>
          ) : (
            <div className="divide-y">
              {donations.map((d) => (
                <div key={d.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">{d.is_anonymous ? 'Anonymous' : d.donor_name || d.donor_phone}</p>
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

      {canManagePayouts && (campaign.status === 'active' || campaign.status === 'completed') && (
        <CampaignWithdrawals campaignId={id} amountRaised={campaign.amount_raised} />
      )}

      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to campaigns
      </Link>
    </div>
  );
}
