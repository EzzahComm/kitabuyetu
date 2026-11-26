'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import { organizationApi } from '@/lib/api/endpoints';
import { enterpriseKeys } from '@/lib/api/enterprise-keys';
import type { ReportCadence, ReportFormat, ReportType, ScheduleRow } from '@/lib/services/report-export.service';
import {
  CreateReportScheduleSchema,
  REPORT_CADENCES,
  REPORT_FORMATS,
  REPORT_TYPES,
} from '@/lib/validators/organization.schema';
import { formatDateTime, getErrorMessage } from '@/lib/utils';

const reportNames: Record<ReportType, string> = { program_budget: 'Budget variance', donor_spend: 'Donor spend' };
const selectStyle = 'h-10 rounded-md border border-input bg-background px-3 text-sm';

export function ReportLoadError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="space-y-2" role="alert">
      <p>{getErrorMessage(error)}</p>
      <Button variant="outline" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

function FormatSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ReportFormat;
  onChange: (value: ReportFormat) => void;
}) {
  return (
    <select id={id} className={selectStyle} value={value} onChange={(e) => onChange(e.target.value as ReportFormat)}>
      {REPORT_FORMATS.map((format) => (
        <option key={format} value={format}>
          {format === 'xlsx' ? 'Excel (.xlsx)' : format.toUpperCase()}
        </option>
      ))}
    </select>
  );
}

export function ExportReport({ reportType }: { reportType: ReportType }) {
  const router = useRouter();
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const request = useMutation({
    mutationFn: organizationApi.requestReportExport,
    onSuccess: ({ id }) => router.push(`/enterprise/reports/exports/${id}`),
  });
  const id = `export-format-${reportType}`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id}>File format</Label>
        <FormatSelect id={id} value={format} onChange={setFormat} />
        <Button
          variant="outline"
          loading={request.isPending}
          disabled={request.isSuccess}
          onClick={() => request.mutate({ reportType, format })}
        >
          Export report
        </Button>
      </div>
      {request.isError && (
        <p role="alert" className="text-sm text-destructive">
          {getErrorMessage(request.error)}
        </p>
      )}
    </div>
  );
}

