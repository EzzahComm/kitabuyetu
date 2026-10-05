'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useOnboardingTasks, useAddOnboardingTask, useUpdateOnboardingTask } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage, formatDate } from '@/lib/utils';
import { HR_ONBOARDING_TASK_STATUSES } from '@/lib/validators/hr-onboarding.schema';
import type { OnboardingTask } from '@/lib/services/hr-onboarding.service';

type TaskStatus = (typeof HR_ONBOARDING_TASK_STATUSES)[number];

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done',
  skipped: 'Skipped',
};

const STATUS_VARIANT: Record<TaskStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending: 'outline',
  in_progress: 'secondary',
  done: 'default',
  skipped: 'destructive',
};

const EMPTY_FORM = { category: '', title: '', description: '', dueDate: '' };

function isOverdue(dueDate: string | null, status: TaskStatus): boolean {
  if (!dueDate || status === 'done' || status === 'skipped') return false;
  return dueDate < new Date().toISOString().slice(0, 10);
}

function TaskRow({ employeeId, task }: { employeeId: string; task: OnboardingTask }) {
  const { toast } = useToast();
  const updateTask = useUpdateOnboardingTask(employeeId, task.id);

  const onStatusChange = async (status: string) => {
    try {
      await updateTask.mutateAsync({ status: status as TaskStatus });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="flex items-start gap-3 border-b border-border py-3 last:border-0">
      <Select value={task.status} onValueChange={onStatusChange} disabled={updateTask.isPending}>
        <SelectTrigger className="h-8 w-[130px] shrink-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HR_ONBOARDING_TASK_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm font-medium ${task.status === 'done' || task.status === 'skipped' ? 'text-muted-foreground line-through' : ''}`}>
            {task.title}
          </p>
          <Badge variant={STATUS_VARIANT[task.status]} className="text-[10px]">
            {task.category}
          </Badge>
        </div>
        {task.description && <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>}
        {task.due_date && (
          <p className={`mt-0.5 text-xs ${isOverdue(task.due_date, task.status) ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
            Due {formatDate(task.due_date)}
            {isOverdue(task.due_date, task.status) && ' · overdue'}
          </p>
        )}
      </div>
    </div>
  );
}

export function OnboardingChecklist({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const { data: tasks, isLoading } = useOnboardingTasks(employeeId);
  const addTask = useAddOnboardingTask(employeeId);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const total = tasks?.length ?? 0;
  const done = tasks?.filter((t) => t.status === 'done').length ?? 0;
  const progressPct = total ? Math.round((done / total) * 100) : 0;

  const onAdd = async () => {
    try {
      await addTask.mutateAsync({
        category: form.category,
        title: form.title,
        description: form.description || undefined,
        dueDate: form.dueDate || undefined,
      });
      toast({ title: 'Task added' });
      setForm(EMPTY_FORM);
      setOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const valid = form.category.trim() && form.title.trim();

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Onboarding</p>
            <p className="text-xs text-muted-foreground">
              {total ? `${done} of ${total} tasks done` : 'No checklist yet'}
            </p>
          </div>
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) setForm(EMPTY_FORM);
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                Add task
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add onboarding task</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="taskCategory">Category *</Label>
                    <Input
                      id="taskCategory"
                      placeholder="e.g. Equipment"
                      value={form.category}
                      onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="taskDueDate">Due date</Label>
                    <Input
                      id="taskDueDate"
                      type="date"
                      value={form.dueDate}
                      onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="taskTitle">Title *</Label>
                  <Input
                    id="taskTitle"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="taskDescription">Description</Label>
                  <Textarea
                    id="taskDescription"
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={onAdd} disabled={!valid || addTask.isPending}>
                  {addTask.isPending ? 'Adding…' : 'Add task'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {total > 0 && <Progress value={progressPct} />}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !tasks || tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No onboarding tasks for this employee.</p>
        ) : (
          <div>
            {tasks.map((task) => (
              <TaskRow key={task.id} employeeId={employeeId} task={task} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
