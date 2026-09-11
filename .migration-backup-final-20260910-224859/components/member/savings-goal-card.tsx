import * as React from 'react';
import { MoreHorizontal, PlusCircle, Pencil, Trash2 } from 'lucide-react';
import { ProgressRing } from '@/components/member/progress-ring';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatKES, formatDate } from '@/lib/utils';
import type { MemberGoal } from '@/lib/services/member-goals.service';

interface SavingsGoalCardProps {
  goal: MemberGoal;
  onLogProgress?: (goal: MemberGoal) => void;
  onEdit?: (goal: MemberGoal) => void;
  onDelete?: (goal: MemberGoal) => void;
}

/**
 * Savings-goal card — a progress ring plus the human framing members actually
 * care about: "how much more to go". Turns an abstract balance into a tangible,
 * motivating target. Action affordances (log progress/edit/delete) are
 * optional so the same card works read-only (e.g. the home page's top-goal
 * teaser) and fully interactive (the goals list page).
 */
export function SavingsGoalCard({ goal, onLogProgress, onEdit, onDelete }: SavingsGoalCardProps) {
  const pct = Math.min(100, Math.round((goal.savedAmount / goal.targetAmount) * 100));
  const remaining = Math.max(0, goal.targetAmount - goal.savedAmount);
  const done = goal.status === 'achieved' || remaining === 0;
  const hasActions = onLogProgress || onEdit || onDelete;

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
          {formatKES(goal.savedAmount)} <span className="text-muted-foreground/60">of</span> {formatKES(goal.targetAmount)}
        </p>
        <p className="mt-1 text-xs font-medium text-brand-600">
          {done ? '🎉 Goal reached!' : `${formatKES(remaining)} to go · by ${goal.deadline ? formatDate(goal.deadline) : 'Ongoing'}`}
        </p>
      </div>
      {hasActions && (
        <div className="flex shrink-0 items-center gap-1">
          {onLogProgress && !done && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onLogProgress(goal)} aria-label="Add progress">
              <PlusCircle size={16} />
            </Button>
          )}
          {(onEdit || onDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More options">
                  <MoreHorizontal size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onEdit && (
                  <DropdownMenuItem onClick={() => onEdit(goal)}>
                    <Pencil size={14} className="mr-2" /> Edit
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <DropdownMenuItem onClick={() => onDelete(goal)} className="text-destructive focus:text-destructive">
                    <Trash2 size={14} className="mr-2" /> Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );
}
