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
  name:         z.string().min(1, 'Name required').max(100),
  emoji:        z.string().min(1).max(8),
  targetAmount: z.coerce.number().positive('Target must be greater than 0'),
  deadline:     z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface GoalFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing goal; absent when creating a new one. */
  goal?: MemberGoal | null;
  onSubmit: (values: { name: string; emoji: string; targetAmount: number; deadline: string | null }) => Promise<void>;
}

/** Create/edit dialog for a personal savings goal. */
export function GoalFormDialog({ open, onOpenChange, goal, onSubmit }: GoalFormDialogProps) {
  const isEdit = !!goal;
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      name:         goal?.name ?? '',
      emoji:        goal?.emoji ?? '🎯',
      targetAmount: goal?.targetAmount ?? 0,
      deadline:     goal?.deadline ?? '',
    },
  });

  const submit = async (values: FormValues) => {
    await onSubmit({
      name: values.name, emoji: values.emoji, targetAmount: values.targetAmount,
      deadline: values.deadline || null,
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? 'Edit goal' : 'New savings goal'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="space-y-3">
          <div className="grid grid-cols-[4rem,1fr] gap-3">
            <div className="space-y-1">
              <Label htmlFor="emoji">Icon</Label>
              <Input id="emoji" {...register('emoji')} className="text-center text-lg" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="School fees" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="targetAmount">Target amount (KES)</Label>
            <Input id="targetAmount" type="number" min={1} step="0.01" {...register('targetAmount')} />
            {errors.targetAmount && <p className="text-xs text-destructive">{errors.targetAmount.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="deadline">Deadline (optional)</Label>
            <Input id="deadline" type="date" {...register('deadline')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={isSubmitting}>{isEdit ? 'Save changes' : 'Create goal'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
