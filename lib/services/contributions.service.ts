import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ConflictError } from '@/lib/utils/errors';
import { assertActiveMembership } from './membership-guard';
import type { Contribution, PaginatedResult } from '@/types/db.types';
import type { CreateContributionInput, UpdateContributionInput, ContributionQueryInput } from '@/lib/validators/contribution.schema';
import { postContributionJournal } from './accounting.service';
import { sendContributionConfirmation } from './notification-email.service';
import { SMS_EVENTS } from '@/lib/sms/events';
import { logger } from '@/lib/logger';

export const contributionsService = {

  async list(ctx: TenantContext, params: ContributionQueryInput): Promise<PaginatedResult<Contribution & { member_name: string }>> {
    return withDb(ctx, async (client) => {
      const { page, limit, memberId, status, from, to, sortDir } = params;
      const offset = (page - 1) * limit;

      const conditions: string[] = ['c.group_id = $1'];
      const values: unknown[] = [ctx.groupId];
      let idx = 2;

      if (memberId) { conditions.push(`c.member_id = $${idx++}`);                              values.push(memberId); }
      if (status)   { conditions.push(`c.status = $${idx++}`);                                 values.push(status); }
      if (from)     { conditions.push(`c.contribution_date >= $${idx++}`);                     values.push(from); }
      if (to)       { conditions.push(`c.contribution_date <= $${idx++}`);                     values.push(to); }

      const where   = conditions.join(' AND ');
      const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC';

      const [{ rows: countRows }, { rows }] = await Promise.all([
        client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM contributions c WHERE ${where}`, values,
        ),
        client.query<Contribution & { member_name: string }>(
          `SELECT c.*,
                  m.first_name || ' ' || m.last_name AS member_name
           FROM contributions c
           JOIN members m ON m.id = c.member_id
           WHERE ${where}
           ORDER BY c.contribution_date ${orderDir}
           LIMIT $${idx} OFFSET $${idx + 1}`,
          [...values, limit, offset],
        ),
      ]);
      const total = parseInt(countRows[0].count, 10);

      return { items: rows, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
    });
  },

  // Active members with no completed contribution in the current calendar month.
  // Powers the treasurer home "needs you now" list. Only ever returns a
  // 5-row sample + a count — COUNT(*) OVER () computes the true total over
  // every matching row before LIMIT trims the output, so this needs one
  // query and one round trip instead of materializing the full non-
  // contributor set to then slice it in JS (docs/audits/optimization-2026-09).
  async nonContributors(ctx: TenantContext): Promise<{ count: number; sample: { id: string; name: string }[] }> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<{ id: string; name: string; total_count: string }>(
        `SELECT m.id, m.first_name || ' ' || m.last_name AS name,
                COUNT(*) OVER () AS total_count
         FROM group_members gm
         JOIN members m ON m.id = gm.member_id
         WHERE gm.group_id = $1
           AND gm.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM contributions c
             WHERE c.member_id = m.id
               AND c.group_id = $1
               AND c.status = 'completed'
               AND c.contribution_date >= date_trunc('month', CURRENT_DATE)
           )
         ORDER BY m.first_name, m.last_name
         LIMIT 5`,
        [ctx.groupId],
      );
      return {
        count: rows.length ? parseInt(rows[0].total_count, 10) : 0,
        sample: rows.map(({ id, name }) => ({ id, name })),
      };
    });
  },

  // Ad-hoc "Remind" action on the dashboard's non-contributors task row — an
  // officer-triggered nudge for the *current*, still-open month. Deliberately
  // a distinct referenceType/reminderStage from the scheduled
  // `notify_contribution_reminders` job (lib/jobs/handlers.ts), which flags
  // the *previous*, already-closed month: sharing a stage key would let this
  // button's send silently satisfy that job's own once-per-month claim (or
  // vice versa) via reminder_dispatch_log's UNIQUE constraint, suppressing a
  // real reminder neither action actually sent. Idempotent per (member,
  // month) regardless — clicking twice in the same month only sends once.
  async remindNonContributors(ctx: TenantContext): Promise<{ attempted: number; sent: number; skipped: number; failed: number }> {
    const { rows } = await withDb(ctx, (client) =>
      client.query<{
        membership_id: string; member_id: string; phone: string;
        first_name: string; group_name: string; period_key: string; month_label: string;
        membership_no: string;
      }>(
        `SELECT gm.id AS membership_id, gm.member_id, m.phone, m.first_name, g.name AS group_name,
                to_char(CURRENT_DATE, 'YYYY-MM') AS period_key,
                to_char(CURRENT_DATE, 'Mon YYYY') AS month_label,
                gm.membership_no
         FROM group_members gm
         JOIN members m ON m.id = gm.member_id
         JOIN groups  g ON g.id = gm.group_id
         WHERE gm.group_id = $1
           AND gm.status = 'active'
           AND m.phone IS NOT NULL AND m.phone <> ''
           AND NOT EXISTS (
             SELECT 1 FROM contributions c
             WHERE c.member_id = m.id
               AND c.group_id = $1
               AND c.status = 'completed'
               AND c.contribution_date >= date_trunc('month', CURRENT_DATE)
           )
         ORDER BY m.first_name, m.last_name`,
        [ctx.groupId],
      ),
    );

    if (rows.length === 0) {
      return { attempted: 0, sent: 0, skipped: 0, failed: 0 };
    }

    const { renderTemplate, platformPaybill, DEFAULT_TEMPLATES, TEMPLATE_KEYS } =
      await import('@/lib/sms/templates');
    const { sendOnce } = await import('./reminder.service');
    // The body and the paybill lookup both used to live here as literals,
    // duplicated in lib/jobs/handlers.ts and mpesa-stk.service.ts — so a
    // wording or shortcode change had to be made three times or the three
    // silently diverged. Both now have one home, and the template is
    // customisable by a group like every other one.
    const paybill = platformPaybill();
    const template = DEFAULT_TEMPLATES[TEMPLATE_KEYS.CONTRIBUTION_REMINDER];

    let sent = 0, skipped = 0, failed = 0;
    for (const r of rows) {
      const result = await sendOnce({
        groupId:       ctx.groupId,
        memberId:      r.member_id,
        phone:         r.phone,
        body:          renderTemplate(template, {
          first_name:     r.first_name,
          group_name:     r.group_name,
          month:          r.month_label,
          paybill,
          // No product suffix — a bare membership_no is the contribution/
          // savings account reference (lib/utils/membership-no.ts's
          // ParsedAccountRef: -L/-W/-S are loan/welfare/shares; the base
          // number alone is what mpesa-c2b.service.ts's matcher treats as
          // the default, i.e. contributions).
          //
          // Passed as membership_no, the CANONICAL name. `{{account_number}}`,
          // `{{payment_account}}` and `{{short_member_id}}` all resolve to it
          // through VARIABLE_ALIASES, so a group may write whichever reads
          // best without anything having to keep a second copy in step.
          membership_no: r.membership_no,
        }),
        referenceType:  'contribution_nudge',
        referenceId:    r.membership_id,
        reminderStage:  `contribution_nudge:${r.period_key}`,
        // Phase 2b (docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md Decision
        // B): bundled allowance now exists, so this real send-path bills,
        // same as the scheduled reminder it mirrors.
        billingMode:    'billed',
      });
      if (result.sent) sent++;
      // 'cooldown' defers rather than fails — see the identical note in
      // lib/jobs/handlers.ts.
      else if (result.status === 'already_sent' || result.status === 'already_suppressed'
               || result.status === 'cooldown') skipped++;
      else failed++;
    }

    return { attempted: rows.length, sent, skipped, failed };
  },

  async getById(ctx: TenantContext, id: string): Promise<Contribution & { member_name: string }> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<Contribution & { member_name: string }>(
        `SELECT c.*, m.first_name || ' ' || m.last_name AS member_name
         FROM contributions c
         JOIN members m ON m.id = c.member_id
         WHERE c.id = $1 AND c.group_id = $2`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Contribution', id);
      return rows[0];
    });
  },

  async create(ctx: TenantContext, data: CreateContributionInput): Promise<Contribution> {
    return withTransaction(ctx, async (client) => {
      // The target member must hold an active membership in THIS group —
      // RLS scopes group_id but never member_id (audit H-1). The returned
      // membership id is stamped on the row (§6a): validation and
      // attribution are the same act.
      const { membershipId } = await assertActiveMembership(client, ctx.groupId, data.memberId);

      if (data.mpesaReceiptNumber) {
        const dup = await client.query(
          'SELECT id FROM contributions WHERE mpesa_receipt_number = $1',
          [data.mpesaReceiptNumber],
        );
        if (dup.rows[0]) throw new ConflictError(`M-Pesa receipt ${data.mpesaReceiptNumber} already recorded`);
      }

      const { rows } = await client.query<Contribution>(
        `INSERT INTO contributions
           (group_id, member_id, group_membership_id, amount, contribution_date, due_date,
            status, payment_method, mpesa_receipt_number, notes, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          ctx.groupId, data.memberId, membershipId, data.amount.toFixed(2),
          data.contributionDate, data.dueDate ?? null,
          data.paymentMethod ? 'completed' : 'pending',
          data.paymentMethod ?? null,
          data.mpesaReceiptNumber ?? null,
          data.notes ?? null,
          ctx.userId,
        ],
      );

      const contribution = rows[0];

      // Record audit log entry (atomic with the contribution insert)
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId,
          ctx.userId,
          'contribution.create',
          'contribution',
          contribution.id,
          null,
          JSON.stringify({
            id: contribution.id,
            amount: contribution.amount,
            contribution_date: contribution.contribution_date,
            status: contribution.status,
            payment_method: contribution.payment_method,
            mpesa_receipt_number: contribution.mpesa_receipt_number,
          }),
        ],
      );

      // Auto-post a journal entry when the contribution is completed on creation
      if (contribution.status === 'completed') {
        await postContributionJournal(client, {
          groupId: ctx.groupId, contributionId: contribution.id, amount: parseFloat(contribution.amount),
          entryDate: contribution.contribution_date, reference: contribution.mpesa_receipt_number, createdBy: ctx.userId,
        });

        // Emit event for trigger engine (best-effort, never throws)
        const { emitBusinessEvent } = await import('@/lib/sms/trigger-engine');
        await emitBusinessEvent({
          eventType: SMS_EVENTS.CONTRIBUTION_RECORDED,
          eventId: contribution.id,
          groupId: ctx.groupId,
          payload: {
            amount: parseFloat(contribution.amount),
            memberId: data.memberId,
            contributionDate: contribution.contribution_date.toISOString().split('T')[0],
            paymentMethod: contribution.payment_method ?? 'manual',
          },
          actorId: ctx.userId,
        }).catch((err) => logger.warn('[contributions] event emit failed', { contributionId: contribution.id, error: (err as Error).message }));
      }

      return contribution;
    });
  },

  /**
   * Best-effort: email the member their React Email contribution receipt.
   * Never throws — a missing/failed email must never affect the contribution.
   * Only fires for completed contributions.
   */
  async notifyReceipt(ctx: TenantContext, contribution: Contribution): Promise<void> {
    if (contribution.status !== 'completed') return;
    try {
      const data = await withDb(ctx, async (client) => {
        const { rows } = await client.query<{
          email: string | null; member_name: string; group_name: string; total: string;
        }>(
          `SELECT m.email,
                  m.first_name || ' ' || m.last_name AS member_name,
                  g.name AS group_name,
                  COALESCE((SELECT SUM(amount) FROM contributions c
                            WHERE c.member_id = m.id AND c.group_id = $2 AND c.status = 'completed'), 0) AS total
           FROM members m JOIN groups g ON g.id = $2
           WHERE m.id = $1 AND m.group_id = $2`,
          [contribution.member_id, ctx.groupId],
        );
        return rows[0];
      });
      if (!data?.email) return;

      const when = new Date(contribution.contribution_date);
      await sendContributionConfirmation({
        email: data.email,
        memberName: data.member_name,
        amount: String(contribution.amount),
        periodLabel: when.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' }),
        reference: contribution.mpesa_receipt_number ?? '',
        date: when.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }),
        paymentMethod: contribution.payment_method ?? 'mpesa',
        totalContributions: String(data.total),
        groupId: ctx.groupId,
        memberId: contribution.member_id,
        contributionId: contribution.id,
        groupName: data.group_name,
        status: 'completed',
      });
    } catch (err) {
      logger.warn('[contributions] receipt email failed', { contributionId: contribution.id, error: (err as Error).message });
    }
  },

  async update(ctx: TenantContext, id: string, data: UpdateContributionInput): Promise<Contribution> {
    return withTransaction(ctx, async (client) => {
      const { rows: existing } = await client.query<Contribution>(
        'SELECT * FROM contributions WHERE id = $1 AND group_id = $2',
        [id, ctx.groupId],
      );
      if (!existing[0]) throw new NotFoundError('Contribution', id);

      const prev = existing[0];

      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (data.status  !== undefined) { sets.push(`status = $${idx++}`);               values.push(data.status); }
      if (data.paymentMethod !== undefined) { sets.push(`payment_method = $${idx++}`); values.push(data.paymentMethod); }
      if (data.mpesaReceiptNumber !== undefined) {
        sets.push(`mpesa_receipt_number = $${idx++}`);
        values.push(data.mpesaReceiptNumber);
      }
      if (data.notes !== undefined) { sets.push(`notes = $${idx++}`);                  values.push(data.notes); }

      if (!sets.length) return prev;

      values.push(id);
      const { rows } = await client.query<Contribution>(
        `UPDATE contributions SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        values,
      );
      const updated = rows[0];

      // Record audit log entry for the update (atomic with the update)
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId,
          ctx.userId,
          'contribution.update',
          'contribution',
          updated.id,
          JSON.stringify({
            status: prev.status,
            payment_method: prev.payment_method,
            mpesa_receipt_number: prev.mpesa_receipt_number,
            notes: prev.notes,
          }),
          JSON.stringify({
            status: updated.status,
            payment_method: updated.payment_method,
            mpesa_receipt_number: updated.mpesa_receipt_number,
            notes: updated.notes,
          }),
        ],
      );

      // Post journal when status transitions to completed
      if (updated.status === 'completed' && prev.status !== 'completed') {
        await postContributionJournal(client, {
          groupId: ctx.groupId, contributionId: updated.id, amount: parseFloat(updated.amount),
          entryDate: updated.contribution_date, reference: updated.mpesa_receipt_number, createdBy: ctx.userId,
        });

        // Emit event for trigger engine (best-effort, never throws)
        const { emitBusinessEvent } = await import('@/lib/sms/trigger-engine');
        await emitBusinessEvent({
          eventType: SMS_EVENTS.CONTRIBUTION_RECORDED,
          eventId: updated.id,
          groupId: ctx.groupId,
          payload: {
            amount: parseFloat(updated.amount),
            memberId: updated.member_id,
            contributionDate: updated.contribution_date.toISOString().split('T')[0],
            paymentMethod: updated.payment_method ?? 'manual',
          },
          actorId: ctx.userId,
        }).catch((err) => logger.warn('[contributions] event emit failed', { contributionId: updated.id, error: (err as Error).message }));
      }

      return updated;
    });
  },

  // Soft-delete only: financial records must never be physically removed.
  // Only pending contributions can be cancelled; completed ones are immutable.
  async delete(ctx: TenantContext, id: string): Promise<void> {
    return withTransaction(ctx, async (client) => {
      const { rows: existing } = await client.query<Contribution>(
        `SELECT * FROM contributions WHERE id = $1 AND group_id = $2 AND status = 'pending'`,
        [id, ctx.groupId],
      );
      if (!existing[0]) throw new NotFoundError('Pending contribution', id);

      const prev = existing[0];

      await client.query(
        `UPDATE contributions SET status = 'cancelled' WHERE id = $1 AND group_id = $2`,
        [id, ctx.groupId],
      );

      // Record audit log entry for the soft delete (atomic with the update)
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId,
          ctx.userId,
          'contribution.delete',
          'contribution',
          id,
          JSON.stringify({ status: prev.status }),
          JSON.stringify({ status: 'cancelled' }),
        ],
      );
    });
  },
};
