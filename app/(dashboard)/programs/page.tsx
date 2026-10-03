'use client';

/**
 * Group side of the Programs feature (migration 206) — browse programs an
 * organization publishes, apply, and respond to invitations. No
 * platform-admin step: the group and organization manage this themselves.
 * This path was previously a dead page pointing at an unrelated, empty
 * crowdfunding-shaped `programs` table (see phantom-programs memory) — now
 * free to reuse for the real feature. Distinct from the public
 * /ecosystem/programs pages (Changi$ha campaign browsing).
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage, formatDate } from '@/lib/utils';
import {
  usePublishedPrograms,
  useMyProgramApplications,
  useApplyToProgram,
  useWithdrawProgramApplication,
  useMyProgramInvitations,
  useAcceptProgramInvitation,
  useDeclineProgramInvitation,
} from '@/hooks/use-group-programs';
import type { ProgramApplicationStatus } from '@/lib/services/program-applications.service';
import type { ProgramInvitationRow } from '@/lib/services/program-invitations.service';

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

export default function GroupProgramsPage() {
  const { user } = useAuth();
  const isChairperson = isTenantUser(user) && user.groupRole === 'chairperson';

  return (
    <div className="space-y-6">
      <PageHeader title="Programs" description="Initiatives organizations run that your group can join." />
      <Tabs defaultValue="browse">
        <TabsList>
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="applications">My applications</TabsTrigger>
          <TabsTrigger value="invitations">Invitations</TabsTrigger>
        </TabsList>
        <TabsContent value="browse" className="mt-4">
          <BrowsePanel isChairperson={isChairperson} />
        </TabsContent>
        <TabsContent value="applications" className="mt-4">
          <ApplicationsPanel isChairperson={isChairperson} />
        </TabsContent>
        <TabsContent value="invitations" className="mt-4">
          <InvitationsPanel isChairperson={isChairperson} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BrowsePanel({ isChairperson }: { isChairperson: boolean }) {
  const { data, isLoading } = usePublishedPrograms();
  const { toast } = useToast();
  const apply = useApplyToProgram();
  const programs = data?.items ?? [];

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (programs.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No published programs right now.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {programs.map((p) => (
        <Card key={p.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{p.name}</CardTitle>
            <CardDescription>{p.organizationName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {p.description && <p className="text-sm text-muted-foreground line-clamp-3">{p.description}</p>}
            <Button
              size="sm"
              disabled={!isChairperson || apply.isPending}
              title={!isChairperson ? 'Only the chairperson can apply' : undefined}
              onClick={() =>
                apply.mutate(
                  { programId: p.id },
                  {
                    onSuccess: () => toast({ title: 'Application submitted' }),
                    onError: (e) =>
                      toast({ variant: 'destructive', title: 'Could not apply', description: getErrorMessage(e) }),
                  },
                )
              }
            >
              {apply.isPending ? 'Applying…' : 'Apply'}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ApplicationsPanel({ isChairperson }: { isChairperson: boolean }) {
  const { data, isLoading } = useMyProgramApplications();
  const { toast } = useToast();
  const withdraw = useWithdrawProgramApplication();
  const applications = data?.items ?? [];

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (applications.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">No applications yet.</CardContent>
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
                <p className="font-medium">{a.programName}</p>
                <p className="text-xs text-muted-foreground">Submitted {formatDate(a.createdAt)}</p>
              </div>
              <Badge variant="outline">{APP_STATUS_LABEL[a.status]}</Badge>
            </div>
            {a.reviewNotes && (
              <p className="text-sm text-muted-foreground">Note from the organization: {a.reviewNotes}</p>
            )}
            {isChairperson && APP_OPEN.includes(a.status) && (
              <Button
                size="sm"
                variant="outline"
                disabled={withdraw.isPending}
                onClick={() =>
                  withdraw.mutate(a.id, {
                    onError: (e) =>
                      toast({ variant: 'destructive', title: 'Could not withdraw', description: getErrorMessage(e) }),
                  })
                }
              >
                Withdraw
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function InvitationsPanel({ isChairperson }: { isChairperson: boolean }) {
  const { data, isLoading } = useMyProgramInvitations();
  const { toast } = useToast();
  const accept = useAcceptProgramInvitation();
  const decline = useDeclineProgramInvitation();
  const [actingId, setActingId] = useState<string | null>(null);
  const invitations = data?.items ?? [];

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (invitations.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">No invitations yet.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {invitations.map((inv) => (
        <Card key={inv.id}>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{inv.programName}</p>
                <p className="text-xs text-muted-foreground">Invited {formatDate(inv.createdAt)}</p>
              </div>
              <Badge variant="outline">{INV_STATUS_LABEL[inv.status]}</Badge>
            </div>
            {inv.message && <p className="text-sm text-muted-foreground">{inv.message}</p>}
            {isChairperson && inv.status === 'pending' && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={actingId === inv.id}
                  onClick={() => {
                    setActingId(inv.id);
                    accept.mutate(inv.id, {
                      onSuccess: () => toast({ title: 'Invitation accepted' }),
                      onError: (e) =>
                        toast({ variant: 'destructive', title: 'Could not accept', description: getErrorMessage(e) }),
                      onSettled: () => setActingId(null),
                    });
                  }}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actingId === inv.id}
                  onClick={() => {
                    setActingId(inv.id);
                    decline.mutate(inv.id, {
                      onError: (e) =>
                        toast({ variant: 'destructive', title: 'Could not decline', description: getErrorMessage(e) }),
                      onSettled: () => setActingId(null),
                    });
                  }}
                >
                  Decline
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
