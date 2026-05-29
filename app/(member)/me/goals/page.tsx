'use client';

import * as React from 'react';
import { Plus, Target } from 'lucide-react';
import { SavingsGoalCard } from '@/components/member/savings-goal-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatKES } from '@/lib/utils';
import { goals } from '../../_data';

export default function GoalsPage() {
  const totalSaved = goals.reduce((a, g) => a + g.saved, 0);
  const totalTarget = goals.reduce((a, g) => a + g.target, 0);

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

      {goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet"
          description="Set a target — school fees, stock, an emergency fund — and we'll help you track every step."
          action={<Button><Plus className="h-4 w-4" /> Create a goal</Button>}
        />
      ) : (
        <>
          {/* Summary */}
          <div className="rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-4 text-white">
            <p className="text-sm text-white/80">Total saved across goals</p>
            <p className="money mt-1 text-3xl font-bold">{formatKES(totalSaved)}</p>
            <p className="mt-0.5 text-xs text-white/70">of {formatKES(totalTarget)} target</p>
          </div>

          <div className="space-y-3">
            {goals.map((g) => <SavingsGoalCard key={g.id} goal={g} />)}
          </div>

          <Button variant="outline" className="w-full">
            <Plus className="h-4 w-4" /> Add new goal
          </Button>
        </>
      )}
    </div>
  );
}
