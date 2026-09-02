import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ConflictError } from '@/lib/utils/errors';
import { assertActiveMembership } from './membership-guard';
import type { Contribution, PaginatedResult } from '@/types/db.types';
import type { CreateContributionInput, UpdateContributionInput, ContributionQueryInput } from '@/lib/validators/contribution.schema';
import { postContributionJournal } from './accounting.service';
import { sendContributionConfirmation } from './notification-email.service';
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

      const { rows: countRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM contributions c WHERE ${where}`, values,
      );
      const total = parseInt(countRows[0].count, 10);

      const { rows } = await client.query<Contribution & { member_name: string }>(
        `SELECT c.*,
                m.first_name || ' ' || m.last_name AS member_name
         FROM contributions c
         JOIN members m ON m.id = c.member_id
         WHERE ${where}
         ORDER BY c.contribution_date ${orderDir}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset],
      );

      return { items: rows, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
    });
  },

  // Active members with no completed contribution in the current calendar month.
  // Powers the treasurer home "needs you now" list — small per group, so we
  // return the full set and let the caller cap the preview.
  async nonContributors(ctx: TenantContext): Promise<{ count: number; sample: { id: string; name: string }[] }> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<{ id: string; name: string }>(
        `SELECT m.id, m.first_name || ' ' || m.last_name AS name
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
         ORDER BY m.first_name, m.last_name`,
        [ctx.groupId],
      );
      return { count: rows.length, sample: rows.slice(0, 5) };
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

    const { renderTemplate } = await import('@/lib/sms/templates');
    const { sendOnce } = await import('./reminder.service');
    // Same platform paybill mpesa-stk.service.ts's STK-failure nudge and the
    // loan-due reminders (lib/jobs/handlers.ts) already use — a reminder that
    // doesn't say how to pay isn't actionable.
    const paybill = process.env.MPESA_WORKING_SHORTCODE ?? process.env.MPESA_SHORTCODE ?? '';
    const template =
      'Dear {{first_name}}, this is a friendly reminder to make your {{group_name}} contribution for {{month}}. ' +
      'Pay via M-Pesa Paybill {{paybill}}, Account {{account_number}}. Thank you.';

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
          account_number: r.membership_no,
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

      // Auto-post a journal entry when the contribution is completed on creation
      if (contribution.status === 'completed') {
        await postContributionJournal(client, {
          groupId: ctx.groupId, contributionId: contribution.id, amount: parseFloat(contribution.amount),
          entryDate: contribution.contribution_date, reference: contribution.mpesa_receipt_number, createdBy: ctx.userId,
        });
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

      // Post journal when status transitions to completed
      if (updated.status === 'completed' && prev.status !== 'completed') {
        await postContributionJournal(client, {
          groupId: ctx.groupId, contributionId: updated.id, amount: parseFloat(updated.amount),
          entryDate: updated.contribution_date, reference: updated.mpesa_receipt_number, createdBy: ctx.userId,
        });
      }

      return updated;
    });
  },

  // Soft-delete only: financial records must never be physically removed.
  // Only pending contributions can be cancelled; completed ones are immutable.
  async delete(ctx: TenantContext, id: string): Promise<void> {
    return withTransaction(ctx, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE contributions SET status = 'cancelled' WHERE id = $1 AND group_id = $2 AND status = 'pending'`,
        [id, ctx.groupId],
      );
      if (!rowCount) throw new NotFoundError('Pending contribution', id);
    });
  },
};
