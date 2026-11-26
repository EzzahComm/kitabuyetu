import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { AppError, ValidationError } from '@/lib/utils/errors';
import { sendEmailWithFallback } from '@/lib/email/provider';
import { wrapWithBranding } from '@/lib/email/templates/engine';
import { initiateStkPush } from './daraja.service';

const coverageQuery = `
  SELECT c.organization_id, c.trial_ends_at, c.paid_until, s.monthly_fee, s.plan_type,
    greatest(c.trial_ends_at, c.paid_until) AS due_at,
    CASE WHEN c.paid_until > now() THEN 'paid'
         WHEN c.trial_ends_at > now() THEN 'trial'
         WHEN s.plan_type IS NULL THEN 'unassigned'
         WHEN s.monthly_fee = 0 THEN 'complimentary'
         ELSE 'awaiting_payment' END AS state
  FROM enterprise_coverage c LEFT JOIN organization_subscriptions s
    ON s.organization_id=c.organization_id AND s.status='active'`;

export async function assertEnterpriseCoverage(id: string) {
  const allowed = await withAdminDb((db) =>
    db.query(
      `SELECT 1 FROM (${coverageQuery}) p WHERE organization_id=$1 AND state IN ('trial','complimentary','paid')`,
      [id],
    ),
  );
  if (!allowed.rowCount)
    throw new AppError('Open Enterprise Billing to restore access.', 'ENTERPRISE_PAYMENT_REQUIRED', 402);
}

async function issueDueInvoices(db: PoolClient, id: string | null) {
  await db.query(
    `INSERT INTO enterprise_invoices(organization_id,due_at,plan_type,amount)
    SELECT organization_id,due_at,plan_type,monthly_fee FROM (${coverageQuery}) p
    WHERE state='awaiting_payment' AND ($1::uuid IS NULL OR organization_id=$1)
    ON CONFLICT (organization_id,due_at) DO NOTHING`,
    [id],
  );
}

export async function getEnterpriseBilling(id: string) {
  return withAdminDb(async (db) => {
    await issueDueInvoices(db, id);
    const { rows } = await db.query(
      `SELECT p.state,p.trial_ends_at,p.paid_until,i.reference,i.amount-i.received AS balance
      FROM (${coverageQuery}) p LEFT JOIN enterprise_invoices i ON i.organization_id=p.organization_id
        AND i.due_at=p.due_at AND i.settled_at IS NULL
      WHERE p.organization_id=$1`,
      [id],
    );
    return { ...(rows[0] ?? { state: 'unassigned' }), paybill: process.env.MPESA_SHORTCODE };
  });
}

export async function sendEnterpriseInvoice() {
  const invoice = await withAdminDb(async (db) => {
    await issueDueInvoices(db, null);
    const { rows } = await db.query(`WITH candidate AS (
      SELECT i.reference,coalesce(nullif(trim(o.email),''),(
        SELECT m.email FROM organization_members om JOIN members m ON m.id=om.member_id
        WHERE om.organization_id=o.id AND om.status='active' AND om.org_role='lead' AND m.email IS NOT NULL
        ORDER BY om.member_id LIMIT 1)) AS email
      FROM enterprise_invoices i JOIN organizations o ON o.id=i.organization_id
      WHERE settled_at IS NULL AND email_sent_at IS NULL
        AND (last_email_attempt IS NULL OR last_email_attempt < now()-interval '15 minutes')
      ORDER BY last_email_attempt NULLS FIRST,due_at LIMIT 1 FOR UPDATE OF i SKIP LOCKED)
      UPDATE enterprise_invoices i SET last_email_attempt=now() FROM candidate c WHERE c.reference=i.reference
      RETURNING c.email,i.reference,i.plan_type,i.amount-i.received AS balance`);
    return rows[0];
  });
  if (!invoice) return { message: 'No enterprise invoice due' };
  if (!invoice.email || !process.env.MPESA_SHORTCODE)
    throw new Error('Enterprise invoice needs a recipient and PayBill.');
  const text = `Your Kitabu Yetu Enterprise ${invoice.plan_type} invoice ${invoice.reference} has a balance of KES ${invoice.balance}. Pay by M-Pesa to PayBill ${process.env.MPESA_SHORTCODE}, account ${invoice.reference}, or request an STK push from Enterprise Billing. Full payment unlocks one month of access.`;
  const result = await sendEmailWithFallback({
    to: invoice.email,
    subject: `Kitabu Yetu invoice ${invoice.reference}`,
    text,
    html: wrapWithBranding(
      `<p>${text}</p><p><a href="https://kitabuyetu.co.ke/enterprise/billing">Open Enterprise Billing</a></p>`,
      {},
    ),
    category: 'billing',
    templateKey: 'enterprise_subscription_invoice',
  });
  if (!result.success || result.dryRun) throw new Error('Enterprise invoice email was not accepted.');
  await withAdminDb((db) =>
    db.query('UPDATE enterprise_invoices SET email_sent_at=now() WHERE reference=$1', [invoice.reference]),
  );
  return { message: 'Enterprise invoice sent' };
}

