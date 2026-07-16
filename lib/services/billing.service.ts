import { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { FeatureGatedError, MemberCapError, PaymentRequiredError, NotFoundError } from '@/lib/utils/errors';
import { PLAN_FEATURES, PLAN_MONTHLY_FEES, SMS_RATES } from '@/types/enums';
import type { Subscription, Invoice, Payment, BillingAccount } from '@/types/db.types';
import type { PlanType } from '@/types/enums';
import type { RecordManualPaymentInput } from '@/lib/validators/billing.schema';
import { postTemplatedJournal } from './posting-templates.service';

export const billingService = {

  async getSubscription(ctx: TenantContext): Promise<Subscription | null> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<Subscription>(
        `SELECT * FROM subscriptions WHERE group_id = $1 AND status = 'active' LIMIT 1`,
        [ctx.groupId],
      );
      return rows[0] ?? null;
    });
  },

  async getBillingAccount(ctx: TenantContext): Promise<BillingAccount> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<BillingAccount>(
        `SELECT * FROM billing_accounts WHERE group_id = $1`,
        [ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Billing account');
      return rows[0];
    });
  },

  async createStarterSubscription(ctx: TenantContext, client: PoolClient): Promise<Subscription> {
    // Called after group registration — provisions Starter plan + billing account
    await client.query<BillingAccount>(
      `INSERT INTO billing_accounts (group_id) VALUES ($1)
       ON CONFLICT (group_id) DO UPDATE SET group_id = EXCLUDED.group_id`,
      [ctx.groupId],
    );

    const { rows: sub } = await client.query<Subscription>(
      `INSERT INTO subscriptions
         (group_id, plan_type, status, started_at, monthly_fee, sms_rate, max_members)
       VALUES ($1, 'starter', 'active', NOW(), 0, $2, NULL)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [ctx.groupId, SMS_RATES.starter(0).toFixed(4)],
    );
    // ON CONFLICT DO NOTHING returns no rows when a subscription already exists.
    // In that case, fetch the existing active subscription instead.
    if (sub[0]) return sub[0];
    const { rows: existing } = await client.query<Subscription>(
      `SELECT * FROM subscriptions WHERE group_id = $1 AND status = 'active' LIMIT 1`,
      [ctx.groupId],
    );
    return existing[0];
  },

  async upgradePlan(ctx: TenantContext, planType: PlanType): Promise<Subscription> {
    return withTransaction(ctx, async (client) => {
      // Expire current subscription
      await client.query(
        `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW()
         WHERE group_id = $1 AND status = 'active'`,
        [ctx.groupId],
      );

      const fee        = PLAN_MONTHLY_FEES[planType];
      const smsRate    = SMS_RATES[planType](0);
      const maxMembers = PLAN_FEATURES[planType].maxMembers;

      const { rows } = await client.query<Subscription>(
        `INSERT INTO subscriptions
           (group_id, plan_type, status, started_at, next_billing_date, monthly_fee, sms_rate, max_members)
         VALUES ($1,$2,'active',NOW(), (CURRENT_DATE + INTERVAL '1 month')::date, $3,$4,$5)
         RETURNING *`,
        [ctx.groupId, planType, fee.toFixed(2), smsRate.toFixed(4), maxMembers],
      );
      return rows[0];
    });
  },

  async assertFeatureAccess(ctx: TenantContext, feature: keyof typeof PLAN_FEATURES['starter']): Promise<void> {
    const sub = await this.getSubscription(ctx);
    if (!sub) throw new PaymentRequiredError('No active subscription');
    const features = PLAN_FEATURES[sub.plan_type];
    if (!features[feature]) {
      const requiredPlans = (Object.entries(PLAN_FEATURES) as [PlanType, typeof features][])
        .filter(([, f]) => f[feature])
        .map(([p]) => p)
        .join(' or ');
      throw new FeatureGatedError(feature, requiredPlans);
    }
  },

  async assertMemberCap(ctx: TenantContext, client: PoolClient): Promise<void> {
    const { rows: sub } = await client.query<{ max_members: number | null }>(
      `SELECT max_members FROM subscriptions WHERE group_id = $1 AND status = 'active' LIMIT 1`,
      [ctx.groupId],
    );
    if (!sub[0] || sub[0].max_members === null) return; // unlimited

    const { rows: count } = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM group_members WHERE group_id = $1 AND is_active = true`,
      [ctx.groupId],
    );
    if (parseInt(count[0].count, 10) >= sub[0].max_members) {
      throw new MemberCapError(sub[0].max_members);
    }
  },

  async listInvoices(ctx: TenantContext): Promise<Invoice[]> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<Invoice>(
        `SELECT * FROM invoices WHERE group_id = $1 ORDER BY invoice_date DESC`,
        [ctx.groupId],
      );
      return rows;
    });
  },

  async generateInvoice(
    ctx: TenantContext,
    items: { description: string; quantity: number; unitPrice: number }[],
    dueInDays = 14,
  ): Promise<Invoice> {
    return withTransaction(ctx, async (client) => {
      const { rows: ba } = await client.query<{ id: string }>(
        `SELECT id FROM billing_accounts WHERE group_id = $1`,
        [ctx.groupId],
      );
      if (!ba[0]) throw new NotFoundError('Billing account');

      const subtotal    = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const invoiceNum  = await getNextInvoiceNumber(client);

      const { rows: inv } = await client.query<Invoice>(
        `INSERT INTO invoices
           (group_id, billing_account_id, invoice_number, invoice_date, due_date,
            subtotal, total_amount)
         VALUES ($1,$2,$3,CURRENT_DATE,(CURRENT_DATE + $4::int * INTERVAL '1 day')::date,$5,$5)
         RETURNING *`,
        [ctx.groupId, ba[0].id, invoiceNum, dueInDays, subtotal.toFixed(2)],
      );
      const invoice = inv[0];

      for (const item of items) {
        await client.query(
          `INSERT INTO invoice_items (group_id, invoice_id, description, quantity, unit_price, total)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [ctx.groupId, invoice.id, item.description, item.quantity, item.unitPrice.toFixed(2), (item.quantity * item.unitPrice).toFixed(2)],
        );
      }
      return invoice;
    });
  },

  async recordPayment(ctx: TenantContext, data: RecordManualPaymentInput): Promise<Payment> {
    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query<Payment>(
        `INSERT INTO payments
           (group_id, invoice_id, amount, payment_method, status, payment_date, recorded_by,
            mpesa_receipt_number, notes)
         VALUES ($1,$2,$3,$4,'completed',$5,$6,$7,$8) RETURNING *`,
        [
          ctx.groupId, data.invoiceId ?? null,
          data.amount.toFixed(2), data.paymentMethod,
          data.paymentDate, ctx.userId,
          data.mpesaReceiptNumber ?? null,
          data.notes ?? null,
        ],
      );

      if (data.invoiceId) {
        await client.query(
          `UPDATE invoices
           SET paid_amount = paid_amount + $1,
               status = CASE WHEN paid_amount + $1 >= total_amount THEN 'completed' ELSE status END
           WHERE id = $2`,
          [data.amount.toFixed(2), data.invoiceId],
        );
      }

      // ACCOUNTING_ARCHITECTURE_AUDIT.md §7: the seeded 5003 Platform
      // Subscription expense account was previously dead code — no payment
      // path ever posted to it.
      await postTemplatedJournal(
        client, ctx.groupId, ctx.userId, 'subscription_payment',
        `Platform subscription payment${data.invoiceId ? ` — invoice ${data.invoiceId}` : ''}`,
        { amount: data.amount },
        { reference: rows[0].id },
      );

      return rows[0];
    });
  },

  async addSmsCredits(ctx: TenantContext, amountKes: number, paymentId?: string): Promise<void> {
    return withTransaction(ctx, async (client) => {
      const { rows: sub } = await client.query<{ sms_rate: string }>(
        `SELECT sms_rate FROM subscriptions WHERE group_id = $1 AND status = 'active' LIMIT 1`,
        [ctx.groupId],
      );
      const rate     = parseFloat(sub[0]?.sms_rate ?? '0.90');
      const credits  = amountKes / rate;

      await client.query(
        `UPDATE billing_accounts SET sms_credits = sms_credits + $1 WHERE group_id = $2`,
        [credits.toFixed(4), ctx.groupId],
      );

      const { rows: ba } = await client.query<{ id: string }>(
        `SELECT id FROM billing_accounts WHERE group_id = $1`, [ctx.groupId],
      );

      await client.query(
        `INSERT INTO sms_credits (group_id, billing_account_id, amount_paid, credits_added, rate_applied, payment_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [ctx.groupId, ba[0].id, amountKes.toFixed(2), credits.toFixed(4), rate.toFixed(4), paymentId ?? null],
      );
    });
  },
};

async function getNextInvoiceNumber(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ next_invoice_number: string }>(
    `SELECT next_invoice_number()`,
  );
  return rows[0].next_invoice_number;
}
