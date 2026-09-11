'use client';

/**
 * Meeting detail.
 *
 * The meetings list page has always advertised "Schedule, record minutes, and
 * track resolutions", but only the first of those was reachable: `useMeeting`,
 * `useUpdateMeeting`, `useRecordAttendance` and `useAddResolution` all existed
 * and were imported by nothing, and there was no detail route at all. So the
 * "Resolutions" stat read 0 forever and minutes could never be written.
 *
 * This page covers minutes, status transitions, and the resolution lifecycle
 * including follow-through. Attendance is deliberately NOT here yet — it needs
 * a member picker and is its own piece of work; `attendees_present` therefore
 * still reads 0 in the list.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Circle, Play, Square, CalendarX, Plus, Video, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { StatusPill } from '@/components/shared/status-pill';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useMeeting, useUpdateMeeting, useAddResolution, useUpdateResolution,
  type MeetingResolutionRow,
} from '@/hooks/use-meetings';
import { useHasPermission } from '@/lib/auth/use-permission';
import { useToast } from '@/hooks/use-toast';
import { formatDate, getErrorMessage } from '@/lib/utils';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

const typeLabels: Record<string, string> = {
  regular: 'Regular', special: 'Special', agm: 'AGM',
  emergency: 'Emergency', committee: 'Committee', training: 'Training',
};

// Mirrors AddResolutionSchema's required shape. Vote counts default to 0
// server-side, so they stay optional here.
const resolutionSchema = z.object({
  resolutionText:         z.string().min(10, 'Give the resolution at least 10 characters'),
  status:                 z.enum(['carried', 'defeated', 'tabled', 'deferred']),
  votesFor:               z.coerce.number().int().min(0).optional(),
  votesAgainst:           z.coerce.number().int().min(0).optional(),
  votesAbstain:           z.coerce.number().int().min(0).optional(),
  implementationDeadline: z.string().optional(),
  notes:                  z.string().optional(),
});
type ResolutionForm = z.infer<typeof resolutionSchema>;

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data: meeting, isLoading, isError, error } = useMeeting(id);
  const updateMeeting    = useUpdateMeeting(id);
  const addResolution    = useAddResolution(id);
  const updateResolution = useUpdateResolution(id);
  const canManage        = useHasPermission('meetings.manage');

  const [minutes, setMinutes]           = useState('');
  const [minutesDirty, setMinutesDirty] = useState(false);
  const [seededFor, setSeededFor]       = useState<string | null>(null);
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [startOpen, setStartOpen]       = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen]     = useState(false);

  // Seed the editor once per meeting, during render rather than an effect —
  // the React-recommended way to adjust state from a prop that arrives
  // asynchronously. Guarding on the id (not just `minutesDirty`) also means a
  // background refetch after save can't quietly reseed stale text later.
  if (meeting && seededFor !== meeting.id && !minutesDirty) {
    setMinutes(meeting.minutes ?? '');
    setSeededFor(meeting.id);
  }

  const resolutionForm = useForm<ResolutionForm>({
    resolver: zodResolver(resolutionSchema),
    defaultValues: { status: 'carried' },
  });

  const runUpdate = async (
    body: Parameters<typeof updateMeeting.mutateAsync>[0],
    successTitle: string,
    onDone?: () => void,
  ) => {
    try {
      await updateMeeting.mutateAsync(body);
      toast({ title: successTitle });
      onDone?.();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(e) });
    }
  };

  const onSaveMinutes = () =>
    runUpdate({ minutes }, 'Minutes saved', () => setMinutesDirty(false));

  const onAddResolution = async (values: ResolutionForm) => {
    try {
      await addResolution.mutateAsync({
        resolutionText:         values.resolutionText,
        status:                 values.status,
        votesFor:               values.votesFor ?? 0,
        votesAgainst:           values.votesAgainst ?? 0,
        votesAbstain:           values.votesAbstain ?? 0,
        implementationDeadline: values.implementationDeadline || undefined,
        notes:                  values.notes?.trim() || undefined,
      });
      toast({ title: 'Resolution recorded' });
      setResolutionOpen(false);
      resolutionForm.reset({ status: 'carried' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(e) });
    }
  };

  const toggleImplemented = async (r: MeetingResolutionRow) => {
    try {
      await updateResolution.mutateAsync({ resolutionId: r.id, implemented: !r.implemented });
      toast({ title: r.implemented ? 'Marked outstanding' : 'Marked implemented' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(e) });
    }
  };

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }
  if (isError)  return <p className="text-destructive">{getErrorMessage(error)}</p>;
  if (!meeting) return <p className="text-muted-foreground">Meeting not found</p>;

  const resolutions   = meeting.resolutions ?? [];
  const agenda        = meeting.agenda ?? [];
  const implemented   = resolutions.filter((r) => r.implemented).length;
  const outstanding   = resolutions.length - implemented;
  const canEditMinutes = canManage && meeting.status !== 'cancelled';

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" aria-label="Back to meetings" asChild className="mt-1">
          <Link href="/meetings"><ArrowLeft size={18} /></Link>
        </Button>
        <PageHeader
          className="flex-1"
          title={meeting.title}
          description={`${typeLabels[meeting.meeting_type] ?? meeting.meeting_type} · ${formatDate(meeting.scheduled_at)}`}
          actions={<StatusPill status={meeting.status} />}
        />
      </div>

      <Card>
        <CardContent className="p-4 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div className="flex items-center gap-2">
            {meeting.is_virtual
              ? <Video size={15} className="text-muted-foreground shrink-0" />
              : <MapPin size={15} className="text-muted-foreground shrink-0" />}
            <span className="text-muted-foreground">{meeting.is_virtual ? 'Online' : 'Venue'}</span>
            <span className="ml-auto font-medium text-right">
              {meeting.is_virtual
                ? (meeting.meeting_link
                    ? <a href={meeting.meeting_link} className="text-brand-600 hover:underline" target="_blank" rel="noopener noreferrer">Join link</a>
                    : 'Link not set')
                : (meeting.venue || '—')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Chaired by</span>
            <span className="ml-auto font-medium">{meeting.chaired_by_name ?? '—'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Secretary</span>
            <span className="ml-auto font-medium">{meeting.secretary_name ?? '—'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Quorum</span>
            <span className="ml-auto font-medium">
              {meeting.quorum_required
                ? `${meeting.quorum_achieved ?? 0} / ${meeting.quorum_required}`
                : 'Not set'}
            </span>
          </div>
        </CardContent>
      </Card>

      {canManage && (
        <div className="flex gap-2 flex-wrap">
          {meeting.status === 'scheduled' && (
            <>
              <Button onClick={() => setStartOpen(true)} loading={updateMeeting.isPending}>
                <Play size={16} className="mr-2" /> Start meeting
              </Button>
              <Button variant="outline" onClick={() => setCancelOpen(true)} loading={updateMeeting.isPending}>
                <CalendarX size={16} className="mr-2" /> Cancel
              </Button>
            </>
          )}
          {meeting.status === 'in_progress' && (
            <Button onClick={() => setCompleteOpen(true)} loading={updateMeeting.isPending}>
              <Square size={16} className="mr-2" /> End meeting
            </Button>
          )}
        </div>
      )}

      {agenda.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Agenda</CardTitle></CardHeader>
          <CardContent>
            <ol className="list-decimal pl-5 space-y-1 text-sm">
              {agenda.map((item, i) => <li key={i}>{item}</li>)}
            </ol>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Minutes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {canEditMinutes ? (
            <>
              <Textarea
                aria-label="Meeting minutes"
                rows={8}
                placeholder="What was discussed and decided…"
                value={minutes}
                onChange={(e) => { setMinutes(e.target.value); setMinutesDirty(true); }}
              />
              <div className="flex items-center gap-3">
                <Button onClick={onSaveMinutes} loading={updateMeeting.isPending} disabled={!minutesDirty}>
                  Save minutes
                </Button>
                {minutesDirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
              </div>
            </>
          ) : meeting.minutes ? (
            <p className="text-sm whitespace-pre-wrap">{meeting.minutes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No minutes recorded.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Resolutions</CardTitle>
            {resolutions.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {implemented} implemented · {outstanding} outstanding
              </p>
            )}
          </div>
          {canManage && meeting.status !== 'cancelled' && (
            <Button size="sm" onClick={() => setResolutionOpen(true)}>
              <Plus size={15} className="mr-1.5" /> Add
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {resolutions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No resolutions recorded yet.
            </p>
          ) : (
            <ul className="divide-y">
              {resolutions.map((r) => (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0 flex gap-3">
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => toggleImplemented(r)}
                      aria-label={r.implemented ? 'Mark as outstanding' : 'Mark as implemented'}
                      aria-pressed={r.implemented}
                      className="mt-0.5 shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {r.implemented
                        ? <CheckCircle2 size={18} className="text-green-600" />
                        : <Circle size={18} className="text-muted-foreground" />}
                    </button>
                  ) : (
                    <span className="mt-0.5 shrink-0">
                      {r.implemented
                        ? <CheckCircle2 size={18} className="text-green-600" />
                        : <Circle size={18} className="text-muted-foreground" />}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${r.implemented ? 'text-muted-foreground line-through' : ''}`}>
                      {r.resolution_text}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                      <StatusPill status={r.status} size="sm" />
                      {(r.votes_for > 0 || r.votes_against > 0 || r.votes_abstain > 0) && (
                        <span>{r.votes_for} for · {r.votes_against} against · {r.votes_abstain} abstain</span>
                      )}
                      {r.responsible_party_name && <span>Owner: {r.responsible_party_name}</span>}
                      {r.implementation_deadline && <span>Due {formatDate(r.implementation_deadline)}</span>}
                      {r.implemented && r.implemented_at && <span>Done {formatDate(r.implemented_at)}</span>}
                    </div>
                    {r.notes && <p className="text-xs text-muted-foreground mt-1">{r.notes}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        title="Start this meeting?"
        description="It moves to in progress, so minutes and resolutions can be recorded against it."
        confirmLabel="Start"
        onConfirm={() => runUpdate({ status: 'in_progress' }, 'Meeting started')}
      />

      <ConfirmDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="End this meeting?"
        description="It is marked completed. Minutes and resolutions stay editable afterwards."
        confirmLabel="End meeting"
        onConfirm={() => runUpdate(
          { status: 'completed', endedAt: new Date().toISOString() },
          'Meeting completed',
        )}
      />

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this meeting?"
        description="The record is kept, marked cancelled."
        confirmLabel="Cancel meeting"
        cancelLabel="Keep"
        variant="danger"
        onConfirm={() => runUpdate({ status: 'cancelled' }, 'Meeting cancelled')}
      />

      <Dialog open={resolutionOpen} onOpenChange={setResolutionOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record a resolution</DialogTitle></DialogHeader>
          <form onSubmit={resolutionForm.handleSubmit(onAddResolution)} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="resolution-text">Resolution</Label>
              <Textarea
                id="resolution-text"
                rows={3}
                placeholder="The group resolved that…"
                {...resolutionForm.register('resolutionText')}
              />
              {resolutionForm.formState.errors.resolutionText && (
                <p className="text-xs text-destructive">{resolutionForm.formState.errors.resolutionText.message}</p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="resolution-status">Outcome</Label>
                <select
                  id="resolution-status"
                  {...resolutionForm.register('status')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="carried">Carried</option>
                  <option value="defeated">Defeated</option>
                  <option value="tabled">Tabled</option>
                  <option value="deferred">Deferred</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="resolution-deadline">Deadline</Label>
                <Input id="resolution-deadline" type="date" {...resolutionForm.register('implementationDeadline')} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="votes-for">For</Label>
                <Input id="votes-for" type="number" min="0" placeholder="0" {...resolutionForm.register('votesFor')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="votes-against">Against</Label>
                <Input id="votes-against" type="number" min="0" placeholder="0" {...resolutionForm.register('votesAgainst')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="votes-abstain">Abstain</Label>
                <Input id="votes-abstain" type="number" min="0" placeholder="0" {...resolutionForm.register('votesAbstain')} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="resolution-notes">Notes</Label>
              <Input id="resolution-notes" placeholder="Optional" {...resolutionForm.register('notes')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResolutionOpen(false)}>Cancel</Button>
              <Button type="submit" loading={resolutionForm.formState.isSubmitting}>Record resolution</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
