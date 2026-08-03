import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from '@/lib/utils/errors';
import { assertActiveMembership } from './membership-guard';
import { postTemplatedJournal, postLoanDisbursementJournal, postLoanRepaymentJournal } from './posting-templates.service';
import type { Loan, LoanRepayment, PaginatedResult } from '@/types/db.types';
import type {
  ApplyLoanInput, ApproveLoanInput, RejectLoanInput,
  DisburseLoanInput, MarkDefaultedInput, WriteOffLoanInput, RecordRepaymentInput, LoanQueryInput,
} from '@/lib/validators/loan.schema';

export const loansService = {

  async list(ctx: TenantContext, params: LoanQueryInput): Promise<PaginatedResult<Loan & { member_name: string }>> {
    return withDb(ctx, async (client) => {
      const { page, limit, memberId, status, from, to, sortDir } = params;
      const offset = (page - 1) * limit;
      const conditions: string[] = ['l.group_id = $1'];
      const values: unknown[] = [ctx.groupId];
      let idx = 2;

      if (memberId) { conditions.push(`l.member_id = $${idx++}`);          values.push(memberId); }
      if (status)   { conditions.push(`l.status = $${idx++}`);             values.push(status); }
      if (from)     { conditions.push(`l.created_at::date >= $${idx++}`);  values.push(from); }
      if (to)       { conditions.push(`l.created_at::date <= $${idx++}`);  values.push(to); }

      const where = conditions.join(' AND ');
      const { rows: countRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM loans l WHERE ${where}`, values,
      );
      const total = parseInt(countRows[0].count, 10);

      const { rows } = await client.query<Loan & { member_name: string }>(
        `SELECT l.*, m.first_name || ' ' || m.last_name AS member_name
         FROM loans l JOIN members m ON m.id = l.member_id
         WHERE ${where}
         ORDER BY l.created_at ${sortDir === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset],
      );
      return { items: rows, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
    });
  },

  /**
   * Next N unpaid installments due across every active loan in the group,
   * soonest first — the dashboard's "Upcoming Loan Repayments" card
   * (SIMPLIFICATION_AND_RBAC_AUDIT.md §4: no group-wide aggregation existed
   * before this; `loan_repayments` itself is a real, DB-trigger-generated
   * schedule per loan, so this is a straightforward cross-loan query, not a
   * new amortization computation).
   */
  async listUpcomingRepayments(
    ctx: TenantContext,
    limit = 5,
  ): Promise<(LoanRepayment & { member_name: string })[]> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<LoanRepayment & { member_name: string }>(
        `SELECT lr.*, m.first_name || ' ' || m.last_name AS member_name
         FROM loan_repayments lr
         JOIN members m ON m.id = lr.member_id
         WHERE lr.group_id = $1 AND lr.status = 'pending'
         ORDER BY lr.due_date ASC
         LIMIT $2`,
        [ctx.groupId, limit],
      );
      return rows;
    });
  },

  async getById(ctx: TenantContext, id: string): Promise<Loan & { member_name: string; member_phone: string; schedule: LoanRepayment[] }> {
    return withDb(ctx, async (client) => {
      const { rows: loanRows } = await client.query<Loan & { member_name: string; member_phone: string }>(
        `SELECT l.*, m.first_name || ' ' || m.last_name AS member_name, m.phone AS member_phone
         FROM loans l JOIN members m ON m.id = l.member_id
         WHERE l.id = $1 AND l.group_id = $2`,
        [id, ctx.groupId],
      );
      if (!loanRows[0]) throw new NotFoundError('Loan', id);

      const { rows: schedule } = await client.query<LoanRepayment>(
        `SELECT * FROM loan_repayments
         WHERE loan_id = $1 ORDER BY installment_number ASC`,
        [id],
      );
      return { ...loanRows[0], schedule };
    });
  },

  async apply(ctx: TenantContext, data: ApplyLoanInput): Promise<Loan> {
    return withTransaction(ctx, async (client) => {
      // Borrower must hold an active membership in THIS group (§5); the
      // membership id is stamped on the loan (§6a). The guarantor, when
      // named, must be an active member of the same group too.
      const { membershipId } = await assertActiveMembership(client, ctx.groupId, ctx.userId);
      if (data.guarantorId) {
        await assertActiveMembership(client, ctx.groupId, data.guarantorId);
      }

      // A member cannot have two active loans simultaneously
      const { rows: active } = await client.query<{ id: string }>(
        `SELECT id FROM loans
         WHERE group_id = $1 AND member_id = $2
           AND status IN ('approved','disbursed','active')
         LIMIT 1`,
        [ctx.groupId, ctx.userId],
      );
      if (active[0]) throw new ValidationError('You already have an active loan');

      const { rows } = await client.query<Loan>(
        `INSERT INTO loans
           (group_id, member_id, group_membership_id, principal_amount, interest_rate,
            loan_term_months, purpose, guarantor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          ctx.groupId, ctx.userId, membershipId,
          data.principalAmount.toFixed(2),
          data.interestRate.toFixed(2),
          data.loanTermMonths,
          data.purpose ?? null,
          data.guarantorId ?? null,
        ],
      );
      return rows[0];
    });
  },

  async approve(ctx: TenantContext, id: string, _data: ApproveLoanInput): Promise<Loan> {
    return withTransaction(ctx, async (client) => {
      const { rows: existing } = await client.query<Loan>(
        `SELECT * FROM loans WHERE id = $1 AND group_id = $2`, [id, ctx.groupId],
      );
      if (!existing[0]) throw new NotFoundError('Loan', id);
      if (existing[0].status !== 'pending') {
        throw new ValidationError(`Cannot approve a loan with status '${existing[0].status}'`);
      }

      const { rows } = await client.query<Loan>(
        `UPDATE loans SET status = 'approved', approved_by = $1, approved_at = NOW()
         WHERE id = $2 RETURNING *`,
        [ctx.userId, id],
      );
      return rows[0];
    });
  },

  async reject(ctx: TenantContext, id: string, data: RejectLoanInput): Promise<Loan> {
    return withTransaction(ctx, async (client) => {
      const { rows: existing } = await client.query<Loan>(
        `SELECT * FROM loans WHERE id = $1 AND group_id = $2`, [id, ctx.groupId],
      );
      if (!existing[0]) throw new NotFoundError('Loan', id);
      if (!['pending', 'approved'].includes(existing[0].status)) {
        throw new ValidationError(`Cannot reject a loan with status '${existing[0].status}'`);
      }

      const { rows } = await client.query<Loan>(
        `UPDATE loans
         SET status = 'rejected', rejected_by = $1, rejected_at = NOW(), rejection_reason = $2
         WHERE id = $3 RETURNING *`,
        [ctx.userId, data.reason, id],
      );
      return rows[0];
    });
  },

  async disburse(ctx: TenantContext, id: string, data: DisburseLoanInput): Promise<Loan> {
    return withTransaction(ctx, async (client) => {
      const { rows: existing } = await client.query<Loan>(
        `SELECT * FROM loans WHERE id = $1 AND group_id = $2`, [id, ctx.groupId],
      );
      if (!existing[0]) throw new NotFoundError('Loan', id);
      if (existing[0].status !== 'approved') {
        throw new ValidationError(`Only approved loans can be disbursed`);
      }

      // Transition to disbursed — the DB trigger generates the repayment schedule
      const { rows } = await client.query<Loan>(
        `UPDATE loans
         SET status = 'disbursed',
             disbursement_date    = $1,
             payment_method       = $2,
             mpesa_receipt_number = $3,
             disbursed_by         = $4,
             disbursed_at         = NOW()
         WHERE id = $5 RETURNING *`,
        [
          data.disbursementDate,
          data.paymentMethod,
          data.mpesaReceiptNumber ?? null,
          ctx.userId,
          id,
        ],
      );

      // Post disbursement journal
      await postLoanDisbursementJournal(client, {
        groupId: ctx.groupId, loanId: rows[0].id, principal: parseFloat(rows[0].principal_amount),
        entryDate: rows[0].disbursement_date!, reference: rows[0].mpesa_receipt_number, createdBy: ctx.userId,
      });

      return rows[0];
    });
  },

  async recordRepayment(ctx: TenantContext, loanId: string, data: RecordRepaymentInput): Promise<LoanRepayment> {
    return withTransaction(ctx, async (client) => {
      const { rows: installment } = await client.query<LoanRepayment>(
        `SELECT * FROM loan_repayments
         WHERE loan_id = $1 AND installment_number = $2 AND group_id = $3
         FOR UPDATE`,
        [loanId, data.installmentNumber, ctx.groupId],
      );
      if (!installment[0]) throw new NotFoundError(`Installment ${data.installmentNumber}`, loanId);
      if (installment[0].status === 'completed') {
        throw new ConflictError('Installment already fully paid');
      }

      if (data.mpesaReceiptNumber) {
        const dup = await client.query(
          'SELECT id FROM loan_repayments WHERE mpesa_receipt_number = $1',
          [data.mpesaReceiptNumber],
        );
        if (dup.rows[0]) throw new ConflictError(`M-Pesa receipt ${data.mpesaReceiptNumber} already recorded`);
      }

      const { rows } = await client.query<LoanRepayment>(
        `UPDATE loan_repayments
         SET amount_paid          = $1,
             payment_date         = $2,
             status               = 'completed',
             payment_method       = $3,
             mpesa_receipt_number = $4,
             penalty_amount       = GREATEST(penalty_amount, $5)
         WHERE loan_id = $6 AND installment_number = $7
         RETURNING *`,
        [
          data.amountPaid.toFixed(2), data.paymentDate,
          data.paymentMethod, data.mpesaReceiptNumber ?? null,
          data.penaltyAmount.toFixed(2),
          loanId, data.installmentNumber,
        ],
      );

      // Update the parent loan's outstanding balance and next payment date
      await client.query(
        `UPDATE loans SET
           outstanding_balance = outstanding_balance - $1,
           next_payment_date = (
             SELECT MIN(due_date) FROM loan_repayments
             WHERE loan_id = $2 AND status = 'pending'
           ),
           status = CASE
             WHEN (SELECT COUNT(*) FROM loan_repayments WHERE loan_id = $2 AND status != 'completed') = 0
             THEN 'completed' ELSE status
           END
         WHERE id = $2`,
        [rows[0].principal_component, loanId],
      );

      // Post repayment journal
      await postLoanRepaymentJournal(client, {
        groupId: ctx.groupId, repaymentId: rows[0].id, loanId: loanId,
        principalPortion: parseFloat(rows[0].principal_component), interestPortion: parseFloat(rows[0].interest_component),
        entryDate: rows[0].payment_date!, reference: rows[0].mpesa_receipt_number, createdBy: ctx.userId,
      });

      return rows[0];
    });
  },

  /** First step of the write-off workflow — flags an active loan as uncollectible. */
  async markDefaulted(ctx: TenantContext, id: string, data: MarkDefaultedInput): Promise<Loan> {
    return withTransaction(ctx, async (client) => {
      const { rows: existing } = await client.query<Loan>(
        `SELECT * FROM loans WHERE id = $1 AND group_id = $2 FOR UPDATE`, [id, ctx.groupId],
      );
      if (!existing[0]) throw new NotFoundError('Loan', id);
      if (existing[0].status !== 'active') {
        throw new ValidationError(`Only active loans can be marked defaulted (current status: '${existing[0].status}')`);
      }

      const { rows } = await client.query<Loan>(
        `UPDATE loans
         SET    status = 'defaulted', defaulted_by = $1, defaulted_at = NOW(), default_reason = $2
         WHERE  id = $3 RETURNING *`,
        [ctx.userId, data.reason, id],
      );
      await writeAuditLog(client, ctx, 'loan.defaulted', id, { reason: data.reason });
      return rows[0];
    });
  },

  /**
   * Second step — maker-checker: the officer who marked the loan defaulted
   * cannot be the one who writes it off (DB CHECK backstop in migration 084).
   * Posts DR 5004 Loan Write-offs / CR 1101 Loans Receivable for the
   * outstanding balance and zeroes it out — this debt is no longer expected
   * to be collected.
   */
  async writeOff(ctx: TenantContext, id: string, data: WriteOffLoanInput): Promise<Loan> {
    return withTransaction(ctx, async (client) => {
      const { rows: existing } = await client.query<Loan>(
        `SELECT * FROM loans WHERE id = $1 AND group_id = $2 FOR UPDATE`, [id, ctx.groupId],
      );
      if (!existing[0]) throw new NotFoundError('Loan', id);
      if (existing[0].status !== 'defaulted') {
        throw new ValidationError(`Only defaulted loans can be written off (current status: '${existing[0].status}')`);
      }
      if (existing[0].defaulted_by === ctx.userId) {
        throw new ForbiddenError('Maker-checker: the officer who marked this loan defaulted cannot authorize its write-off');
      }

      const outstanding = parseFloat(existing[0].outstanding_balance ?? '0');
      let journalEntryId: string | null = null;
      if (outstanding > 0) {
        journalEntryId = await postTemplatedJournal(
          client, ctx.groupId, ctx.userId, 'loan_writeoff', `Loan write-off — ${id}`,
          { outstanding },
          { reference: id },
        );
      }

      const { rows } = await client.query<Loan>(
        `UPDATE loans
         SET    status = 'written_off', written_off_by = $1, written_off_at = NOW(), write_off_reason = $2,
                outstanding_balance = 0, write_off_journal_entry_id = $3
         WHERE  id = $4 RETURNING *`,
        [ctx.userId, data.reason, journalEntryId, id],
      );
      await writeAuditLog(client, ctx, 'loan.written_off', id, { reason: data.reason, amount: outstanding.toFixed(2) });
      return rows[0];
    });
  },
};

async function writeAuditLog(
  client: import('pg').PoolClient,
  ctx:    TenantContext,
  action: string,
  resourceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
     VALUES ($1, $2, $3, 'loan', $4, $5::jsonb)`,
    [ctx.groupId, ctx.userId, action, resourceId, JSON.stringify(payload)],
  );
}

