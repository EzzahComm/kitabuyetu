/**
 * One-off correction: the four THE FIONA'S borrowers were notified on
 * 2026-08-16 with figures that have since changed TWICE — first from 10% flat
 * to 10% reducing balance, then to 5% reducing balance. Every number they hold
 * (instalment, total, method) overstates what they now owe by roughly 38%.
 *
 * Sending a correction is not optional here: members were told a specific
 * monthly figure, and a borrower who budgets for 23,833.33 when 14,667.30 is
 * due is being misled by us, not by their own error.
 *
 * Reads the CURRENT schedule rather than hardcoding anything, so it states
 * whatever the loan actually says at the moment it runs.
 *
 * Dry run by default:
 *   node --env-file=.env.local --import tsx scripts/send-fionas-loan-correction-sms.ts
 *   node --env-file=.env.local --import tsx scripts/send-fionas-loan-correction-sms.ts --send
 */
import { withAdminDb } from '@/lib/db';
import { smsService } from '@/lib/services/sms.service';
import type { TenantContext } from '@/lib/db';

const SEND    = process.argv.includes('--send');
const PAYBILL = process.env.MPESA_SHORTCODE ?? '';

interface Row {
  loan_id: string; member_id: string; first_name: string; phone: string;
  membership_no: string; group_id: string; group_name: string;
  principal_amount: string; total_repayable: string;
  interest_rate: string; interest_method: string;
  first_inst: string; first_due: string; n: string;
}

async function main() {
  if (!PAYBILL) throw new Error('MPESA_SHORTCODE is not set — refusing to send a paybill-less message');

  const rows = await withAdminDb(async (db) => {
    const { rows } = await db.query<Row>(`
      SELECT l.id AS loan_id, m.id AS member_id, m.first_name, m.phone,
             gm.membership_no, g.id AS group_id, g.name AS group_name,
             l.principal_amount, l.total_repayable, l.interest_rate, l.interest_method,
             (SELECT total_due FROM loan_repayments r
               WHERE r.loan_id = l.id AND r.installment_number = 1) AS first_inst,
             to_char((SELECT min(due_date) FROM loan_repayments r
                       WHERE r.loan_id = l.id), 'DD Mon YYYY') AS first_due,
             (SELECT count(*) FROM loan_repayments r WHERE r.loan_id = l.id) AS n
      FROM loans l
      JOIN members m        ON m.id  = l.member_id
      JOIN group_members gm ON gm.id = l.group_membership_id
      JOIN groups g         ON g.id  = l.group_id
      WHERE l.status = 'disbursed' AND g.name = 'THE FIONA''S'
      ORDER BY l.principal_amount DESC`);
    return rows;
  });

  if (rows.length !== 4) throw new Error(`Expected 4 disbursed loans, found ${rows.length} — refusing`);

  const money = (v: string) =>
    Number(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const whole = (v: string) => Number(v).toLocaleString('en-KE');

  for (const r of rows) {
    const method = r.interest_method === 'reducing_balance' ? 'reducing balance' : 'flat';
    const message =
      `Dear ${r.first_name}, correction to our earlier message: your KES ${whole(r.principal_amount)} loan `
      + `from ${r.group_name} is at ${Number(r.interest_rate)}% per month ${method}. `
      + `Repay ${r.n} monthly instalments of KES ${money(r.first_inst)} `
      + `(total KES ${money(r.total_repayable)}) from ${r.first_due}. `
      + `M-Pesa Paybill ${PAYBILL}, Account ${r.membership_no}L. Sorry for the confusion.`;

    if (!SEND) {
      console.log(`\n[DRY RUN] ${r.first_name} ${r.phone} (${message.length} chars)\n${message}`);
      continue;
    }

    const ctx = { groupId: r.group_id, userId: r.member_id, role: 'chairperson' } as TenantContext;
    const logs = await smsService.send(ctx, r.phone, message, 'loan', r.loan_id);
    console.log(`QUEUED ${r.first_name} ${r.phone} -> ${logs.map((l) => l.status).join(',') || 'suppressed (opted out)'}`);
  }

  console.log(SEND ? '\nQueued. Local dispatch 401s on placeholder provider creds; production\'s'
                   + ' sms_retry_failed sweep delivers them within ~5 minutes.'
                   : '\nDry run only — pass --send to dispatch.');
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
