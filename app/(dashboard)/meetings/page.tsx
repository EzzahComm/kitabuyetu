'use client';

import { useState } from 'react';
import { Plus, Calendar, Users, CheckSquare, Clock, MapPin, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { useMeetings, useMeetingStats, useCreateMeeting, useUpdateMeeting, type MeetingRow } from '@/hooks/use-meetings';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { formatDate, formatDateTime, getErrorMessage } from '@/lib/utils';

const createSchema = z.object({
  title:          z.string().min(3),
  meetingType:    z.enum(['regular','special','agm','emergency','committee','training']).default('regular'),
  scheduledAt:    z.string().min(1, 'Date/time required'),
  venue:          z.string().optional(),
  isVirtual:      z.boolean().default(false),
  meetingLink:    z.string().optional(),
  quorumRequired: z.coerce.number().int().positive().optional(),
  notes:          z.string().optional(),
});

type CreateMeetingForm = z.infer<typeof createSchema>;

const statusVariant: Record<string, 'warning' | 'default' | 'success' | 'destructive' | 'secondary'> = {
  scheduled:   'warning',
  in_progress: 'default',
  completed:   'success',
  cancelled:   'destructive',
  postponed:   'secondary',
};

const typeLabels: Record<string, string> = {
  regular: 'Regular', special: 'Special', agm: 'AGM',
  emergency: 'Emergency', committee: 'Committee', training: 'Training',
};

export default function MeetingsPage() {
  const [page, setPage]     = useState(1);
  const [status, setStatus] = useState('all');
  const [open, setOpen]     = useState(false);
  const { toast } = useToast();

  const { data, isLoading } = useMeetings({ page, limit: 20, ...(status !== 'all' ? { status } : {}) });
  const { data: stats }     = useMeetingStats();
  const createMeeting       = useCreateMeeting();

  const form = useForm<CreateMeetingForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { meetingType: 'regular', isVirtual: false },
  });
  const isVirtual = useWatch({ control: form.control, name: 'isVirtual' });

  const onSubmit = async (values: CreateMeetingForm) => {
    // Convert datetime-local value to ISO string
    const scheduledAt = new Date(values.scheduledAt).toISOString();
    try {
      await createMeeting.mutateAsync({ ...values, scheduledAt });
      toast({ title: 'Meeting scheduled' });
      setOpen(false); form.reset();
    } catch (e) { toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) }); }
  };

  const columns = [
    {
      key: 'title', header: 'Meeting',
      render: (row: MeetingRow) => (
        <div className="space-y-0.5">
          <p className="font-medium text-sm">{row.title}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-xs py-0">{typeLabels[row.meeting_type] ?? row.meeting_type}</Badge>
            {row.is_virtual && <span className="flex items-center gap-1"><Video size={10} /> Virtual</span>}
            {row.venue && !row.is_virtual && <span className="flex items-center gap-1"><MapPin size={10} /> {row.venue}</span>}
          </div>
        </div>
      ),
    },
    {
      key: 'scheduled_at', header: 'Date & Time',
      render: (row: MeetingRow) => (
        <div>
          <p className="text-sm font-medium">{formatDate(row.scheduled_at)}</p>
          <p className="text-xs text-muted-foreground">{new Date(row.scheduled_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      ),
    },
    {
      key: 'chaired_by_name', header: 'Chair',
      render: (row: MeetingRow) => <span className="text-sm">{row.chaired_by_name ?? '—'}</span>,
    },
    {
      key: 'attendees_present', header: 'Attendance',
      render: (row: MeetingRow) => (
        <div className="flex items-center gap-1 text-sm">
          <Users size={14} className="text-muted-foreground" />
          <span>{row.attendees_present ?? 0}</span>
          {row.quorum_required && <span className="text-muted-foreground">/ {row.quorum_required}</span>}
        </div>
      ),
    },
    {
      key: 'resolution_count', header: 'Resolutions',
      render: (row: MeetingRow) => <span className="text-sm">{row.resolution_count ?? 0}</span>,
    },
    {
      key: 'status', header: 'Status',
      render: (row: MeetingRow) => <Badge variant={statusVariant[row.status] ?? 'secondary'} className="capitalize text-xs">{row.status?.replace('_',' ')}</Badge>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        description="Schedule, record minutes, and track resolutions"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} className="mr-2" /> Schedule Meeting
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Meetings" value={stats?.totalMeetings ?? 0} description={`${stats?.completedMeetings ?? 0} completed`} />
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Upcoming</p>
            <p className="text-2xl font-bold mt-1 text-blue-600">{stats?.upcomingMeetings ?? 0}</p>
          </CardContent>
        </Card>
        <StatCard title="Avg Attendance" value={`${stats?.avgAttendancePct ?? 0}%`} />
        <StatCard title="Resolutions" value={stats?.totalResolutions ?? 0} description={`${stats?.implementedResolutions ?? 0} implemented`} />
      </div>

      <Tabs value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
        <TabsList>
          {['all','scheduled','in_progress','completed','cancelled'].map((s) => (
            <TabsTrigger key={s} value={s} className="capitalize">{s.replace('_',' ')}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={status} className="mt-4">
          <PaginatedTable
            data={data}
            isLoading={isLoading}
            columns={columns}
            onPageChange={setPage}
            emptyMessage="No meetings found"
          />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Schedule Meeting</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label>Meeting Title</Label>
              <Input {...form.register('title')} placeholder="e.g. June 2026 Monthly Meeting" />
              {form.formState.errors.title && <p className="text-xs text-destructive">{form.formState.errors.title.message as string}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Type</Label>
                <select {...form.register('meetingType')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  {Object.entries(typeLabels).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Date & Time</Label>
                <Input type="datetime-local" {...form.register('scheduledAt')} />
                {form.formState.errors.scheduledAt && <p className="text-xs text-destructive">{form.formState.errors.scheduledAt.message as string}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="isVirtual" {...form.register('isVirtual')} className="rounded" />
              <Label htmlFor="isVirtual" className="cursor-pointer">Virtual meeting</Label>
            </div>
            {isVirtual ? (
              <div className="space-y-1">
                <Label>Meeting Link</Label>
                <Input type="url" placeholder="https://zoom.us/j/..." {...form.register('meetingLink')} />
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Venue</Label>
                <Input placeholder="e.g. Community Hall, Westlands" {...form.register('venue')} />
              </div>
            )}
            <div className="space-y-1">
              <Label>Quorum Required</Label>
              <Input type="number" min={1} placeholder="Minimum members needed" {...form.register('quorumRequired')} />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input placeholder="Any additional notes…" {...form.register('notes')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={form.formState.isSubmitting}>Schedule</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
