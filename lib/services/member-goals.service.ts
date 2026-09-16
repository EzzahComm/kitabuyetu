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

    if (rows[0]) {
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, 'member_goal', $4, NULL, $5)`,
        [
          ctx.groupId,
          ctx.userId,
          'goal.created',
          rows[0].id,
          JSON.stringify({
            name: input.name,
            emoji: input.emoji,
            target_amount: input.targetAmount,
            deadline: input.deadline,
          }),
        ],
      );
    }

    return mapRow(rows[0]);
  });
}

export async function updateGoal(ctx: TenantContext, id: string, input: UpdateMemberGoalInput): Promise<MemberGoal> {
  return withTransaction(ctx, async (client) => {
    // Get old values before update for audit log
    const { rows: oldRows } = await client.query<GoalRow>(
      `SELECT * FROM member_goals WHERE id = $1 AND group_id = $2 AND member_id = $3`,
      [id, ctx.groupId, ctx.userId],
    );
    const oldGoal = oldRows[0];

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

    // Audit the update
    if (oldGoal && rows[0]) {
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, 'member_goal', $4, $5, $6)`,
        [
          ctx.groupId,
          ctx.userId,
          'goal.updated',
          id,
          JSON.stringify({
            name: oldGoal.name,
            emoji: oldGoal.emoji,
            target_amount: oldGoal.target_amount,
            deadline: oldGoal.deadline,
            status: oldGoal.status,
          }),
          JSON.stringify({
            name: rows[0].name,
            emoji: rows[0].emoji,
            target_amount: rows[0].target_amount,
            deadline: rows[0].deadline,
            status: rows[0].status,
          }),
        ],
      );
    }

    return mapRow(rows[0]);
  });
}

export async function deleteGoal(ctx: TenantContext, id: string): Promise<void> {
  return withTransaction(ctx, async (client) => {
    // Get goal details before delete for audit
    const { rows: oldRows } = await client.query<GoalRow>(
      `SELECT * FROM member_goals WHERE id = $1 AND group_id = $2 AND member_id = $3`,
      [id, ctx.groupId, ctx.userId],
    );
    const oldGoal = oldRows[0];
    if (!oldGoal) throw new NotFoundError('Goal', id);

    const { rowCount } = await client.query(
      `DELETE FROM member_goals WHERE id = $1 AND group_id = $2 AND member_id = $3`,
      [id, ctx.groupId, ctx.userId],
    );
    if (!rowCount) throw new NotFoundError('Goal', id);

    // Audit the deletion
    await client.query(
      `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
       VALUES ($1, $2, $3, 'member_goal', $4, $5, NULL)`,
      [
        ctx.groupId,
        ctx.userId,
        'goal.deleted',
        id,
        JSON.stringify({
          name: oldGoal.name,
          emoji: oldGoal.emoji,
          target_amount: oldGoal.target_amount,
          deadline: oldGoal.deadline,
          status: oldGoal.status,
        }),
      ],
    );
  });
}

/** Atomically increments saved_amount and auto-flips status to 'achieved' at target. */
export async function logProgress(ctx: TenantContext, id: string, input: LogGoalProgressInput): Promise<MemberGoal> {
  return withTransaction(ctx, async (client) => {
    // Get old values before update
    const { rows: oldRows } = await client.query<GoalRow>(
      `SELECT * FROM member_goals WHERE id = $1 AND group_id = $2 AND member_id = $3`,
      [id, ctx.groupId, ctx.userId],
    );
    const oldGoal = oldRows[0];

    const { rows } = await client.query<GoalRow>(
      `UPDATE member_goals SET
         saved_amount = saved_amount + $4,
         status = CASE WHEN saved_amount + $4 >= target_amount AND status = 'active' THEN 'achieved' ELSE status END
       WHERE id = $1 AND group_id = $2 AND member_id = $3
       RETURNING *`,
      [id, ctx.groupId, ctx.userId, input.amount],
    );
    if (!rows[0]) throw new NotFoundError('Goal', id);

    // Audit progress log
    if (oldGoal && rows[0]) {
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, 'member_goal', $4, $5, $6)`,
        [
          ctx.groupId,
          ctx.userId,
          'goal.progress_logged',
          id,
          JSON.stringify({
            saved_amount: oldGoal.saved_amount,
            status: oldGoal.status,
          }),
          JSON.stringify({
            saved_amount: rows[0].saved_amount,
            status: rows[0].status,
            amount_logged: input.amount,
          }),
        ],
      );
    }

    return mapRow(rows[0]);
  });
}
