/**
 * One-off: the loan-disbursement SMS for the four THE FIONA'S loans disbursed
 * 2026-08-16, which were never notified.
 *
 * Goes through smsService.send() rather than hitting the provider directly, so
 * credit reservation, opt-out suppression, sms_usage_logs and DLR tracking all
 * behave exactly as they do for any other message.
 *
 * Dry run by default. Pass --send to actually dispatch.
 *
 *   npx tsx scripts/send-fionas-disbursement-sms.ts
 *   npx tsx scripts/send-fionas-disbursement-sms.ts --send
 *
 * The account reference carries the 'L' suffix deliberately. Without it the
 * allocation engine (lib/utils/allocation-engine.ts, tier A3) falls through to
 * the group default — 'savings' for this group — and a repayment would be
 * banked as savings while the loan sat untouched.
 */
import { withAdminDb } from '@/lib/db';
import { smsService } from '@/lib/services/sms.service';
import type { TenantContext } from '@/lib/db';

const SEND    = process.argv.includes('--send');
const PAYBILL = process.env.MPESA_SHORTCODE ?? '';

interface Row {
  loan_id: string; member_id: string; first_name: string; phone: string;
  membership_no: string; group_id: string; group_name: string;
  principal_amount: string; total_repayable: string; payment_method: string | null;
  first_inst: string; first_due: string; n: string;
}

async function main() {
  if (!PAYBILL) throw new Error('MPESA_SHORTCODE is not set — refusing to send a message with no paybill');

  const rows = await withAdminDb(async (db) => {
    const { rows } = await db.query<Row>(`
      SELECT l.id AS loan_id, m.id AS member_id, m.first_name, m.phone,
             gm.membership_no, g.id AS group_id, g.name AS group_name,
             l.principal_amount, l.total_repayable, l.payment_method,
             (SELECT total_due FROM loan_repayments r
               WHERE r.loan_id = l.id AND r.installment_number = 1) AS first_inst,
             to_char((SELECT min(due_date) FROM loan_repayments r
                       WHERE r.loan_id = l.id), 'DD Mon YYYY') AS first_due,
             (SELECT count(*) FROM loan_repayments r WHERE r.loan_id = l.id) AS n
      FROM loans l
      JOIN members m       ON m.id  = l.member_id
      JOIN group_members gm ON gm.id = l.group_membership_id
      JOIN groups g        ON g.id  = l.group_id
      WHERE l.status = 'disbursed' AND g.name = 'THE FIONA''S'
      ORDER BY l.principal_amount DESC`);
    return rows;
  });

  if (rows.length !== 4) {
    throw new Error(`Expected 4 disbursed loans, found ${rows.length} — refusing to send`);
  }

  const money = (v: string) =>
    Number(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const whole = (v: string) => Number(v).toLocaleString('en-KE');

  for (const r of rows) {
    // Cash leaves no receipt to quote; only M-Pesa does. Saying "in CASH"
    // explicitly is what the group asked for, so a member can reconcile the
    // message against what they actually received by hand.
    const channel = r.payment_method === 'cash' ? 'in CASH' : `via ${r.payment_method ?? 'the group'}`;
    const message =
      `Dear ${r.first_name}, your loan of KES ${whole(r.principal_amount)} from ${r.group_name} `
      + `is approved and disbursed ${channel}. `
      + `Repay ${r.n} monthly instalments of KES ${money(r.first_inst)} `
      + `(total KES ${whole(r.total_repayable)}) from ${r.first_due}. `
      + `Repay via M-Pesa Paybill ${PAYBILL}, Account ${r.membership_no}L (the L is required).`;

    if (!SEND) {
      console.log(`\n[DRY RUN] ${r.first_name} ${r.phone} (${message.length} chars)\n${message}`);
      continue;
    }

    const ctx = {
      groupId: r.group_id,
      userId:  r.member_id,
      role:    'chairperson',
    } as TenantContext;

    // referenceType/referenceId tie the log row to the loan, so the send is
    // traceable from the loan record rather than floating in sms_usage_logs.
    const logs = await smsService.send(ctx, r.phone, message, 'loan', r.loan_id);
    console.log(`SENT ${r.first_name} ${r.phone} -> ${logs.map((l) => l.status).join(',') || 'suppressed (opted out)'}`);
  }

  console.log(SEND ? '\nDone.' : '\nDry run only — pass --send to dispatch.');
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
