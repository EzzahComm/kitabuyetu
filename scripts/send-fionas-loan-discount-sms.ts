/**
 * One-off: tell the four THE FIONA'S borrowers their repayments have come
 * down, after migration 167 reread `loans.interest_rate` as a nominal ANNUAL
 * rate instead of a monthly one.
 *
 * They were told in writing on 2026-08-16 that the loan was "at 5% per month
 * reducing balance", with instalments computed on that reading. The product is
 * 5% per ANNUM (confirmed by the user 2026-09-03), so those figures overstated
 * every instalment by roughly 12x of the rate. First instalment falls due
 * 16 Sep 2026, so this needs to reach them before they budget for the old
 * number.
 *
 * Reads the CURRENT schedule for the new figures rather than hardcoding them,
 * so the message states whatever the loan actually says at the moment it runs.
 * Only the OLD instalment is hardcoded — it is what was literally sent on
 * 16 Aug (verified against sms_usage_logs), and it no longer exists anywhere
 * in the database to be read back.
 *
 * Dry run by default:
 *   node --env-file=.env.local --import tsx scripts/send-fionas-loan-discount-sms.ts
 *   node --env-file=.env.local --import tsx scripts/send-fionas-loan-discount-sms.ts --send
 */
import { withAdminDb } from '@/lib/db';
import { smsService } from '@/lib/services/sms.service';
import { platformPaybill } from '@/lib/sms/templates';
import type { TenantContext } from '@/lib/db';

const SEND = process.argv.includes('--send');

/**
 * The instalment each borrower was quoted on 2026-08-16, keyed by membership
 * number rather than first name — a name is not unique and not stable, an
 * account number is both, and it is also what the member pays against.
 *
 * Verified verbatim against the sent messages in sms_usage_logs.
 */
const QUOTED_ON_16_AUG: Readonly<Record<string, number>> = Object.freeze({
  TF000022: 45130.16, // Fiona,   400,000
  TF000033: 30462.86, // Ruth,    270,000
  TF000040: 30462.86, // Polycap, 270,000
  TF000054: 14667.30, // Reuben,  130,000
});

/**
 * The shortcode that actually receives C2B money, confirmed against real
 * inbound callbacks (mpesa_callbacks.body->>'BusinessShortCode'). Asserted
 * rather than trusted: this script may run against a local env whose
 * MPESA_SHORTCODE is a placeholder, and a payment instruction quoting the
 * wrong paybill sends money nowhere.
 */
const EXPECTED_PAYBILL = '4044141';

interface Row {
  loan_id: string; member_id: string; first_name: string; phone: string;
  membership_no: string; group_id: string; group_name: string;
  principal_amount: string; total_repayable: string;
  first_inst: string; n: string;
}

