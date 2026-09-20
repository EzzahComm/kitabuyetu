'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
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
import { useEmployee, useEmployees, useUpdateEmployee, useTerminateEmployee } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage, formatDate } from '@/lib/utils';
import { HR_EMPLOYMENT_TYPES } from '@/lib/validators/hr.schema';

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', intern: 'Intern',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  active: 'default', on_leave: 'secondary', suspended: 'destructive', terminated: 'outline',
};

export default function HrEmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const { data: employee, isLoading } = useEmployee(params.id);
  const { data: allActive } = useEmployees({ status: 'active' });
  const updateEmployee = useUpdateEmployee(params.id);
  const terminateEmployee = useTerminateEmployee(params.id);

  const [form, setForm] = useState({
    department: '', jobTitle: '', employmentType: 'full_time', managerId: '', notes: '',
  });
  // Seeds the form the moment `employee` first arrives (or changes to a
  // different id) — done during render, not a useEffect, per React's
  // "adjusting state when a prop changes" pattern: setState here re-renders
  // before the browser paints, so it never flashes empty fields first.
  const [seededId, setSeededId] = useState<string | null>(null);
  if (employee && employee.id !== seededId) {
    setSeededId(employee.id);
    setForm({
      department: employee.department ?? '',
      jobTitle: employee.job_title ?? '',
      employmentType: employee.employment_type,
      managerId: employee.manager_id ?? '',
      notes: employee.notes ?? '',
    });
  }
  const [termOpen, setTermOpen] = useState(false);
  const [termDate, setTermDate] = useState('');
  const [termReason, setTermReason] = useState('');

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!employee) return <p className="text-sm text-muted-foreground">Employee not found.</p>;

  const onSave = async () => {
    try {
      await updateEmployee.mutateAsync({
        department: form.department || null,
        jobTitle: form.jobTitle || null,
        employmentType: form.employmentType as typeof HR_EMPLOYMENT_TYPES[number],
        managerId: form.managerId || null,
        notes: form.notes || null,
      });
      toast({ title: 'Employee updated' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onTerminate = async () => {
    try {
      await terminateEmployee.mutateAsync({ terminationDate: termDate, reason: termReason || undefined });
      toast({ title: 'Employee terminated' });
      setTermOpen(false);
      router.refresh();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const manager = (allActive ?? []).find((m) => m.id === employee.manager_id);
  const isTerminated = employee.employment_status === 'terminated';

  return (
    <div className="space-y-5">
      <Link href="/admin/hr" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All employees
      </Link>

      <PageHeader
        title={`${employee.first_name} ${employee.last_name}`}
        description={`${employee.employee_number} · ${employee.email}`}
        actions={
          !isTerminated && (
            <Dialog open={termOpen} onOpenChange={setTermOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive">Terminate</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Terminate {employee.first_name} {employee.last_name}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="termDate">Termination date *</Label>
                    <Input id="termDate" type="date" value={termDate} onChange={(e) => setTermDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="termReason">Reason</Label>
                    <Textarea id="termReason" rows={3} value={termReason} onChange={(e) => setTermReason(e.target.value)} />
                  </div>
                  {(allActive ?? []).some((e) => e.manager_id === employee.id) && (
                    <p className="text-xs text-muted-foreground">
                      This employee manages others — their reports will be left without a manager.
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="destructive" onClick={onTerminate} disabled={!termDate || terminateEmployee.isPending}>
                    {terminateEmployee.isPending ? 'Terminating…' : 'Confirm termination'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-2">
                <Badge variant={STATUS_VARIANT[employee.employment_status]}>{employee.employment_status.replace('_', ' ')}</Badge>
                {isTerminated && employee.termination_date && (
                  <span className="text-xs text-muted-foreground">since {formatDate(employee.termination_date)}</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="department">Department</Label>
                  <Input id="department" disabled={isTerminated} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="jobTitle">Job title</Label>
                  <Input id="jobTitle" disabled={isTerminated} value={form.jobTitle} onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="employmentType">Employment type</Label>
                  <Select value={form.employmentType} disabled={isTerminated} onValueChange={(v) => setForm((f) => ({ ...f, employmentType: v }))}>
                    <SelectTrigger id="employmentType"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HR_EMPLOYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{EMPLOYMENT_TYPE_LABEL[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Hire date</Label>
                  <p className="flex h-9 items-center text-sm text-muted-foreground">{formatDate(employee.hire_date)}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="managerId">Manager</Label>
                <Select value={form.managerId} disabled={isTerminated} onValueChange={(v) => setForm((f) => ({ ...f, managerId: v }))}>
                  <SelectTrigger id="managerId"><SelectValue placeholder="No manager" /></SelectTrigger>
                  <SelectContent>
                    {(allActive ?? []).filter((m) => m.id !== employee.id).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.first_name} {m.last_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" rows={4} disabled={isTerminated} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>

              {!isTerminated && (
                <Button onClick={onSave} disabled={updateEmployee.isPending}>
                  {updateEmployee.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="text-sm font-medium">Contact</p>
              <p className="text-sm text-muted-foreground">{employee.email}</p>
              {employee.phone && <p className="text-sm text-muted-foreground">{employee.phone}</p>}
              {manager && (
                <>
                  <p className="pt-2 text-sm font-medium">Reports to</p>
                  <Link href={`/admin/hr/${manager.id}`} className="text-sm text-primary hover:underline">
                    {manager.first_name} {manager.last_name}
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
