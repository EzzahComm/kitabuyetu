'use client';

/**
 * Org-run Programs - groups apply to join, or the organization invites them
 * directly. No platform-admin gate here (unlike /enterprise/groups' link
 * requests): the organization and group manage this relationship themselves.
 * Unrelated to the Funding Portal's "programs" (funding_programs, a budget
 * concept) - see feedback_funding_programs_is_money_only.
 */
import { useState } from 'react';
import Link from 'next/link';
import { Plus, ChevronRight, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import { useGroupPrograms, useCreateGroupProgram } from '@/hooks/use-enterprise-programs';
import type { ProgramRow, ProgramStatus } from '@/lib/services/programs.service';

const STATUS_LABEL: Record<ProgramStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  paused: 'Paused',
  closed: 'Closed',
  archived: 'Archived',
};
const STATUS_VARIANT: Record<ProgramStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  published: 'default',
  paused: 'secondary',
  closed: 'secondary',
  archived: 'destructive',
};

export default function EnterpriseProgramsPage() {
  const { data, isLoading } = useGroupPrograms();
  const programs = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Programs"
        description="Initiatives your organization runs. Groups apply to join, or you invite them directly."
        actions={<NewProgramDialog />}
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : programs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No programs yet. Create one to start recruiting groups.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((p) => (
            <ProgramCard key={p.id} program={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProgramCard({ program }: { program: ProgramRow }) {
  return (
    <Link href={`/enterprise/programs/${program.id}`}>
      <Card className="h-full transition-colors hover:border-primary/50">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base">{program.name}</CardTitle>
            <Badge variant={STATUS_VARIANT[program.status]}>{STATUS_LABEL[program.status]}</Badge>
          </div>
          {program.description && <CardDescription className="line-clamp-2">{program.description}</CardDescription>}
        </CardHeader>
        <CardContent className="flex items-center justify-between pt-0 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users size={13} /> Manage applications &amp; invitations
          </span>
          <ChevronRight size={14} />
        </CardContent>
      </Card>
    </Link>
  );
}

function NewProgramDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [objectives, setObjectives] = useState('');
  const [targetBeneficiaries, setTargetBeneficiaries] = useState('');
  const [applicationRequirements, setApplicationRequirements] = useState('');
  const create = useCreateGroupProgram();

  const reset = () => {
    setName('');
    setDescription('');
    setObjectives('');
    setTargetBeneficiaries('');
    setApplicationRequirements('');
  };

  const submit = () => {
    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        objectives: objectives.trim() || undefined,
        targetBeneficiaries: targetBeneficiaries.trim() || undefined,
        applicationRequirements: applicationRequirements.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast({ title: 'Program created', description: 'It starts as a draft - publish it when ready.' });
          reset();
          setOpen(false);
        },
        onError: (e) =>
          toast({ variant: 'destructive', title: 'Could not create program', description: getErrorMessage(e) }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus size={14} /> New program
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New program</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="program-name">Name</Label>
            <Input
              id="program-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Women-Led Enterprise VSLA Strengthening"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="program-description">Description</Label>
            <Textarea
              id="program-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="program-objectives">Objectives</Label>
            <Textarea
              id="program-objectives"
              value={objectives}
              onChange={(e) => setObjectives(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="program-beneficiaries">Target beneficiaries</Label>
            <Input
              id="program-beneficiaries"
              value={targetBeneficiaries}
              onChange={(e) => setTargetBeneficiaries(e.target.value)}
              placeholder="e.g. Women-led VSLAs in arid/semi-arid counties"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="program-requirements">Application requirements</Label>
            <Textarea
              id="program-requirements"
              value={applicationRequirements}
              onChange={(e) => setApplicationRequirements(e.target.value)}
              rows={2}
              placeholder="What a group should prepare before applying"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={name.trim().length < 3 || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create program'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