async function main() {
  const paybill = platformPaybill();
  if (paybill !== EXPECTED_PAYBILL) {
    throw new Error(
      `Paybill is "${paybill}" but live C2B callbacks arrive on ${EXPECTED_PAYBILL}. `
      + 'Refusing to send a payment instruction that would point members at the wrong shortcode.',
    );
  }

  const rows = await withAdminDb(async (db) => {
    const { rows } = await db.query<Row>(`
      SELECT l.id AS loan_id, m.id AS member_id, m.first_name, m.phone,
             gm.membership_no, g.id AS group_id, g.name AS group_name,
             l.principal_amount, l.total_repayable,
             (SELECT total_due FROM loan_repayments r
               WHERE r.loan_id = l.id AND r.installment_number = 1) AS first_inst,
             (SELECT count(*) FROM loan_repayments r WHERE r.loan_id = l.id) AS n
      FROM loans l
      JOIN members m        ON m.id  = l.member_id
      JOIN group_members gm ON gm.id = l.group_membership_id
      JOIN groups g         ON g.id  = l.group_id
      WHERE l.status = 'disbursed' AND g.name = 'THE FIONA''S'
      ORDER BY l.principal_amount DESC`);
    return rows;
  });

  if (rows.length !== 4) {
    throw new Error(`Expected 4 disbursed loans, found ${rows.length} — refusing`);
  }

  const money = (v: number | string) =>
    Number(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const whole = (v: string) => Number(v).toLocaleString('en-KE');

  // Every message is built and checked BEFORE any of them is sent, so a bad
  // row cannot leave two members messaged and two not.
  const outbound = rows.map((r) => {
    const wasInst = QUOTED_ON_16_AUG[r.membership_no];
    if (wasInst === undefined) {
      throw new Error(`No 16-Aug quote recorded for ${r.membership_no} (${r.first_name}) — refusing`);
    }
    const nowInst = Number(r.first_inst);
    if (!(nowInst > 0)) {
      throw new Error(`${r.first_name} has no first instalment — schedule missing, refusing`);
    }
    // This message calls it a discount. If the figure went UP, that word is a
    // lie and the migration did not do what it was supposed to.
    if (nowInst >= wasInst) {
      throw new Error(
        `${r.first_name}: new instalment ${nowInst} is not lower than the quoted ${wasInst} — refusing`,
      );
    }
    if (Number(r.n) !== 12) {
      throw new Error(`${r.first_name} has ${r.n} instalments, message says 12 — refusing`);
    }

    const message =
      `Dear ${r.first_name}, your loan of KES ${whole(r.principal_amount)} from ${r.group_name} `
      + `has been discounted from KES ${money(wasInst)} to KES ${money(nowInst)} per month. `
      + `Your new total for ${r.n} monthly repayments is now KES ${money(r.total_repayable)}. `
      + `Start repaying on M-Pesa Paybill ${paybill}, Account ${r.membership_no}L `
      + 'to qualify for another loan. Thank you.';

    return { r, message };
  });

  // Idempotency is enforced HERE, on the message itself, rather than by
  // passing the loan id as a referenceId.
  //
  // The first run of this script did pass one, and sent nothing at all:
  // smsService.send's H3 guard treats a correlation_id it has already logged
  // as a duplicate and returns the EXISTING rows instead of dispatching. The
  // 16 Aug disbursement and correction messages were both sent under that same
  // loan id, so all four borrowers matched, and the script cheerfully reported
  // "sent" — the status of a message from three weeks ago.
  //
  // That guard is right for event-driven sends and its own comment says so: a
  // manual send carries no referenceId, "and repeating one is a legitimate act
  // that must stay possible". This is exactly that case. So the send goes out
  // uncorrelated, and the protection against a double-send comes from checking
  // whether this specific message has already gone to this specific number.
  const alreadySent = await withAdminDb(async (db) => {
    const { rows } = await db.query<{ recipient_phone: string }>(
      `SELECT DISTINCT recipient_phone FROM sms_usage_logs
        WHERE message_text LIKE '%has been discounted from%'
          AND recipient_phone = ANY($1::text[])`,
      [outbound.map((o) => o.r.phone)],
    );
    return new Set(rows.map((x) => x.recipient_phone));
  });

  // One phone, one message, one send — never a bulk call, so there is no
  // phone-to-body mapping that can drift and put Ruth's figures on Fiona's
  // handset.
  for (const { r, message } of outbound) {
    if (alreadySent.has(r.phone)) {
      console.log(`SKIP  ${r.first_name} ${r.phone} — already has a discount message logged`);
      continue;
    }
    if (!SEND) {
      console.log(`\n[DRY RUN] ${r.first_name} ${r.phone} (${message.length} chars)\n${message}`);
      continue;
    }
    const ctx = { groupId: r.group_id, userId: r.member_id, role: 'chairperson' } as TenantContext;
    const logs = await smsService.send(ctx, r.phone, message, 'loan', null);

    // Assert the row is NEW. A returned status alone proves nothing — that is
    // precisely how the first run looked successful while sending nothing.
    const fresh = logs.filter((l) => l.message_text?.includes('has been discounted from'));
    if (!logs.length) {
      console.log(`SUPPRESSED ${r.first_name} ${r.phone} — opted out`);
    } else if (!fresh.length) {
      throw new Error(
        `${r.first_name}: send() returned ${logs.length} row(s) but none carry this message — `
        + 'it was deduped again. Refusing to continue and report a send that did not happen.',
      );
    } else {
      console.log(`SENT  ${r.first_name} ${r.phone} -> ${fresh.map((l) => l.status).join(',')}`);
    }
  }

  console.log(SEND
    ? '\nQueued. A local 401 on placeholder provider creds is expected; production\'s'
      + ' sms_retry_failed sweep (225 runs/24h, healthy) delivers within minutes.'
    : '\nDry run only — pass --send to dispatch.');
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
