'use client';

import * as React from 'react';
import { Plus, Target } from 'lucide-react';
import { SavingsGoalCard } from '@/components/member/savings-goal-card';
import { GoalFormDialog } from '@/components/member/goal-form-dialog';
import { GoalProgressDialog } from '@/components/member/goal-progress-dialog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListSkeleton } from '@/components/shared/skeletons';
import { useToast } from '@/hooks/use-toast';
import {
  useMyGoals, useCreateGoal, useUpdateGoal, useDeleteGoal, useLogGoalProgress,
} from '@/hooks/use-member';
import { formatKES, getErrorMessage } from '@/lib/utils';
import type { MemberGoal } from '@/lib/services/member-goals.service';

export default function GoalsPage() {
  const { data: goals, isLoading, isError, error } = useMyGoals();
  const { toast } = useToast();

  const [formOpen, setFormOpen]         = React.useState(false);
  const [editingGoal, setEditingGoal]   = React.useState<MemberGoal | null>(null);
  const [progressGoal, setProgressGoal] = React.useState<MemberGoal | null>(null);

  const createGoal   = useCreateGoal();
  const updateGoal   = useUpdateGoal(editingGoal?.id ?? '');
  const deleteGoal   = useDeleteGoal();
  const logProgress  = useLogGoalProgress(progressGoal?.id ?? '');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <Target size={20} className="text-brand-600" /> Savings goals
        </h1>
        <ListSkeleton rows={3} />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={Target}
        title="Could not load your goals"
        description={getErrorMessage(error)}
      />
    );
  }

  const items = goals ?? [];
  const totalSaved  = items.reduce((a, g) => a + g.savedAmount, 0);
  const totalTarget = items.reduce((a, g) => a + g.targetAmount, 0);

  const openCreate = () => { setEditingGoal(null); setFormOpen(true); };
  const openEdit   = (g: MemberGoal) => { setEditingGoal(g); setFormOpen(true); };

  const submitForm = async (values: { name: string; emoji: string; targetAmount: number; deadline: string | null }) => {
    try {
      if (editingGoal) {
        await updateGoal.mutateAsync(values);
        toast({ title: 'Goal updated' });
      } else {
        await createGoal.mutateAsync(values);
        toast({ title: 'Goal created' });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not save goal', description: getErrorMessage(err) });
    }
  };

  const submitProgress = async (amount: number) => {
    try {
      await logProgress.mutateAsync({ amount });
      toast({ title: 'Progress added' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not add progress', description: getErrorMessage(err) });
    }
  };

  const doDelete = async (g: MemberGoal) => {
    try {
      await deleteGoal.mutateAsync(g.id);
      toast({ title: 'Goal deleted' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not delete goal', description: getErrorMessage(err) });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Target size={20} className="text-brand-600" /> Savings goals
          </h1>
          <p className="text-xs text-muted-foreground">Save towards what matters to you</p>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet"
          description="Set a target — school fees, stock, an emergency fund — and we'll help you track every step."
          action={<Button onClick={openCreate}><Plus className="h-4 w-4" /> Create a goal</Button>}
        />
      ) : (
        <>
          <div className="rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-4 text-white">
            <p className="text-sm text-white/80">Total saved across goals</p>
            <p className="money mt-1 text-3xl font-bold">{formatKES(totalSaved)}</p>
            <p className="mt-0.5 text-xs text-white/70">of {formatKES(totalTarget)} target</p>
          </div>

          <div className="space-y-3">
            {items.map((g) => (
              <SavingsGoalCard
                key={g.id}
                goal={g}
                onLogProgress={setProgressGoal}
                onEdit={openEdit}
                onDelete={doDelete}
              />
            ))}
          </div>

          <Button variant="outline" className="w-full" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add new goal
          </Button>
        </>
      )}

      <GoalFormDialog open={formOpen} onOpenChange={setFormOpen} goal={editingGoal} onSubmit={submitForm} />
      <GoalProgressDialog
        open={!!progressGoal}
        onOpenChange={(o) => !o && setProgressGoal(null)}
        goal={progressGoal}
        onSubmit={submitProgress}
      />
    </div>
  );
}
