import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from '@/lib/utils/errors';
import { assertActiveMembership } from './membership-guard';
import type { Loan, LoanRepayment, PaginatedResult } from '@/types/db.types';
import type {
  ApplyLoanInput, ApproveLoanInput, RejectLoanInput,
  DisburseLoanInput, RecordRepaymentInput, LoanQueryInput,
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

  async getById(ctx: TenantContext, id: string): Promise<Loan & { member_name: string; schedule: LoanRepayment[] }> {
    return withDb(ctx, async (client) => {
      const { rows: loanRows } = await client.query<Loan & { member_name: string }>(
        `SELECT l.*, m.first_name || ' ' || m.last_name AS member_name
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
      await postDisbursementJournal(client, ctx, rows[0]);

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
      await postRepaymentJournal(client, ctx, rows[0]);

      return rows[0];
    });
  },
};

async function postDisbursementJournal(client: import('pg').PoolClient, ctx: TenantContext, loan: Loan): Promise<void> {
  const { rows: loanReceivable } = await client.query<{ id: string }>(
    `SELECT id FROM accounts WHERE group_id = $1 AND account_code = '1101' AND is_active = true LIMIT 1`,
    [ctx.groupId],
  );
  const { rows: cashAcct } = await client.query<{ id: string }>(
    `SELECT id FROM accounts WHERE group_id = $1 AND account_code = '1001' AND is_active = true LIMIT 1`,
    [ctx.groupId],
  );
  if (!loanReceivable[0] || !cashAcct[0]) return;

  const { rows: je } = await client.query<{ id: string }>(
    `INSERT INTO journal_entries (group_id, entry_date, reference, description, status, created_by)
     VALUES ($1,$2,$3,$4,'posted',$5) RETURNING id`,
    [ctx.groupId, loan.disbursement_date!, loan.mpesa_receipt_number, `Loan disbursement — ${loan.id}`, ctx.userId],
  );

  await client.query(
    `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit)
     VALUES ($1,$2,$3,$4,0), ($1,$2,$5,0,$4)`,
    [ctx.groupId, je[0].id, loanReceivable[0].id, loan.principal_amount, cashAcct[0].id],
  );

  await client.query(`UPDATE loans SET journal_entry_id = $1 WHERE id = $2`, [je[0].id, loan.id]);
}

async function postRepaymentJournal(client: import('pg').PoolClient, ctx: TenantContext, repayment: LoanRepayment): Promise<void> {
  const { rows: loanReceivable } = await client.query<{ id: string }>(
    `SELECT id FROM accounts WHERE group_id = $1 AND account_code = '1101' AND is_active = true LIMIT 1`,
    [ctx.groupId],
  );
  const { rows: cashAcct } = await client.query<{ id: string }>(
    `SELECT id FROM accounts WHERE group_id = $1 AND account_code = '1001' AND is_active = true LIMIT 1`,
    [ctx.groupId],
  );
  const { rows: interestIncome } = await client.query<{ id: string }>(
    `SELECT id FROM accounts WHERE group_id = $1 AND account_code = '4002' AND is_active = true LIMIT 1`,
    [ctx.groupId],
  );
  if (!loanReceivable[0] || !cashAcct[0] || !interestIncome[0]) return;

  const totalPaid = parseFloat(repayment.principal_component) + parseFloat(repayment.interest_component);
  const { rows: je } = await client.query<{ id: string }>(
    `INSERT INTO journal_entries (group_id, entry_date, reference, description, status, created_by)
     VALUES ($1,$2,$3,$4,'posted',$5) RETURNING id`,
    [ctx.groupId, repayment.payment_date!, repayment.mpesa_receipt_number, `Loan repayment — ${repayment.loan_id} #${repayment.installment_number}`, ctx.userId],
  );

  // DR Cash (total), CR Loans Receivable (principal), CR Interest Income (interest)
  await client.query(
    `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit) VALUES
     ($1,$2,$3,$4,0),
     ($1,$2,$5,0,$6),
     ($1,$2,$7,0,$8)`,
    [
      ctx.groupId, je[0].id,
      cashAcct[0].id,       totalPaid.toFixed(2),
      loanReceivable[0].id, repayment.principal_component,
      interestIncome[0].id, repayment.interest_component,
    ],
  );
  await client.query(`UPDATE loan_repayments SET journal_entry_id = $1 WHERE id = $2`, [je[0].id, repayment.id]);
}

