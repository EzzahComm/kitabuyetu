'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import {
  useApplication, useResumeUrl, useUpdateApplicationStage, useHireApplicant, useEmployees,
} from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage, formatDateTime } from '@/lib/utils';
import { HR_EMPLOYMENT_TYPES } from '@/lib/validators/hr.schema';

const STAGE_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  applied: 'secondary', screening: 'default', interview: 'default',
  offer: 'default', hired: 'default', rejected: 'destructive',
};

const NEXT_STAGES = ['screening', 'interview', 'offer', 'rejected'] as const;

export default function CareersApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data: application, isLoading } = useApplication(params.id);
  const resumeQuery = useResumeUrl(params.id);
  const updateStage = useUpdateApplicationStage(params.id);
  const hireApplicant = useHireApplicant(params.id);
  const { data: activeEmployees } = useEmployees({ status: 'active' });

  const [notes, setNotes] = useState('');
  const [hireOpen, setHireOpen] = useState(false);
  const [hireForm, setHireForm] = useState({
    department: '', jobTitle: '', employmentType: 'full_time', hireDate: '', managerId: '',
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!application) return <p className="text-sm text-muted-foreground">Application not found.</p>;

  const isTerminal = application.stage === 'hired' || application.stage === 'rejected';

  const onViewResume = async () => {
    const result = await resumeQuery.refetch();
    if (result.data?.url) window.open(result.data.url, '_blank', 'noopener,noreferrer');
    else toast({ variant: 'destructive', title: 'No resume on file' });
  };

  const onMoveStage = async (stage: typeof NEXT_STAGES[number]) => {
    try {
      await updateStage.mutateAsync({ stage, notes: notes || undefined });
      toast({ title: `Moved to ${stage}` });
      setNotes('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onHire = async () => {
    try {
      const result = await hireApplicant.mutateAsync({
        department: hireForm.department || undefined,
        jobTitle: hireForm.jobTitle || undefined,
        employmentType: hireForm.employmentType as typeof HR_EMPLOYMENT_TYPES[number],
        hireDate: hireForm.hireDate,
        managerId: hireForm.managerId || undefined,
      });
      toast({ title: `${application.applicant_name} hired as ${result.employee.employee_number}` });
      setHireOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-5">
      <Link href="/admin/careers" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All applications
      </Link>

      <PageHeader
        title={application.applicant_name}
        description={`Applied for ${application.job_title} · ${formatDateTime(application.created_at)}`}
        actions={
          !isTerminal && (
            <Dialog open={hireOpen} onOpenChange={(v) => { setHireOpen(v); if (v) setHireForm((f) => ({ ...f, jobTitle: application.job_title })); }}>
              <DialogTrigger asChild>
                <Button>Hire</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Hire {application.applicant_name}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Creates an HR employee record linked to this application, using the candidate&rsquo;s name and email.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="hireDepartment">Department</Label>
                      <Input id="hireDepartment" value={hireForm.department} onChange={(e) => setHireForm((f) => ({ ...f, department: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="hireJobTitle">Job title</Label>
                      <Input id="hireJobTitle" value={hireForm.jobTitle} onChange={(e) => setHireForm((f) => ({ ...f, jobTitle: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="hireType">Employment type</Label>
                      <Select value={hireForm.employmentType} onValueChange={(v) => setHireForm((f) => ({ ...f, employmentType: v }))}>
                        <SelectTrigger id="hireType"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {HR_EMPLOYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="hireDate">Hire date *</Label>
                      <Input id="hireDate" type="date" value={hireForm.hireDate} onChange={(e) => setHireForm((f) => ({ ...f, hireDate: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hireManager">Manager</Label>
                    <Select value={hireForm.managerId} onValueChange={(v) => setHireForm((f) => ({ ...f, managerId: v }))}>
                      <SelectTrigger id="hireManager"><SelectValue placeholder="No manager" /></SelectTrigger>
                      <SelectContent>
                        {(activeEmployees ?? []).map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.first_name} {m.last_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={onHire} disabled={!hireForm.hireDate || hireApplicant.isPending}>
                    {hireApplicant.isPending ? 'Hiring…' : 'Confirm hire'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-2">
                <Badge variant={STAGE_VARIANT[application.stage]}>{application.stage.replace('_', ' ')}</Badge>
                {application.hired_employee_id && (
                  <Link href={`/admin/hr/${application.hired_employee_id}`} className="text-xs text-primary hover:underline">
                    View HR record
                  </Link>
                )}
              </div>
              {application.cover_note && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cover note</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{application.cover_note}</p>
                </div>
              )}
              {application.stage_notes && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Review notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{application.stage_notes}</p>
                </div>
              )}
              <Button variant="outline" size="sm" onClick={onViewResume} disabled={!application.resume_path || resumeQuery.isFetching}>
                <FileText className="mr-2 h-4 w-4" />
                {application.resume_path ? (resumeQuery.isFetching ? 'Loading…' : 'View resume') : 'No resume on file'}
              </Button>
            </CardContent>
          </Card>

          {!isTerminal && (
            <Card>
              <CardContent className="space-y-3 p-5">
                <p className="text-sm font-medium">Move stage</p>
                <Textarea placeholder="Notes for this stage (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  {NEXT_STAGES.filter((s) => s !== application.stage).map((s) => (
                    <Button key={s} size="sm" variant={s === 'rejected' ? 'destructive' : 'outline'} onClick={() => onMoveStage(s)} disabled={updateStage.isPending}>
                      {s.replace('_', ' ')}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="lg:col-span-1">
          <Card>
            <CardContent className="space-y-2 p-5">
              <p className="text-sm font-medium">Contact</p>
              <p className="text-sm text-muted-foreground">{application.applicant_email}</p>
              {application.applicant_phone && <p className="text-sm text-muted-foreground">{application.applicant_phone}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
