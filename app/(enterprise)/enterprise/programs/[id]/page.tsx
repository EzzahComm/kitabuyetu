'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage, formatDate } from '@/lib/utils';
import {
  useGroupProgram,
  useProgramReport,
  useUpdateGroupProgram,
  useTransitionGroupProgramStatus,
  useGroupProgramApplications,
  useAcceptProgramApplication,
  useDeclineProgramApplication,
  useRequestProgramApplicationInfo,
  useMarkProgramApplicationUnderReview,
  useGroupProgramInvitations,
  useInviteGroupToProgram,
  useCancelProgramInvitation,
} from '@/hooks/use-enterprise-programs';
import type { ProgramMembershipStatus, ProgramStatus } from '@/lib/services/programs.service';
import type { ProgramApplicationStatus } from '@/lib/services/program-applications.service';
import type { ProgramInvitationRow } from '@/lib/services/program-invitations.service';

const STATUS_LABEL: Record<ProgramStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  paused: 'Paused',
  closed: 'Closed',
  archived: 'Archived',
};
const NEXT_STATUSES: Record<ProgramStatus, { to: ProgramStatus; label: string }[]> = {
  draft: [{ to: 'published', label: 'Publish' }],
  published: [
    { to: 'paused', label: 'Pause' },
    { to: 'closed', label: 'Close' },
  ],
  paused: [
    { to: 'published', label: 'Resume' },
    { to: 'closed', label: 'Close' },
  ],
  closed: [{ to: 'archived', label: 'Archive' }],
  archived: [],
};

const APP_STATUS_LABEL: Record<ProgramApplicationStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  additional_information_requested: 'More info requested',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};
const APP_OPEN: ProgramApplicationStatus[] = ['draft', 'submitted', 'under_review', 'additional_information_requested'];