export async function promptEnterprisePayment(id: string, phone: string) {
  const billing = await getEnterpriseBilling(id);
  if (!billing.reference) throw new ValidationError('There is no outstanding invoice.');
  const claim = await withAdminDb((db) =>
    db.query(
      `UPDATE enterprise_invoices SET last_prompt_at=now()
    WHERE reference=$1 AND settled_at IS NULL AND (last_prompt_at IS NULL OR last_prompt_at<now()-interval '90 seconds')
    RETURNING amount-received AS balance`,
      [billing.reference],
    ),
  );
  if (!claim.rowCount) throw new ValidationError('Refresh billing before requesting another prompt.');
  const amount = Number(claim.rows[0].balance);
  if (!Number.isInteger(amount)) throw new ValidationError('Use PayBill for a balance containing cents.');
  const attempt = await withAdminDb((db) =>
    db.query('INSERT INTO enterprise_stk_attempts(reference,amount) VALUES ($1,$2) RETURNING id', [
      billing.reference,
      amount,
    ]),
  );
  const response = await initiateStkPush({
    enterpriseAttempt: attempt.rows[0].id,
    phone,
    amount,
    accountReference: billing.reference,
    description: 'Enterprise invoice',
  });
  if (response.responseCode !== '0' || !response.checkoutRequestId || !response.merchantRequestId)
    throw new ValidationError('M-Pesa did not accept the prompt.');
  await withAdminDb((db) =>
    db.query(
      'UPDATE enterprise_stk_attempts SET checkout_id=$1,merchant_id=$2 WHERE id=$3 AND (checkout_id IS NULL OR checkout_id=$1)',
      [response.checkoutRequestId, response.merchantRequestId, attempt.rows[0].id],
    ),
  );
}

export async function recordEnterpriseReceipt(
  db: PoolClient,
  reference: string,
  receipt: string,
  amount: number,
  channel: 'paybill' | 'stk',
) {
  if (!receipt || !Number.isFinite(amount) || amount <= 0) throw new Error('Invalid enterprise payment details.');
  const { rows } = await db.query('SELECT * FROM enterprise_invoices WHERE reference=$1 FOR UPDATE', [reference]);
  if (!rows.length) throw new Error('Enterprise invoice reference needs reconciliation.');
  const payment = await db.query(
    `INSERT INTO enterprise_mpesa_receipts(receipt,reference,amount,channel)
    VALUES ($1,$2,$3,$4) ON CONFLICT (receipt) DO NOTHING`,
    [receipt, reference, amount, channel],
  );
  if (!payment.rowCount) return;
  const updated = await db.query(
    `UPDATE enterprise_invoices SET received=received+$2::numeric,
    settled_at=CASE WHEN received+$2::numeric>=amount THEN coalesce(settled_at,now()) END
    WHERE reference=$1 RETURNING settled_at`,
    [reference, amount],
  );
  if (!rows[0].settled_at && updated.rows[0].settled_at) {
    await db.query(
      `UPDATE enterprise_coverage SET paid_until=greatest(now(),paid_until)+interval '1 month'
      WHERE organization_id=$1`,
      [rows[0].organization_id],
    );
  }
}
