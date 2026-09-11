/**
 * Personal savings-goal tracker for the (member) portal (migration 103).
 * Deliberately NOT tied to real contributions/GL — the member manually logs
 * progress toward a self-set target, like a savings jar. Every query
 * explicitly scopes by member_id/group_id rather than relying on RLS alone
 * (ADR-001: RLS may still be decorative in production pending the
 * app_tenant cutover).
 */
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError } from '@/lib/utils/errors';
import type { CreateMemberGoalInput, UpdateMemberGoalInput, LogGoalProgressInput } from '@/lib/validators/member-goal.schema';

export interface MemberGoal {
  id:           string;
  name:         string;
  emoji:        string;
  targetAmount: number;
  savedAmount:  number;
  deadline:     string | null;
  status:       'active' | 'achieved' | 'archived';
  createdAt:    Date;
}

interface GoalRow {
  id: string; name: string; emoji: string; target_amount: string; saved_amount: string;
  deadline: string | null; status: 'active' | 'achieved' | 'archived'; created_at: Date;
}

function mapRow(r: GoalRow): MemberGoal {
  return {
    id: r.id, name: r.name, emoji: r.emoji,
    targetAmount: parseFloat(r.target_amount), savedAmount: parseFloat(r.saved_amount),
    deadline: r.deadline, status: r.status, createdAt: r.created_at,
  };
}

export async function listMyGoals(ctx: TenantContext): Promise<MemberGoal[]> {
  return withDb(ctx, async (client) => {
    const { rows } = await client.query<GoalRow>(
      `SELECT * FROM member_goals
       WHERE group_id = $1 AND member_id = $2
       ORDER BY (status = 'active') DESC, deadline ASC NULLS LAST, created_at DESC`,
      [ctx.groupId, ctx.userId],
    );
    return rows.map(mapRow);
  });
}

export async function createGoal(ctx: TenantContext, input: CreateMemberGoalInput): Promise<MemberGoal> {
  return withTransaction(ctx, async (client) => {
    const { rows } = await client.query<GoalRow>(
      `INSERT INTO member_goals (group_id, member_id, name, emoji, target_amount, deadline)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [ctx.groupId, ctx.userId, input.name, input.emoji, input.targetAmount, input.deadline ?? null],
    );
    return mapRow(rows[0]);
  });
}

export async function updateGoal(ctx: TenantContext, id: string, input: UpdateMemberGoalInput): Promise<MemberGoal> {
  return withTransaction(ctx, async (client) => {
    const { rows } = await client.query<GoalRow>(
      `UPDATE member_goals SET
         name          = COALESCE($3, name),
         emoji         = COALESCE($4, emoji),
         target_amount = COALESCE($5, target_amount),
         deadline      = CASE WHEN $6 THEN $7::date ELSE deadline END,
         status        = COALESCE($8, status)
       WHERE id = $1 AND group_id = $9 AND member_id = $2
       RETURNING *`,
      [
        id, ctx.userId, input.name ?? null, input.emoji ?? null, input.targetAmount ?? null,
        'deadline' in input, input.deadline ?? null, input.status ?? null, ctx.groupId,
      ],
    );
    if (!rows[0]) throw new NotFoundError('Goal', id);
    return mapRow(rows[0]);
  });
}

export async function deleteGoal(ctx: TenantContext, id: string): Promise<void> {
  return withTransaction(ctx, async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM member_goals WHERE id = $1 AND group_id = $2 AND member_id = $3`,
      [id, ctx.groupId, ctx.userId],
    );
    if (!rowCount) throw new NotFoundError('Goal', id);
  });
}

/** Atomically increments saved_amount and auto-flips status to 'achieved' at target. */
export async function logProgress(ctx: TenantContext, id: string, input: LogGoalProgressInput): Promise<MemberGoal> {
  return withTransaction(ctx, async (client) => {
    const { rows } = await client.query<GoalRow>(
      `UPDATE member_goals SET
         saved_amount = saved_amount + $4,
         status = CASE WHEN saved_amount + $4 >= target_amount AND status = 'active' THEN 'achieved' ELSE status END
       WHERE id = $1 AND group_id = $2 AND member_id = $3
       RETURNING *`,
      [id, ctx.groupId, ctx.userId, input.amount],
    );
    if (!rows[0]) throw new NotFoundError('Goal', id);
    return mapRow(rows[0]);
  });
}