const INV_STATUS_LABEL: Record<ProgramInvitationRow['status'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export default function EnterpriseProgramDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: program, isLoading, isError, error, refetch } = useGroupProgram(id);
  const transition = useTransitionGroupProgramStatus(id);
  const { toast } = useToast();

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError)
    return (
      <div role="alert" className="space-y-2">
        <p>{getErrorMessage(error)}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  if (!program) return <p className="text-sm text-muted-foreground">Program not found.</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={program.name}
        description={program.description ?? undefined}
        breadcrumbs={[{ label: 'Programs', href: '/enterprise/programs' }, { label: program.name }]}
        actions={
          <>
            <Badge variant="outline">{STATUS_LABEL[program.status]}</Badge>
            {NEXT_STATUSES[program.status].map((n) => (
              <Button
                key={n.to}
                size="sm"
                variant="outline"
                disabled={transition.isPending}
                onClick={() =>
                  transition.mutate(n.to, {
                    onError: (e) =>
                      toast({
                        variant: 'destructive',
                        title: 'Could not update status',
                        description: getErrorMessage(e),
                      }),
                  })
                }
              >
                {n.label}
              </Button>
            ))}
            <EditProgramDialog
              id={id}
              initial={{
                name: program.name,
                description: program.description ?? '',
                objectives: program.objectives ?? '',
                targetBeneficiaries: program.targetBeneficiaries ?? '',
                applicationRequirements: program.applicationRequirements ?? '',
              }}
            />
          </>
        }
      />

      <Tabs defaultValue="applications">
        <TabsList>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="invitations">Invitations</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="applications" className="mt-4">
          <ApplicationsPanel programId={id} />
        </TabsContent>
        <TabsContent value="invitations" className="mt-4">
          <InvitationsPanel programId={id} />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ProgramReportsPanel programId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const MEMBERSHIP_LABEL: Record<ProgramMembershipStatus, string> = {
  invited: 'Invited',
  active: 'Active',
  suspended: 'Suspended',
  withdrawn: 'Withdrawn',
  completed: 'Completed',
  removed: 'Removed',
};

function StatusBreakdown<T extends string>({
  title,
  labels,
  counts,
  empty,
}: {
  title: string;
  labels: Record<T, string>;
  counts: Partial<Record<T, number>>;
  empty: string;
}) {
  const statuses = (Object.keys(labels) as T[]).filter((status) => (counts[status] ?? 0) > 0);
  const total = statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {title} <span className="text-muted-foreground">({total})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {statuses.length ? (
          <dl className="space-y-2">
            {statuses.map((status) => (
              <div key={status} className="flex justify-between gap-3 text-sm">
                <dt>{labels[status]}</dt>
                <dd className="font-medium tabular-nums">{counts[status]}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}

const monthLabel = new Intl.DateTimeFormat('en-KE', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function ProgramReportsPanel({ programId }: { programId: string }) {
  const { data, isPending, isError, error, refetch } = useProgramReport(programId);

  if (isPending) return <p role="status">Loading programme report…</p>;
  if (isError)
    return (
      <div role="alert" className="space-y-2">
        <p>Could not load the programme report. {getErrorMessage(error)}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  if (!data.total && !Object.keys(data.applications).length && !Object.keys(data.invitations).length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Programme activity</CardTitle>
          <CardDescription>
            No applications, invitations or memberships have been recorded for this programme.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Group enrolment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-muted-foreground">Active groups</dt>
              <dd className="text-2xl font-semibold">{data.active}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Distinct groups with membership records</dt>
              <dd className="text-2xl font-semibold">{data.distinctGroups}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Lifetime membership records</dt>
              <dd className="text-2xl font-semibold">{data.total}</dd>
            </div>
          </dl>
          {data.active > 0 && (
            <p className="text-sm text-muted-foreground">
              Of the active groups, {data.activeViaApplication} joined by application and {data.activeViaInvitation} by
              invitation.
            </p>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <StatusBreakdown
          title="Memberships"
          labels={MEMBERSHIP_LABEL}
          counts={data.memberships}
          empty="No membership records yet."
        />
        <StatusBreakdown
          title="Applications"
          labels={APP_STATUS_LABEL}
          counts={data.applications}
          empty="No applications yet."
        />
        <StatusBreakdown
          title="Invitations"
          labels={INV_STATUS_LABEL}
          counts={data.invitations}
          empty="No invitations yet."
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Monthly recruitment</CardTitle>
          <CardDescription>
            Applications created, invitations sent and memberships accepted in the last six calendar months (Nairobi
            time). The current month is in progress.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table aria-label="Monthly recruitment" className="w-full text-sm">
              <thead>
                <tr className="border-b text-right text-muted-foreground">
                  <th scope="col" className="py-2 pr-2 text-left">
                    Month
                  </th>
                  <th scope="col" className="px-1">
                    Applications
                  </th>
                  <th scope="col" className="px-1">
                    Invitations
                  </th>
                  <th scope="col" className="pl-1">
                    Enrolments
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.monthlyActivity.map((row) => (
                  <tr key={row.month} className="border-b text-right tabular-nums last:border-0">
                    <th scope="row" className="whitespace-nowrap py-2 pr-2 text-left font-medium">
                      {monthLabel.format(new Date(row.month + '-01T00:00:00Z'))}
                    </th>
                    <td className="px-1">{row.applications}</td>
                    <td className="px-1">{row.invitations}</td>
                    <td className="pl-1">{row.enrolments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EditProgramDialog({
  id,
  initial,
}: {
  id: string;
  initial: {
    name: string;
    description: string;
    objectives: string;
    targetBeneficiaries: string;
    applicationRequirements: string;
  };
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const update = useUpdateGroupProgram(id);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = () => {
    update.mutate(
      {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        objectives: form.objectives.trim() || undefined,
        targetBeneficiaries: form.targetBeneficiaries.trim() || undefined,
        applicationRequirements: form.applicationRequirements.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast({ title: 'Program updated' });
          setOpen(false);
        },
        onError: (e) =>
          toast({ variant: 'destructive', title: 'Could not update program', description: getErrorMessage(e) }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit program</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={set('name')} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={set('description')} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>Objectives</Label>
            <Textarea value={form.objectives} onChange={set('objectives')} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Target beneficiaries</Label>
            <Input value={form.targetBeneficiaries} onChange={set('targetBeneficiaries')} />
          </div>
          <div className="space-y-1.5">
            <Label>Application requirements</Label>
            <Textarea value={form.applicationRequirements} onChange={set('applicationRequirements')} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={form.name.trim().length < 3 || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplicationsPanel({ programId }: { programId: string }) {
  const { data, isLoading } = useGroupProgramApplications(programId);
  const { toast } = useToast();
  const accept = useAcceptProgramApplication(programId);
  const decline = useDeclineProgramApplication(programId);
  const requestInfo = useRequestProgramApplicationInfo(programId);
  const markUnderReview = useMarkProgramApplicationUnderReview(programId);
  const applications = data?.items ?? [];

  const onError = (title: string) => (e: unknown) =>
    toast({ variant: 'destructive', title, description: getErrorMessage(e) });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (applications.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">No applications yet.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {applications.map((a) => (
        <Card key={a.id}>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{a.groupName}</p>
                <p className="text-xs text-muted-foreground">Submitted {formatDate(a.createdAt)}</p>
              </div>
              <Badge variant="outline">{APP_STATUS_LABEL[a.status]}</Badge>
            </div>
            {a.reviewNotes && <p className="text-sm text-muted-foreground">Note: {a.reviewNotes}</p>}
            {APP_OPEN.includes(a.status) && (
              <div className="flex flex-wrap gap-2 pt-1">
                {a.status === 'submitted' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={markUnderReview.isPending}
                    onClick={() => markUnderReview.mutate({ appId: a.id }, { onError: onError('Could not update') })}
                  >
                    Mark under review
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={accept.isPending}
                  onClick={() => accept.mutate({ appId: a.id }, { onError: onError('Could not accept') })}
                >
                  Accept
                </Button>
                <ReasonButton
                  label="Request info"
                  title="Request more information"
                  onSubmit={(reviewNotes) =>
                    requestInfo.mutate({ appId: a.id, reviewNotes }, { onError: onError('Could not request info') })
                  }
                />
                <ReasonButton
                  label="Decline"
                  title="Decline application"
                  variant="destructive"
                  onSubmit={(reviewNotes) =>
                    decline.mutate({ appId: a.id, reviewNotes }, { onError: onError('Could not decline') })
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function InvitationsPanel({ programId }: { programId: string }) {
  const { data, isLoading } = useGroupProgramInvitations(programId);
  const { toast } = useToast();
  const [groupCode, setGroupCode] = useState('');
  const [message, setMessage] = useState('');
  const invite = useInviteGroupToProgram(programId);
  const cancel = useCancelProgramInvitation(programId);
  const invitations = data?.items ?? [];

  const sendInvite = () => {
    invite.mutate(
      { groupCode: groupCode.trim(), message: message.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: 'Invitation sent' });
          setGroupCode('');
          setMessage('');
        },
        onError: (e) =>
          toast({ variant: 'destructive', title: 'Could not send invitation', description: getErrorMessage(e) }),
      },
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite a group</CardTitle>
          <CardDescription>Enter the group&apos;s code (e.g. KY0000001).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invite-group-code">Group code</Label>
              <Input
                id="invite-group-code"
                value={groupCode}
                onChange={(e) => setGroupCode(e.target.value)}
                placeholder="KY0000001"
              />
            </div>
            <Button onClick={sendInvite} disabled={groupCode.trim().length < 9 || invite.isPending}>
              {invite.isPending ? 'Sending…' : 'Invite'}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-message">Message (optional)</Label>
            <Textarea id="invite-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : invitations.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No invitations sent yet.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {invitations.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{inv.groupName}</p>
                  <p className="text-xs text-muted-foreground">Sent {formatDate(inv.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{INV_STATUS_LABEL[inv.status]}</Badge>
                  {inv.status === 'pending' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cancel.isPending}
                      onClick={() =>
                        cancel.mutate(inv.id, {
                          onError: (e) =>
                            toast({
                              variant: 'destructive',
                              title: 'Could not cancel',
                              description: getErrorMessage(e),
                            }),
                        })
                      }
                    >
                      Cancel
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

function ReasonButton({
  label,
  title,
  variant = 'outline',
  onSubmit,
}: {
  label: string;
  title: string;
  variant?: 'outline' | 'destructive';
  onSubmit: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason / notes" />
        <DialogFooter>
          <Button
            variant={variant}
            disabled={!reason.trim()}
            onClick={() => {
              onSubmit(reason.trim());
              setReason('');
              setOpen(false);
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
