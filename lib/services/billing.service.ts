import { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { FeatureGatedError, MemberCapError, PaymentRequiredError, NotFoundError } from '@/lib/utils/errors';
import {
  PLAN_FEATURES, PLAN_MONTHLY_FEES, DEFAULT_PRODUCT,
  type PlanType, type SubscriptionProduct, type PlanFeatures,
} from '@/types/enums';
import type { Subscription, Invoice, Payment, BillingAccount } from '@/types/db.types';
import type { RecordManualPaymentInput } from '@/lib/validators/billing.schema';
import { postTemplatedJournal } from './posting-templates.service';
import { getUnitPrice } from './sms-pricing.service';

/**
 * Give a group the general ledger its new product needs.
 *
 * Since migration 140 a Chama Reminder signup gets NO chart of accounts —
 * a communication-only group has nothing to post journals against. Buying
 * Kitabu Yetu later is precisely the conversion the whole acquisition strategy
 * exists for, and without this it would produce a group whose every accounting
 * path throws "Account code(s) not in your chart of accounts" from deep inside
 * a posting template, pointing nowhere near the cause.
 *
 * Idempotent (the SQL function is ON CONFLICT DO NOTHING), so this is a no-op
 * for the groups that already have one — which is all of them today. Runs on
 * the caller's client so it lands in the same commit as the activation.
 */
async function ensureChartOfAccounts(
  client: PoolClient,
  groupId: string,
  product: SubscriptionProduct,
): Promise<void> {
  if (product !== 'kitabu_yetu') return;
  await client.query(`SELECT seed_chart_of_accounts($1)`, [groupId]);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A TenantContext.userId that is safe to store in a UUID column.
 *
 * Background-driven paths (the M-Pesa callback most of all) run with no
 * interactive user and pass the sentinel string 'system'. Writing that into a
 * uuid column throws `invalid input syntax for type uuid` — which is exactly
 * how the top-up suite caught this.
 */
function actorId(userId: string | undefined): string | null {
  return userId && UUID_RE.test(userId) ? userId : null;
}

/**
 * Whether this group has a general ledger at all. Only a Chama-Reminder-only
 * group does not (migration 140), so this is true for every group that predates
 * that migration.
 */
async function hasChartOfAccounts(client: PoolClient, groupId: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM accounts WHERE group_id = $1 LIMIT 1`, [groupId],
  );
  return rows.length > 0;
}

/**
 * Every method here takes an optional `product`, defaulting to kitabu_yetu, so
 * existing callers are unchanged. Since migration 127 a group can hold one
 * ACTIVE subscription *per product*, which makes the bare
 * `WHERE group_id = $1 AND status = 'active' LIMIT 1` these methods used to
 * share an arbitrary pick rather than a lookup.
 */
export const billingService = {

  async getSubscription(
    ctx: TenantContext,
    product: SubscriptionProduct = DEFAULT_PRODUCT,
  ): Promise<Subscription | null> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<Subscription>(
        `SELECT * FROM subscriptions
         WHERE group_id = $1 AND product = $2 AND status = 'active' LIMIT 1`,
        [ctx.groupId, product],
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

  async createStarterSubscription(
    ctx: TenantContext,
    client: PoolClient,
    product: SubscriptionProduct = DEFAULT_PRODUCT,
  ): Promise<Subscription> {
    // Called after group registration — provisions Starter plan + billing account
    await client.query<BillingAccount>(
      `INSERT INTO billing_accounts (group_id) VALUES ($1)
       ON CONFLICT (group_id) DO UPDATE SET group_id = EXCLUDED.group_id`,
      [ctx.groupId],
    );

    // The bare ON CONFLICT DO NOTHING (no target) still works across migration
    // 127: it fires on whichever unique constraint is violated, which is now
    // the wider (group_id, product) one.
    const { rows: sub } = await client.query<Subscription>(
      `INSERT INTO subscriptions
         (group_id, product, plan_type, status, started_at, monthly_fee, sms_rate, max_members)
       VALUES ($1, $2, 'starter', 'active', NOW(), 0, $3, NULL)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [ctx.groupId, product, (await getUnitPrice(0, client)).toFixed(4)],
    );
    // ON CONFLICT DO NOTHING returns no rows when a subscription already exists.
    // In that case, fetch the existing active subscription instead.
    if (sub[0]) return sub[0];
    const { rows: existing } = await client.query<Subscription>(
      `SELECT * FROM subscriptions
       WHERE group_id = $1 AND product = $2 AND status = 'active' LIMIT 1`,
      [ctx.groupId, product],
    );
    return existing[0];
  },

  /**
   * Activate a paid plan against a CONFIRMED payment. This is the only way a
   * paid subscription is ever created — see the note on upgradePlan below for
   * what this replaced.
   *
   * Runs on a caller-supplied client so it can join the M-Pesa callback's own
   * transaction: the subscription flips in the same commit that marks the
   * payment completed, exactly as contributions and loan repayments do.
   *
   * Exactly-once per payment. Two callers race here by design — Safaricom's
   * callback and the billing page claiming its own poll result — and a
   * replayed callback re-enters on top of that. Serialising on the payment row
   * plus the `already consumed` check makes every entrant after the first a
   * no-op; UNIQUE(payment_id) (migration 138) is the backstop if two
   * transactions somehow slip past the lock, in which case the loser's
   * transaction aborts and nothing is half-applied.
   *
   * Returns the new subscription, or null when the payment was already
   * consumed (which callers should treat as success, not failure).
   */
  async activateSubscriptionForPayment(
    client: PoolClient,
    params: {
      groupId:   string;
      planType:  PlanType;
      product:   SubscriptionProduct;
      paymentId: string;
      amountPaid: number;
    },
  ): Promise<Subscription | null> {
    const { groupId, planType, product, paymentId, amountPaid } = params;

    // Serialise every activation attempt for this payment behind one lock, so
    // the check-then-act below cannot interleave with a concurrent replay.
    await client.query(`SELECT id FROM payments WHERE id = $1 FOR UPDATE`, [paymentId]);

    const { rows: consumed } = await client.query<{ id: string }>(
      `SELECT id FROM subscriptions WHERE payment_id = $1`, [paymentId],
    );
    if (consumed[0]) return null;

    const fee = PLAN_MONTHLY_FEES[product][planType];

    // Never activate a plan the payment does not cover. Underpayment is not an
    // error the payer can be told about here (this runs inside a Safaricom
    // callback), so it is refused and left for ops: the payment row stays
    // completed and the group simply keeps its current plan.
    if (fee <= 0) {
      throw new PaymentRequiredError(
        `Plan "${planType}" on ${product} is not self-serve — it is negotiated and must be activated manually.`,
      );
    }
    if (amountPaid < fee) {
      throw new PaymentRequiredError(
        `Paid KES ${amountPaid} does not cover the ${planType} plan on ${product} (KES ${fee}).`,
      );
    }

    // Cancel the current plan FOR THIS PRODUCT ONLY. Without the product
    // predicate this cancelled every active row the group had, so upgrading
    // Kitabu Yetu would silently cancel the group's Chama Reminder
    // subscription — and the INSERT below would then be the only active row
    // left, with no trace of what was destroyed. It also has to happen before
    // the INSERT: idx_subscriptions_one_active_per_product forbids a second
    // active row for the same (group, product).
    await client.query(
      `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW()
       WHERE group_id = $1 AND product = $2 AND status = 'active'`,
      [groupId, product],
    );

    const smsRate    = await getUnitPrice(0, client);
    const maxMembers = PLAN_FEATURES[product][planType].maxMembers;

    const { rows } = await client.query<Subscription>(
      `INSERT INTO subscriptions
         (group_id, product, plan_type, status, started_at, next_billing_date,
          monthly_fee, sms_rate, max_members, payment_id)
       VALUES ($1,$2,$3,'active',NOW(), (CURRENT_DATE + INTERVAL '1 month')::date, $4,$5,$6,$7)
       RETURNING *`,
      [groupId, product, planType, fee.toFixed(2), smsRate.toFixed(4), maxMembers, paymentId],
    );

    await ensureChartOfAccounts(client, groupId, product);

    return rows[0];
  },

  /**
   * Activate a plan WITHOUT payment. Administrative only.
   *
   * This used to be the public upgrade path, reachable by any chairperson via
   * POST /api/v1/billing/plans, and it set status='active' unconditionally —
   * so a group could self-upgrade to any plan with zero money changing hands.
   * The billing page did run an STK push first, but that ordering was purely
   * client-side and the server never checked it. Paid activation now goes
   * through activateSubscriptionForPayment(), and the route requires a
   * confirmed payment.
   *
   * What remains here is the genuinely payment-free cases: negotiated
   * enterprise deals and support/ops corrections. Callers must enforce their
   * own authorisation — nothing inside this function checks who is asking.
   */
  async activatePlanWithoutPayment(
    ctx: TenantContext,
    planType: PlanType,
    product: SubscriptionProduct = DEFAULT_PRODUCT,
  ): Promise<Subscription> {
    return withTransaction(ctx, async (client) => {
      await client.query(
        `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW()
         WHERE group_id = $1 AND product = $2 AND status = 'active'`,
        [ctx.groupId, product],
      );

      const fee        = PLAN_MONTHLY_FEES[product][planType];
      const smsRate    = await getUnitPrice(0, client);
      const maxMembers = PLAN_FEATURES[product][planType].maxMembers;

      const { rows } = await client.query<Subscription>(
        `INSERT INTO subscriptions
           (group_id, product, plan_type, status, started_at, next_billing_date, monthly_fee, sms_rate, max_members)
         VALUES ($1,$2,$3,'active',NOW(), (CURRENT_DATE + INTERVAL '1 month')::date, $4,$5,$6)
         RETURNING *`,
        [ctx.groupId, product, planType, fee.toFixed(2), smsRate.toFixed(4), maxMembers],
      );

      await ensureChartOfAccounts(client, ctx.groupId, product);

      return rows[0];
    });
  },

  /**
   * Find a completed, not-yet-consumed M-Pesa payment for this group that was
   * made for the given plan, so the billing page can claim its own poll result
   * without trusting the client about whether money moved.
   */
  async findClaimablePayment(
    client: PoolClient,
    params: { groupId: string; planType: PlanType; product: SubscriptionProduct },
  ): Promise<{ paymentId: string; amount: number } | null> {
    const { rows } = await client.query<{ id: string; amount: string }>(
      `SELECT p.id, p.amount
       FROM   payments p
       JOIN   mpesa_stk_requests s
              ON s.checkout_request_id = p.mpesa_checkout_request_id
       WHERE  p.group_id  = $1
         AND  p.status    = 'completed'
         AND  s.purpose   = 'subscription'
         AND  s.plan_type = $2
         AND  s.product   = $3
         AND  NOT EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.payment_id = p.id)
       ORDER BY p.payment_date DESC
       LIMIT  1`,
      [params.groupId, params.planType, params.product],
    );
    return rows[0] ? { paymentId: rows[0].id, amount: Number(rows[0].amount) } : null;
  },

  async assertFeatureAccess(
    ctx: TenantContext,
    feature: keyof PlanFeatures,
    product: SubscriptionProduct = DEFAULT_PRODUCT,
  ): Promise<void> {
    const sub = await this.getSubscription(ctx, product);
    if (!sub) throw new PaymentRequiredError('No active subscription');
    const plans    = PLAN_FEATURES[product];
    const features = plans[sub.plan_type];
    if (!features[feature]) {
      const requiredPlans = (Object.entries(plans) as [PlanType, PlanFeatures][])
        .filter(([, f]) => f[feature])
        .map(([p]) => p)
        .join(' or ');
      throw new FeatureGatedError(feature, requiredPlans);
    }
  },

  /**
   * Members are a GROUP-level resource — one member list, shared by every
   * product the group holds — so the cap cannot be read off one arbitrary
   * subscription. Take the most permissive entitlement the group has paid for:
   * a single NULL (unlimited) anywhere wins outright, otherwise the largest cap.
   *
   * Inert today: PLAN_FEATURES sets maxMembers null on every plan, so
   * bool_or(...) is always true and this returns early exactly as before.
   */
  async assertMemberCap(ctx: TenantContext, client: PoolClient): Promise<void> {
    const { rows: sub } = await client.query<{ unlimited: boolean; cap: number | null }>(
      `SELECT bool_or(max_members IS NULL) AS unlimited, MAX(max_members) AS cap
       FROM subscriptions WHERE group_id = $1 AND status = 'active'`,
      [ctx.groupId],
    );
    // No active subscription at all → aggregate over zero rows gives
    // unlimited=NULL and cap=NULL, which falls through to the same
    // "no cap to enforce" early return the old LIMIT 1 miss produced.
    const cap = sub[0]?.cap;
    if (sub[0]?.unlimited !== false || cap === null || cap === undefined) return;

    const { rows: count } = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM group_members WHERE group_id = $1 AND is_active = true`,
      [ctx.groupId],
    );
    if (parseInt(count[0].count, 10) >= cap) {
      throw new MemberCapError(cap);
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
      //
      // Skipped for a group with no chart of accounts (migration 140). This is
      // reachable: /api/v1/billing is outside the subscription lock, so a
      // Chama-Reminder-only group can record a payment here, and the template
      // needs accounts 1001 and 5003 — it would fail with an account-codes
      // error that says nothing about the real cause. Recording the payment
      // still matters to such a group; posting a journal it has no ledger for
      // does not.
      if (await hasChartOfAccounts(client, ctx.groupId)) {
        await postTemplatedJournal(
          client, ctx.groupId, ctx.userId, 'subscription_payment',
          `Platform subscription payment${data.invoiceId ? ` — invoice ${data.invoiceId}` : ''}`,
          { amount: data.amount },
          { reference: rows[0].id },
        );
      }

      return rows[0];
    });
  },

  async addSmsCredits(ctx: TenantContext, amountKes: number, paymentId?: string): Promise<void> {
    return withTransaction(ctx, async (client) => {
      // MIN across every active subscription, matching reserve_sms_credits'
      // own rule exactly (migration 127). These two must agree: this decides
      // how many credits a top-up buys, that one decides what a send costs, and
      // a group whose products disagree on rate would otherwise be sold credits
      // at one price and charged at another.
      const { rows: sub } = await client.query<{ sms_rate: string | null }>(
        `SELECT MIN(sms_rate) AS sms_rate FROM subscriptions
         WHERE group_id = $1 AND status = 'active'`,
        [ctx.groupId],
      );
      const rate     = parseFloat(sub[0]?.sms_rate ?? '0.90');
      const credits  = amountKes / rate;

      const { rows: ba } = await client.query<{ id: string }>(
        `SELECT id FROM billing_accounts WHERE group_id = $1`, [ctx.groupId],
      );

      // Ledger insert first, and it decides whether the balance moves. A
      // replayed STK callback re-enters here with the same payment_id (the
      // route re-runs processFulfillment on every replay — handleSTKCallback
      // computes `alreadyDone` but never returns it), so the UNIQUE(payment_id)
      // added in migration 137 is what makes a top-up exactly-once. If the
      // insert is swallowed by ON CONFLICT we must NOT touch the balance,
      // otherwise the replay credits the group a second time.
      //
      // Manual grants pass paymentId undefined -> NULL, and Postgres allows
      // many NULLs under a UNIQUE constraint, so those still apply every time.
      const { rows: inserted } = await client.query<{ id: string }>(
        // remaining_credits starts at the full purchase (migration 146): a lot
        // is drawn down FIFO as messages are actually consumed, which is what
        // lets §4 hold — this batch keeps the rate it was bought at no matter
        // what later purchases cost.
        `INSERT INTO sms_credits
           (group_id, billing_account_id, amount_paid, credits_added, remaining_credits, rate_applied, payment_id)
         VALUES ($1,$2,$3,$4,$4,$5,$6)
         ON CONFLICT (payment_id) DO NOTHING
         RETURNING id`,
        [ctx.groupId, ba[0].id, amountKes.toFixed(2), credits.toFixed(4), rate.toFixed(4), paymentId ?? null],
      );
      if (!inserted[0]) return;

      const { rows: after } = await client.query<{ sms_credits: string }>(
        `UPDATE billing_accounts SET sms_credits = sms_credits + $1 WHERE group_id = $2
         RETURNING sms_credits`,
        [credits.toFixed(4), ctx.groupId],
      );

      // Ledger entry for the purchase (migration 141). Same transaction and
      // after the ON CONFLICT guard above, so a replayed callback that credits
      // nothing also records nothing — the ledger must never claim a movement
      // the balance did not make, or reconciliation stops meaning anything.
      //
      // created_by is NULL for anything the M-Pesa callback drives: that path
      // runs with no interactive user and passes the sentinel ctx.userId
      // 'system', which is not a UUID. Recording "no human did this" is also
      // the honest answer.
      await client.query(
        `SELECT sms_ledger_append($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9::uuid,$10::uuid,$11::uuid,$12)`,
        [
          'group', ctx.groupId, null, 'purchase',
          credits.toFixed(4), 0, after[0]?.sms_credits ?? null,
          'sms_topup', inserted[0].id, paymentId ?? null, actorId(ctx.userId), null,
        ],
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
