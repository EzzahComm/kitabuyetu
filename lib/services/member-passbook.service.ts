/**
 * The (member) portal's own transaction history. Unlike statement-email
 * .service.ts's 90-day, completed-only union (built for a monthly summary
 * email), this shows the member's FULL history including their own
 * pending/failed attempts, paginated.
 *
 * v1 covers contributions + loan repayments + loan disbursements — the
 * three highest-volume, routine transaction types. Dividends/share
 * transactions/fines/welfare are a deliberate, documented follow-up: they
 * already have GL postings via postTemplatedJournal (see the accounting-
 * architecture audit series), so extending this union to them later is a
 * mechanical addition once this read pattern is proven, not new plumbing.
 */
import { withDb, type TenantContext } from '@/lib/db';
import type { PaginatedResult } from '@/types/db.types';
import type { MemberPassbookQueryInput } from '@/lib/validators/member-passbook.schema';

export type TxnType = 'contribution' | 'loan_repayment' | 'loan_disbursement';
export type TxnStatus = 'success' | 'pending' | 'failed';
export type TxnMethod = 'mpesa' | 'cash';

export interface PassbookEntry {
  id:        string;
  type:      TxnType;
  label:     string;
  amount:    number;
  direction: 'in' | 'out';
  status:    TxnStatus;
  method:    TxnMethod;
  date:      string;
  ref?:      string;
}

interface PassbookRow {
  id:        string;
  type:      TxnType;
  label:     string;
  amount:    string;
  direction: 'in' | 'out';
  db_status: string;
  db_method: string | null;
  txn_date:  string;
  ref:       string | null;
}

function mapStatus(dbStatus: string): TxnStatus {
  if (dbStatus === 'completed') return 'success';
  if (dbStatus === 'pending') return 'pending';
  return 'failed'; // failed | cancelled | overdue
}

// v1 folds bank_transfer/cheque/standing_order (and null) into 'cash' —
// passbook-row.tsx's icon map only distinguishes mpesa/cash/auto today.
function mapMethod(dbMethod: string | null): TxnMethod {
  return dbMethod === 'mpesa' ? 'mpesa' : 'cash';
}

function mapRow(r: PassbookRow): PassbookEntry {
  return {
    id: r.id, type: r.type, label: r.label, amount: parseFloat(r.amount),
    direction: r.direction, status: mapStatus(r.db_status), method: mapMethod(r.db_method),
    date: r.txn_date, ref: r.ref ?? undefined,
  };
}

export async function listMyPassbook(
  ctx: TenantContext,
  params: MemberPassbookQueryInput,
): Promise<PaginatedResult<PassbookEntry>> {
  return withDb(ctx, async (client) => {
    const { page, limit, direction } = params;
    const offset = (page - 1) * limit;

    const union = `
      SELECT id, 'contribution'::text AS type, 'Contribution'::text AS label,
             amount, 'in'::text AS direction, status::text AS db_status,
             payment_method::text AS db_method, contribution_date::text AS txn_date,
             mpesa_receipt_number AS ref
      FROM contributions
      WHERE group_id = $1 AND member_id = $2
      UNION ALL
      SELECT id, 'loan_repayment'::text AS type, 'Loan repayment'::text AS label,
             (CASE WHEN status = 'completed' THEN amount_paid ELSE total_due END) AS amount,
             'in'::text AS direction, status::text AS db_status,
             payment_method::text AS db_method,
             COALESCE(payment_date, due_date)::text AS txn_date,
             mpesa_receipt_number AS ref
      FROM loan_repayments
      WHERE group_id = $1 AND member_id = $2
      UNION ALL
      SELECT id, 'loan_disbursement'::text AS type, 'Loan disbursement'::text AS label,
             principal_amount AS amount, 'out'::text AS direction, 'completed'::text AS db_status,
             payment_method::text AS db_method, disbursement_date::text AS txn_date,
             mpesa_receipt_number AS ref
      FROM loans
      WHERE group_id = $1 AND member_id = $2 AND disbursed_at IS NOT NULL
    `;

    const directionFilter = direction ? 'WHERE direction = $3' : '';
    const values: unknown[] = direction ? [ctx.groupId, ctx.userId, direction] : [ctx.groupId, ctx.userId];

    const { rows: countRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM (${union}) t ${directionFilter}`, values,
    );
    const total = parseInt(countRows[0].count, 10);

    const limitIdx = values.length + 1;
    const offsetIdx = values.length + 2;
    const { rows } = await client.query<PassbookRow>(
      `SELECT * FROM (${union}) t ${directionFilter}
       ORDER BY txn_date DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...values, limit, offset],
    );

    return {
      items: rows.map(mapRow), total, page, pageSize: limit, totalPages: Math.ceil(total / limit),
    };
  });
}
