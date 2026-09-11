'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MemberGoal } from '@/lib/services/member-goals.service';

const schema = z.object({
  amount: z.coerce.number().positive('Enter an amount greater than 0'),
});

type FormValues = z.infer<typeof schema>;

interface GoalProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: MemberGoal | null;
  onSubmit: (amount: number) => Promise<void>;
}

/** Logs a manual progress entry toward a savings goal — personal tracking, not a real transaction. */
export function GoalProgressDialog({ open, onOpenChange, goal, onSubmit }: GoalProgressDialogProps) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const submit = async (values: FormValues) => {
    await onSubmit(values.amount);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add progress{goal ? ` — ${goal.name}` : ''}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="amount">Amount (KES)</Label>
            <Input id="amount" type="number" min={1} step="0.01" autoFocus {...register('amount')} />
            {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={isSubmitting}>Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
