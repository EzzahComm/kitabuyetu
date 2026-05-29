import * as React from 'react';
import { ProgressRing } from '@/components/member/progress-ring';
import { formatKES } from '@/lib/utils';
import type { SavingsGoal } from '@/app/(member)/_data';

/**
 * Savings-goal card — a progress ring plus the human framing members actually
 * care about: "how much more to go". Turns an abstract balance into a tangible,
 * motivating target.
 */
export function SavingsGoalCard({ goal }: { goal: SavingsGoal }) {
  const pct = Math.min(100, Math.round((goal.saved / goal.target) * 100));
  const remaining = Math.max(0, goal.target - goal.saved);
  const done = remaining === 0;

  return (
    <div className="flex items-center gap-4 rounded-2xl border bg-card p-4">
      <ProgressRing value={pct} size={64} color={done ? '#16A34A' : '#3CB043'}>
        <span className="text-sm font-bold text-foreground">{pct}%</span>
      </ProgressRing>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span aria-hidden>{goal.emoji}</span>
          <p className="truncate font-semibold text-foreground">{goal.name}</p>
        </div>
        <p className="money mt-0.5 text-sm text-muted-foreground">
          {formatKES(goal.saved)} <span className="text-muted-foreground/60">of</span> {formatKES(goal.target)}
        </p>
        <p className="mt-1 text-xs font-medium text-brand-600">
          {done ? '🎉 Goal reached!' : `${formatKES(remaining)} to go · by ${goal.deadline}`}
        </p>
      </div>
    </div>
  );
}
