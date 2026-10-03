'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { useEmployees, useCreateEmployee } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import { HR_EMPLOYMENT_TYPES, HR_EMPLOYMENT_STATUSES } from '@/lib/validators/hr.schema';

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  intern: 'Intern',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  active: 'default',
  on_leave: 'secondary',
  suspended: 'destructive',
  terminated: 'outline',
};

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  department: '',
  jobTitle: '',
  employmentType: 'full_time',
  hireDate: '',
  managerId: '',
  notes: '',
};

export default function HrEmployeesPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const { data: employees, isLoading } = useEmployees({ status: status || undefined, search: search || undefined });
  const { data: allActive } = useEmployees({ status: 'active' });
  const createEmployee = useCreateEmployee();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const activeCount = employees?.filter((e) => e.employment_status === 'active').length ?? 0;
  const onLeaveCount = employees?.filter((e) => e.employment_status === 'on_leave').length ?? 0;

  const onCreate = async () => {
    try {
      await createEmployee.mutateAsync({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone || undefined,
        department: form.department || undefined,
        jobTitle: form.jobTitle || undefined,
        employmentType: form.employmentType as (typeof HR_EMPLOYMENT_TYPES)[number],
        hireDate: form.hireDate,
        managerId: form.managerId || undefined,
        notes: form.notes || undefined,
      });
      toast({ title: 'Employee added' });
      setForm(EMPTY_FORM);
      setOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const valid = form.firstName.trim() && form.lastName.trim() && form.email.trim() && form.hireDate;

  return (
    <div className="space-y-5">
      <PageHeader
        title="HR — Employees"
        description="Kitabu Yetu's internal team directory."
        actions={
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) setForm(EMPTY_FORM);
            }}
          >
            <DialogTrigger asChild>
              <Button>Add employee</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Add employee</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName">First name *</Label>
                    <Input
                      id="firstName"
                      value={form.firstName}
                      onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName">Last name *</Label>
                    <Input
                      id="lastName"
                      value={form.lastName}
                      onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="department">Department</Label>
                    <Input
                      id="department"
                      value={form.department}
                      onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="jobTitle">Job title</Label>
                    <Input
                      id="jobTitle"
                      value={form.jobTitle}
                      onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="employmentType">Employment type</Label>
                    <Select
                      value={form.employmentType}
                      onValueChange={(v) => setForm((f) => ({ ...f, employmentType: v }))}
                    >
                      <SelectTrigger id="employmentType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {HR_EMPLOYMENT_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {EMPLOYMENT_TYPE_LABEL[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hireDate">Hire date *</Label>
                    <Input
                      id="hireDate"
                      type="date"
                      value={form.hireDate}
                      onChange={(e) => setForm((f) => ({ ...f, hireDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="managerId">Manager</Label>
                  <Select value={form.managerId} onValueChange={(v) => setForm((f) => ({ ...f, managerId: v }))}>
                    <SelectTrigger id="managerId">
                      <SelectValue placeholder="No manager" />
                    </SelectTrigger>
                    <SelectContent>
                      {(allActive ?? []).map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.first_name} {m.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={onCreate} disabled={!valid || createEmployee.isPending}>
                  {createEmployee.isPending ? 'Adding…' : 'Add employee'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="Active" value={activeCount} icon={Users} accent="green" />
        <StatCard title="On leave" value={onLeaveCount} icon={Users} accent="orange" />
        <StatCard title="Total shown" value={employees?.length ?? 0} icon={Users} accent="blue" />
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[180px] max-w-xs flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email…"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">All statuses</option>
              {HR_EMPLOYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : !employees || employees.length === 0 ? (
            <p className="p-16 text-center text-sm text-muted-foreground">No employees match these filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee #</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((e) => (
                  <TableRow key={e.id} className="cursor-pointer">
                    <TableCell>
                      <Link
                        href={`/admin/hr/${e.id}`}
                        className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {e.employee_number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/admin/hr/${e.id}`} className="font-medium hover:underline">
                        {e.first_name} {e.last_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{e.email}</p>
                    </TableCell>
                    <TableCell>{e.department ?? '—'}</TableCell>
                    <TableCell>{e.job_title ?? '—'}</TableCell>
                    <TableCell>{EMPLOYMENT_TYPE_LABEL[e.employment_type]}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[e.employment_status]}>
                        {e.employment_status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