function ScheduleEditor({ schedule, onClose }: { schedule: ScheduleRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [reportType, setReportType] = useState<ReportType>(schedule?.reportType ?? 'program_budget');
  const [format, setFormat] = useState<ReportFormat>(schedule?.format ?? 'pdf');
  const [cadence, setCadence] = useState<ReportCadence>(schedule?.cadence ?? 'weekly');
  const [emails, setEmails] = useState(schedule?.recipientEmails.join(', ') ?? '');
  const [notifyCoordinator, setNotifyCoordinator] = useState(schedule?.notifyCoordinator ?? true);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const recipientEmails = [
        ...new Set(
          emails
            .split(',')
            .map((email) => email.trim())
            .filter(Boolean),
        ),
      ];
      const input = { reportType, format, cadence, recipientEmails, notifyCoordinator };
      const validation = CreateReportScheduleSchema.safeParse(input);
      if (!validation.success) {
        if (!notifyCoordinator && !recipientEmails.length)
          throw new Error('Add a recipient or select organization leads.');
        if (recipientEmails.length > 20) throw new Error('Enter up to 20 recipient addresses.');
        throw new Error('Check each email address and separate addresses with commas.');
      }
      return schedule
        ? organizationApi.updateReportSchedule(schedule.id, { cadence, recipientEmails, notifyCoordinator })
        : organizationApi.createReportSchedule(input);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.reportSchedules() });
      toast({ title: schedule ? 'Schedule updated' : 'Schedule created' });
      onClose();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    save.mutate();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{schedule ? 'Edit schedule' : 'New report schedule'}</DialogTitle>
          <DialogDescription>
            {schedule
              ? `${reportNames[reportType]} · ${format.toUpperCase()}`
              : 'The first report is queued at the next five-minute scheduling check.'}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {!schedule && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor="schedule-report">Report</Label>
                <select
                  id="schedule-report"
                  className={selectStyle}
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value as ReportType)}
                >
                  {REPORT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {reportNames[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="schedule-format">File format</Label>
                <FormatSelect id="schedule-format" value={format} onChange={setFormat} />
              </div>
            </div>
          )}
          <div className="grid gap-1">
            <Label htmlFor="schedule-cadence">Frequency</Label>
            <select
              id="schedule-cadence"
              className={selectStyle}
              value={cadence}
              onChange={(e) => setCadence(e.target.value as ReportCadence)}
            >
              {REPORT_CADENCES.map((c) => (
                <option value={c} key={c}>
                  {c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="schedule-emails">Recipient emails</Label>
            <Input
              id="schedule-emails"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              type="email"
              multiple
              aria-describedby="schedule-email-help"
            />
            <p id="schedule-email-help" className="text-xs text-muted-foreground">
              Separate up to 20 addresses with commas. Recipients need report access in this organization to open the
              emailed link.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notifyCoordinator}
              onChange={(e) => setNotifyCoordinator(e.target.checked)}
            />
            Email organization leads
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={save.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {schedule ? 'Save changes' : 'Create schedule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReportSchedules() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const schedules = useQuery({ queryKey: enterpriseKeys.reportSchedules(), queryFn: organizationApi.reportSchedules });
  const plan = useQuery({ queryKey: enterpriseKeys.plan(), queryFn: organizationApi.plan });
  const [editor, setEditor] = useState<ScheduleRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ScheduleRow | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: enterpriseKeys.reportSchedules() });
  const toggle = useMutation({
    mutationFn: (row: ScheduleRow) => organizationApi.updateReportSchedule(row.id, { isActive: !row.isActive }),
    onSuccess: async (row) => {
      await refresh();
      toast({ title: row.isActive ? 'Schedule resumed' : 'Schedule paused' });
    },
    onError: (err) =>
      toast({ title: 'Could not update schedule', description: getErrorMessage(err), variant: 'destructive' }),
  });
  const remove = async () => {
    if (!deleting) return;
    try {
      await organizationApi.deleteReportSchedule(deleting.id);
      await refresh();
      toast({ title: 'Schedule deleted' });
    } catch (err) {
      toast({ title: 'Could not delete schedule', description: getErrorMessage(err), variant: 'destructive' });
    }
  };
  return (
    <section className="space-y-4" aria-label="Report schedules">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Report schedules</h2>
        {plan.data?.advanced_reports && <Button onClick={() => setEditor('new')}>New schedule</Button>}
      </div>
      {plan.isError && <ReportLoadError error={plan.error} retry={plan.refetch} />}
      {plan.isSuccess && !plan.data?.advanced_reports && (
        <p className="text-sm text-muted-foreground">
          Creating a report schedule requires a plan with advanced reports.
        </p>
      )}
      {schedules.isPending && <p role="status">Loading schedules…</p>}
      {schedules.isError && <ReportLoadError error={schedules.error} retry={schedules.refetch} />}
      {schedules.isSuccess && !schedules.data.items.length && (
        <p className="text-muted-foreground">No report schedules yet.</p>
      )}
      {schedules.isSuccess &&
        schedules.data.items.map((row) => (
          <Card key={row.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
              <div className="min-w-0 space-y-1">
                <h3 className="font-medium">
                  {reportNames[row.reportType]} · {row.format.toUpperCase()}
                </h3>
                <p className="text-sm">
                  <span className="capitalize">{row.cadence}</span> · {row.isActive ? 'Active' : 'Paused'}
                </p>
                <p className="break-words text-sm text-muted-foreground">
                  {[...(row.notifyCoordinator ? ['Organization leads'] : []), ...row.recipientEmails].join(', ')}
                </p>
                {row.isActive && (
                  <p className="text-sm text-muted-foreground">Next run {formatDateTime(row.nextRunAt)}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => setEditor(row)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={toggle.isPending || (!row.isActive && !plan.data?.advanced_reports)}
                  onClick={() => toggle.mutate(row)}
                >
                  {row.isActive ? 'Pause' : 'Resume'}
                </Button>
                <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => setDeleting(row)}>
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      {editor && <ScheduleEditor schedule={editor === 'new' ? null : editor} onClose={() => setEditor(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete report schedule?"
        description={
          deleting &&
          `Future ${deleting.cadence} runs of ${reportNames[deleting.reportType]} (${deleting.format.toUpperCase()}) will stop.`
        }
        confirmLabel="Delete schedule"
        variant="danger"
        onConfirm={remove}
      />
    </section>
  );
}
