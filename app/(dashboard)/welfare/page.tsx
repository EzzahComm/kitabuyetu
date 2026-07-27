'use client';

import { useState } from 'react';
import { Plus, Heart, Wallet, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { useWelfareRequests, useCreateWelfareRequest, useReviewWelfareRequest, useWelfarePool, useRecordWelfarePoolContribution, type WelfareRequestRow } from '@/hooks/use-welfare';
import { useMembers } from '@/hooks/use-members';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';

const requestSchema = z.object({
  requestType:     z.enum(['funeral','hospital','emergency','education','maternity','bereavement','disability','other']),
  title:           z.string().min(5),
  description:     z.string().optional(),
  amountRequested: z.coerce.number().positive(),
  priority:        z.enum(['low','normal','high','urgent']).default('normal'),
});

type WelfareRequestForm = z.infer<typeof requestSchema>;

const poolSchema = z.object({
  memberId:         z.string().min(1, 'Member required'),
  amount:           z.coerce.number().positive(),
  contributionType: z.enum(['regular','emergency_levy','special','bereavement_levy']).default('regular'),
  paymentMethod:    z.enum(['mpesa','cash','bank_transfer']).optional(),
  notes:            z.string().optional(),
});

type WelfarePoolForm = z.infer<typeof poolSchema>;

const statusVariant: Record<string, 'warning' | 'secondary' | 'success' | 'default' | 'destructive'> = {
  pending:      'warning',
  under_review: 'secondary',
  approved:     'success',
  disbursed:    'default',
  rejected:     'destructive',
  cancelled:    'secondary',
};

const priorityClass: Record<string, string> = {
  urgent: 'text-red-600 font-semibold',
  high:   'text-orange-500 font-medium',
  normal: 'text-gray-700',
  low:    'text-gray-400',
};

export default function WelfarePage() {
  const [tab, setTab]               = useState('requests');
  const [page, setPage]             = useState(1);
  const [statusFilter, setStatus]   = useState('all');
  const [openRequest, setOpenRequest] = useState(false);
  const [openPool, setOpenPool]     = useState(false);
  const [reviewId, setReviewId]     = useState<string | null>(null);
  const { toast } = useToast();

  const { data, isLoading }   = useWelfareRequests({
    page, limit: 20,
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
  });
  const { data: poolData }    = useWelfarePool();
  const { data: membersData } = useMembers({ pageSize: 200 });

  const createReq = useCreateWelfareRequest();
  const recordPool = useRecordWelfarePoolContribution();
  const reviewReq  = useReviewWelfareRequest(reviewId ?? '');

  const reqForm = useForm<WelfareRequestForm>({
    resolver: zodResolver(requestSchema),
    defaultValues: { requestType: 'emergency', priority: 'normal' },
  });
  const poolForm = useForm<WelfarePoolForm>({
    resolver: zodResolver(poolSchema),
    defaultValues: { contributionType: 'regular' },
  });

  const onSubmitRequest = async (values: WelfareRequestForm) => {
    try {
      await createReq.mutateAsync(values);
      toast({ title: 'Welfare request submitted' });
      setOpenRequest(false); reqForm.reset();
    } catch (e) { toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) }); }
  };

  const onSubmitPool = async (values: WelfarePoolForm) => {
    try {
      await recordPool.mutateAsync(values);
      toast({ title: 'Welfare fund contribution recorded' });
      setOpenPool(false); poolForm.reset();
    } catch (e) { toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) }); }
  };

  const onApprove = async (id: string, amountApproved: number) => {
    try {
      await reviewReq.mutateAsync({ action: 'approve', amountApproved });
      toast({ title: 'Request approved' });
      setReviewId(null);
    } catch (e) { toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) }); }
  };

  const summary = poolData?.summary;

  const columns = [
    {
      key: 'title', header: 'Request',
      render: (row: WelfareRequestRow) => (
        <div>
          <p className="font-medium text-sm">{row.title}</p>
          <p className="text-xs text-muted-foreground capitalize">{row.request_type?.replace('_',' ')}</p>
        </div>
      ),
    },
    { key: 'member', header: 'Member', render: (row: WelfareRequestRow) => <span className="text-sm">{row.member_name}</span> },
    {
      key: 'amount', header: 'Requested',
      render: (row: WelfareRequestRow) => (
        <div className="text-right">
          <p className="font-semibold text-sm">{formatKES(row.amount_requested)}</p>
          {row.amount_approved && <p className="text-xs text-green-600">Approved: {formatKES(row.amount_approved)}</p>}
        </div>
      ),
    },
    {
      key: 'priority', header: 'Priority',
      render: (row: WelfareRequestRow) => (
        <span className={`text-xs capitalize ${priorityClass[row.priority] ?? ''}`}>{row.priority}</span>
      ),
    },
    { key: 'status', header: 'Status', render: (row: WelfareRequestRow) => <Badge variant={statusVariant[row.status] ?? 'secondary'} className="capitalize">{row.status?.replace('_',' ')}</Badge> },
    { key: 'created_at', header: 'Date', render: (row: WelfareRequestRow) => <span className="text-xs">{formatDate(row.created_at)}</span> },
    {
      key: 'actions', header: '',
      render: (row: WelfareRequestRow) => row.status === 'pending' ? (
        <Button size="sm" variant="outline" onClick={() => { setReviewId(row.id); }}>Review</Button>
      ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Welfare"
        description="Community welfare fund and member support"
        actions={
          <>
            <Button variant="outline" onClick={() => setOpenPool(true)}>
              <Wallet size={16} className="mr-2" /> Record Fund Contribution
            </Button>
            <Button onClick={() => setOpenRequest(true)}>
              <Plus size={16} className="mr-2" /> Submit Request
            </Button>
          </>
        }
      />

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fund Balance</p>
            <p className="text-2xl font-bold mt-1 text-green-600">{formatKES(summary?.balance ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">Collected: {formatKES(summary?.totalCollected ?? 0)}</p>
          </CardContent>
        </Card>
        <StatCard title="Total Disbursed" value={formatKES(summary?.totalDisbursed ?? 0)} />
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pending Requests</p>
            <p className="text-2xl font-bold mt-1 text-yellow-600">{summary?.pendingCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Approved (Pending Disbursement)</p>
            <p className="text-2xl font-bold mt-1 text-blue-600">{summary?.approvedCount ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter tabs */}
      <Tabs value={statusFilter} onValueChange={(v) => { setStatus(v); setPage(1); }}>
        <TabsList>
          {['all','pending','approved','disbursed','rejected'].map((s) => (
            <TabsTrigger key={s} value={s} className="capitalize">{s}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={statusFilter} className="mt-4">
          <PaginatedTable
            data={data}
            isLoading={isLoading}
            columns={columns}
            onPageChange={setPage}
            emptyMessage="No welfare requests found"
          />
        </TabsContent>
      </Tabs>

      {/* Submit request dialog */}
      <Dialog open={openRequest} onOpenChange={setOpenRequest}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Submit Welfare Request</DialogTitle></DialogHeader>
          <form onSubmit={reqForm.handleSubmit(onSubmitRequest)} className="space-y-4">
            <div className="space-y-1">
              <Label>Request Type</Label>
              <select {...reqForm.register('requestType')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {['funeral','hospital','emergency','education','maternity','bereavement','disability','other'].map((t) => (
                  <option key={t} value={t} className="capitalize">{t.replace('_',' ')}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Title / Subject</Label>
              <Input {...reqForm.register('title')} placeholder="e.g. Hospital bill support for John Doe" />
              {reqForm.formState.errors.title && <p className="text-xs text-destructive">{reqForm.formState.errors.title.message as string}</p>}
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <textarea
                {...reqForm.register('description')}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Provide details about the welfare need…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Amount Requested (KES)</Label>
                <Input type="number" step="0.01" {...reqForm.register('amountRequested')} />
              </div>
              <div className="space-y-1">
                <Label>Priority</Label>
                <select {...reqForm.register('priority')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  {['low','normal','high','urgent'].map((p) => (
                    <option key={p} value={p} className="capitalize">{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpenRequest(false)}>Cancel</Button>
              <Button type="submit" loading={reqForm.formState.isSubmitting}>Submit Request</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Pool contribution dialog */}
      <Dialog open={openPool} onOpenChange={setOpenPool}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record Welfare Fund Contribution</DialogTitle></DialogHeader>
          <form onSubmit={poolForm.handleSubmit(onSubmitPool)} className="space-y-4">
            <div className="space-y-1">
              <Label>Member</Label>
              <select {...poolForm.register('memberId')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">Select member…</option>
                {(membersData?.items ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Amount (KES)</Label>
                <Input type="number" step="0.01" {...poolForm.register('amount')} />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <select {...poolForm.register('contributionType')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="regular">Regular</option>
                  <option value="emergency_levy">Emergency Levy</option>
                  <option value="special">Special</option>
                  <option value="bereavement_levy">Bereavement Levy</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Payment Method</Label>
                <select {...poolForm.register('paymentMethod')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="">Select…</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Input {...poolForm.register('notes')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpenPool(false)}>Cancel</Button>
              <Button type="submit" loading={poolForm.formState.isSubmitting}>Record</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Quick review dialog */}
      {reviewId && (
        <Dialog open={!!reviewId} onOpenChange={() => setReviewId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Review Welfare Request</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Select an action for this welfare request.</p>
              <div className="flex gap-3">
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  onClick={() => onApprove(reviewId, 0)}
                >
                  <CheckCircle2 size={16} className="mr-2" /> Approve
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={async () => {
                    try {
                      await reviewReq.mutateAsync({ action: 'reject', rejectionReason: 'Declined by officer' });
                      toast({ title: 'Request rejected' }); setReviewId(null);
                    } catch (e) { toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) }); }
                  }}
                >
                  Reject
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
