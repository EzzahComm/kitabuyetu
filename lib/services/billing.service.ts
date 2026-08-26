import { PoolClient } from 'pg';
import { withDb, withTransaction, withAdminDb, type TenantContext } from '@/lib/db';
import {
  FeatureGatedError, MemberCapError, PaymentRequiredError, NotFoundError, ValidationError,
} from '@/lib/utils/errors';
import {
  PLAN_FEATURES, PLAN_MONTHLY_FEES, PLAN_SMS_ALLOWANCE, PLAN_COPY, PRODUCT_LABEL, DEFAULT_PRODUCT,
  BILLING_CYCLE_MONTHS, type PlanType, type SubscriptionProduct, type PlanFeatures, type BillingCycle,
} from '@/types/enums';
import { logger } from '@/lib/logger';
import type { Subscription, Invoice, Payment, BillingAccount } from '@/types/db.types';
import type { RecordManualPaymentInput } from '@/lib/validators/billing.schema';
import { postTemplatedJournal } from './posting-templates.service';
import { getUnitPrice } from './sms-pricing.service';
import { clearLowBalanceFlag, clearOrganizationLowBalanceFlag } from './messaging-billing';

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

/**
 * Confirm an SMS credit top-up to the person who bought it.
 *
 * Top-ups used to be covered by the generic M-Pesa receipt, which resolved
 * its variables from a UNION over contributions / loan_repayments /
 * welfare_pool_contributions. A top-up is none of those, so the only message
 * a buyer ever got read "KES 100 received for (A/C ). Balance: KES ." — and
 * once that receipt was correctly suppressed (it could not say what the money
 * did) top-ups were left with no confirmation at all. This is the replacement
 * that can actually describe the purchase.
 *
 * Same shape and same reasoning as sendSubscriptionConfirmation below:
 * addressed by first name, names the group, sent to the REGISTERED number
 * rather than whichever M-Pesa line happened to pay, and best-effort so a
 * failure to confirm can never roll back credits already bought.
 */
async function sendTopupConfirmation(
  args: {
    groupId:      string;
    paymentId:    string | null;
    amountKes:    number;
    creditsAdded: number;
    newBalance:   string | null;
  },
): Promise<void> {
  try {
    // Its OWN connection, deliberately — see addSmsCredits' note. Running this
    // on the caller's transactional client meant a failed lookup poisoned the
    // transaction and rolled the credit back.
    const { rows: [target] } = await withAdminDb((client) => client.query<{
      member_id: string; first_name: string; phone: string; group_name: string; receipt: string | null;
    }>(
      `SELECT m.id AS member_id, m.first_name, m.phone, g.name AS group_name,
              p.mpesa_receipt_number AS receipt
       FROM   groups g
       JOIN   group_members gm ON gm.group_id = g.id AND gm.status = 'active'
       JOIN   members m        ON m.id = gm.member_id AND m.is_active = true
       LEFT   JOIN payments p  ON p.id = $2
       WHERE  g.id = $1
       ORDER  BY (p.initiated_by IS NOT NULL AND m.id = p.initiated_by) DESC,
                 (gm.role = 'treasurer') DESC,
                 (gm.role = 'chairperson') DESC,
                 gm.created_at ASC
       LIMIT  1`,
      [args.groupId, args.paymentId],
    ));
    if (!target) return;

    const credits = Math.round(args.creditsAdded);
    const balance = args.newBalance != null ? Math.round(Number(args.newBalance)) : null;

    const body =
      `Dear ${target.first_name}, KES ${args.amountKes.toLocaleString()} of SMS credits `
      + `has been added to ${target.group_name}. Credits added: ${credits.toLocaleString()}.`
      + (balance != null ? ` New balance: ${balance.toLocaleString()} messages.` : '')
      + (target.receipt ? ` Receipt: ${target.receipt}.` : '')
      + ' Thank you.';

    const { notifyMember } = await import('./notifications.service');
    await notifyMember({
      groupId:  args.groupId,
      memberId: target.member_id,
      phone:    target.phone,
      body,
      title:            'SMS credits added',
      referenceType:    'sms_topup',
      referenceId:      args.paymentId ?? undefined,
      notificationType: 'sms_topup.credited',
      billingMode:      'unbilled',
    });
  } catch (err) {
    logger.error('[billing] top-up confirmation failed to send (non-fatal)', {
      groupId: args.groupId, err: String(err),
    });
  }
}

/**
 * Confirm an activated subscription to the person who bought it.
 *
 * Written after a real incident: a group paid KES 150 for Starter, the plan
 * activated correctly, and the only message sent was the GENERIC M-Pesa
 * receipt — which was wrong twice over.
 *
 *  1. It went to `payments.mpesa_phone`, the number that paid, NOT the
 *     member's registered number. The registered chairperson received
 *     nothing at all.
 *  2. Its template variables came from a UNION over contributions /
 *     loan_repayments / welfare_pool_contributions. A subscription payment is
 *     none of those, so group_name / membership_no / product / balance all
 *     resolved empty and the SMS read literally:
 *       "KES 150 received for (A/C ). Receipt: UHFQZ2SPYV. Balance: KES ."
 *
 * A subscription is its own event and deserves its own message, so this sends
 * one directly via notifyMember (the proven path — it honours opt-out, writes
 * the in-app copy, and never throws) rather than through the receipt template.
 *
 * Best-effort by design: a failure to CONFIRM a subscription must never roll
 * back the subscription itself.
 */
async function sendSubscriptionConfirmation(
  args: {
    groupId:  string;
    paymentId: string | null;
    planType: PlanType;
    product:  SubscriptionProduct;
    amount:   number;
    receipt:  string | null;
  },
): Promise<void> {
  try {
    // The registered member, not the payer. Prefer whoever initiated the
    // payment; fall back to the group's chairperson so a group whose payment
    // came in headless (callback replay, ops correction) still gets told.
    //
    // On its OWN connection, not the caller's transactional client. This
    // shipped reading the caller's client and only survived because
    // activateSubscriptionForPayment is driven from the M-Pesa callback on the
    // admin (BYPASSRLS) pool — the identical construct in addSmsCredits, which
    // uses the TENANT pool, had its lookup refused under real RLS, poisoned
    // the transaction, and rolled back the credit. A swallowed query error
    // does not un-abort a Postgres transaction, so a best-effort side effect
    // sharing the money transaction's client can still destroy it, silently.
    const { rows: [target] } = await withAdminDb((client) => client.query<{
      member_id: string; first_name: string; phone: string; group_name: string; receipt: string | null;
    }>(
      `SELECT m.id AS member_id, m.first_name, m.phone, g.name AS group_name,
              p.mpesa_receipt_number AS receipt
       FROM   groups g
       JOIN   group_members gm ON gm.group_id = g.id AND gm.status = 'active'
       JOIN   members m        ON m.id = gm.member_id AND m.is_active = true
       LEFT   JOIN payments p  ON p.id = $2
       WHERE  g.id = $1
       ORDER  BY (p.initiated_by IS NOT NULL AND m.id = p.initiated_by) DESC,
                 (gm.role = 'chairperson') DESC,
                 gm.created_at ASC
       LIMIT  1`,
      [args.groupId, args.paymentId],
    ));
    if (!target) return;

    const planLabel = PLAN_COPY[args.product].find((p) => p.type === args.planType)?.label
      ?? args.planType;
    const productLabel = PRODUCT_LABEL[args.product];
    const receipt = args.receipt ?? target.receipt;

    const body =
      `Dear ${target.first_name}, your ${productLabel} ${planLabel} subscription for `
      + `${target.group_name} is now active. Amount paid: KES ${args.amount.toLocaleString()}.`
      + (receipt ? ` Receipt: ${receipt}.` : '')
      + ' Thank you.';

    const { notifyMember } = await import('./notifications.service');
    await notifyMember({
      groupId:  args.groupId,
      memberId: target.member_id,
      phone:    target.phone,
      body,
      title:            'Subscription active',
      referenceType:    'subscription',
      referenceId:      args.paymentId ?? undefined,
      notificationType: 'subscription.activated',
      billingMode:      'unbilled',
    });
  } catch (err) {
    logger.error('[billing] subscription confirmation failed to send (non-fatal)', {
      groupId: args.groupId, err: String(err),
    });
  }
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
      /** Defaults to 'monthly' — every caller from before this param existed
       *  (the STK callback on an old client, the admin unrouted-payment path
       *  for a receipt with no recorded cycle) keeps today's behaviour. */
      billingCycle?: BillingCycle;
    },
  ): Promise<Subscription | null> {
    const { groupId, planType, product, paymentId, amountPaid } = params;
    const billingCycle = params.billingCycle ?? 'monthly';
    const cycleMonths  = BILLING_CYCLE_MONTHS[billingCycle];

    // Serialise every activation attempt for this payment behind one lock, so
    // the check-then-act below cannot interleave with a concurrent replay.
    await client.query(`SELECT id FROM payments WHERE id = $1 FOR UPDATE`, [paymentId]);

    const { rows: consumed } = await client.query<{ id: string }>(
      `SELECT id FROM subscriptions WHERE payment_id = $1`, [paymentId],
    );
    if (consumed[0]) return null;

    // The TRUE monthly rate — this is what gets stored on subscriptions.
    // monthly_fee (admin.service.ts sums that column directly for MRR), never
    // multiplied by cycleMonths. `fee` below is what this cycle actually
    // costs, used only to verify the payment and to compute next_billing_date.
    const monthlyRate = PLAN_MONTHLY_FEES[product][planType];
    const fee = monthlyRate * cycleMonths;

    // Never activate a plan the payment does not cover. Underpayment is not an
    // error the payer can be told about here (this runs inside a Safaricom
    // callback), so it is refused and left for ops: the payment row stays
    // completed and the group simply keeps its current plan.
    if (monthlyRate <= 0) {
      throw new PaymentRequiredError(
        `Plan "${planType}" on ${product} is not self-serve — it is negotiated and must be activated manually.`,
      );
    }
    if (amountPaid < fee) {
      throw new PaymentRequiredError(
        `Paid KES ${amountPaid} does not cover the ${planType} plan on ${product} for one ${billingCycle} cycle (KES ${fee}).`,
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
      // sms_allowance_included is set EXPLICITLY. Omitting it silently took
      // the column default of 50 for every plan, so premium bought the same
      // allowance as starter while the pricing copy promised more.
      //
      // monthly_fee is monthlyRate (the normalized rate), NOT fee (what this
      // cycle actually cost) — see the comment on migration 155 and on
      // `fee` above. next_billing_date steps forward by the full cycle, not
      // always one month, so a quarterly/annual payer isn't re-billed early.
      `INSERT INTO subscriptions
         (group_id, product, plan_type, status, started_at, next_billing_date,
          monthly_fee, billing_cycle, sms_rate, max_members, sms_allowance_included, payment_id)
       VALUES ($1,$2,$3,'active',NOW(), (CURRENT_DATE + (INTERVAL '1 month' * $4))::date, $5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [groupId, product, planType, cycleMonths, monthlyRate.toFixed(2), billingCycle,
       smsRate.toFixed(4), maxMembers, PLAN_SMS_ALLOWANCE[product][planType], paymentId],
    );

    await ensureChartOfAccounts(client, groupId, product);

    await sendSubscriptionConfirmation({
      groupId, paymentId, planType, product,
      amount: fee,
      receipt: null,
    });

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
        // Same explicit allowance as the paid-activation path above — the two
        // INSERTs must not drift, which is what let the default win here.
        `INSERT INTO subscriptions
           (group_id, product, plan_type, status, started_at, next_billing_date,
            monthly_fee, sms_rate, max_members, sms_allowance_included)
         VALUES ($1,$2,$3,'active',NOW(), (CURRENT_DATE + INTERVAL '1 month')::date, $4,$5,$6,$7)
         RETURNING *`,
        [ctx.groupId, product, planType, fee.toFixed(2), smsRate.toFixed(4), maxMembers,
         PLAN_SMS_ALLOWANCE[product][planType]],
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
    // The confirmation is sent AFTER this transaction commits, never inside
    // it. First attempt put it inside and CI's app_tenant (real RLS) job
    // caught the consequence immediately: top-ups credited 0 instead of
    // 111.11 and no ledger row was written.
    //
    // The reason is worth remembering. Catching a JS error from a query does
    // NOT un-abort the Postgres transaction it ran in — once any statement
    // fails, the transaction is poisoned and its COMMIT degrades to a
    // ROLLBACK. So a "best-effort, never throws" side effect running on the
    // transactional client can still destroy the money work around it, and it
    // does so silently, because the swallowed error looks handled. Under
    // BYPASSRLS locally the SELECT succeeded and everything passed; under real
    // RLS it did not, and took the credit with it.
    //
    // Anything best-effort therefore belongs outside the money transaction.
    const confirm = await withTransaction(ctx, async (client) => {
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
      if (!inserted[0]) return null;

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

      // Returned from inside the ON CONFLICT guard, so a replayed callback
      // that credits nothing also confirms nothing — a second "your credits
      // are topped up" for one purchase is exactly as wrong as a second
      // credit. Sent below, after this transaction has committed.
      return {
        groupId:   ctx.groupId,
        paymentId: paymentId ?? null,
        amountKes,
        creditsAdded: credits,
        newBalance:   after[0]?.sms_credits ?? null,
      };
    });

    if (confirm) {
      // Re-arm the low-balance alert. raiseLowBalanceAlert() claims by moving
      // low_balance_notified_at and then refuses to fire again for 24h, so
      // without this a group that ran dry, got warned, and topped up the same
      // day would run dry a second time in silence. clearLowBalanceFlag()
      // existed for exactly this and had no callers.
      //
      // Outside the money transaction and best-effort, for the reason spelled
      // out at the top of this function: a swallowed error on the
      // transactional client still poisons the COMMIT.
      await clearLowBalanceFlag(ctx.groupId);
      await sendTopupConfirmation(confirm);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Organization SMS credits — the org-side mirror of billingService.addSmsCredits.
//
// organization_billing_accounts / organization_sms_credits (migration 051)
// mirror billing_accounts / sms_credits for organizations exactly, but until
// now had NO writer anywhere in the app or in any migration's own seed data —
// found while shipping the super_admin SMS revenue-by-organization report.
//
// Unlike groups, an organization has NO real-time M-Pesa collection path at
// all today — organization-finance.service.ts's deposit() (the platform's
// only established organization money-in flow) is a manual, self-attested
// ledger entry: "Bank/M-Pesa settlement is reconciled separately." These
// functions mirror THAT pattern deliberately, not the group STK flow — the
// group payments/mpesa_stk_requests/mpesa_transactions spine has group_id
// NOT NULL throughout with no organization axis, and generalizing it is a
// much bigger, separate decision.
//
// Shaped like admin.service.ts's updateGroupProfile/updateMemberProfile
// (explicit target id + actor id, withAdminDb), not organization-finance
// .service.ts's TenantContext-based deposit() — these serve two callers with
// different privilege shapes: an organization_coordinator topping up their
// OWN org (the route derives organizationId from auth.organizationId, never
// client-supplied) and a super_admin correcting/granting ANY org's balance
// (previously impossible — no admin tool existed to adjust this at all).
// ─────────────────────────────────────────────────────────────────────────────

/** This org's SMS balance/rate + its most recent top-ups — the GET side. */
export async function getOrganizationSmsBilling(ctx: TenantContext): Promise<{
  balance: number;
  rate:    number | null;
  recent:  { id: string; amount_paid: string; credits_added: string; rate_applied: string; notes: string | null; created_at: string }[];
}> {
  if (!ctx.organizationId) throw new ValidationError('Organization context is required');
  const organizationId = ctx.organizationId;

  return withDb(ctx, async (db) => {
    const { rows: account } = await db.query<{ sms_credits: string; sms_rate: string }>(
      `SELECT sms_credits, sms_rate FROM organization_billing_accounts WHERE organization_id = $1`,
      [organizationId],
    );
    const { rows: recent } = await db.query<{
      id: string; amount_paid: string; credits_added: string; rate_applied: string; notes: string | null; created_at: string;
    }>(
      `SELECT id, amount_paid, credits_added, rate_applied, notes, created_at
       FROM organization_sms_credits WHERE organization_id = $1
       ORDER BY created_at DESC LIMIT 25`,
      [organizationId],
    );

    return {
      balance: account[0]?.sms_credits ? Number(account[0].sms_credits) : 0,
      rate:    account[0]?.sms_rate    ? Number(account[0].sms_rate)    : null,
      recent,
    };
  });
}

async function getOrCreateOrganizationSmsBillingAccount(
  db: PoolClient, organizationId: string,
): Promise<{ id: string; sms_rate: string }> {
  const { rows } = await db.query<{ id: string; sms_rate: string }>(
    `SELECT id, sms_rate FROM organization_billing_accounts WHERE organization_id = $1 FOR UPDATE`,
    [organizationId],
  );
  if (rows[0]) return rows[0];

  // Lazily bootstrapped, same reasoning as organization-finance.service.ts's
  // getWalletForUpdate(): nothing creates this row today (confirmed — not
  // even createOrganization()), so a billing account is an implementation
  // detail of holding a balance, not something an org opts into first.
  const { rows: created } = await db.query<{ id: string; sms_rate: string }>(
    `INSERT INTO organization_billing_accounts (organization_id) VALUES ($1)
     ON CONFLICT (organization_id) DO UPDATE SET updated_at = NOW()
     RETURNING id, sms_rate`,
    [organizationId],
  );
  return created[0];
}

/**
 * Super_admin only (enforced by the route) — sets the organization's
 * negotiated per-SMS rate. Column has existed since migration 051 with a
 * comment saying organizations "negotiate their own per-SMS rate"; nothing
 * has ever written to it before this, so it sat at its 0.90 default forever.
 */
export async function setOrganizationSmsRate(
  organizationId: string,
  rate:           number,
  adminId:        string,
): Promise<{ organizationId: string; rate: number }> {
  if (!(rate > 0)) throw new ValidationError('Rate must be positive');

  return withAdminDb(async (db) => {
    const before = await getOrCreateOrganizationSmsBillingAccount(db, organizationId);

    const { rows } = await db.query<{ sms_rate: string }>(
      `UPDATE organization_billing_accounts SET sms_rate = $1, updated_at = NOW()
       WHERE organization_id = $2 RETURNING sms_rate`,
      [rate.toFixed(4), organizationId],
    );

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_values, new_values)
       VALUES ($1, 'organization.sms_rate_update', 'organization', $2, $3::jsonb, $4::jsonb)`,
      [
        adminId, organizationId,
        JSON.stringify({ sms_rate: before.sms_rate }),
        JSON.stringify({ sms_rate: rows[0].sms_rate }),
      ],
    );

    return { organizationId, rate: parseFloat(rows[0].sms_rate) };
  });
}

/**
 * Records a manual SMS credit top-up for an organization. No payment_id ever
 * backs this (nullable on organization_sms_credits) — like deposit(), this
 * trusts that money arrived out-of-band and records it; it does not collect
 * payment itself, so unlike addSmsCredits there is no ON CONFLICT(payment_id)
 * exactly-once guard to worry about — every call is a distinct, real top-up.
 */
export async function addOrganizationSmsCredits(
  organizationId: string,
  amountKes:      number,
  actorUserId:    string | null,
  opts:           { reference?: string; notes?: string } = {},
): Promise<{ creditsAdded: number; newBalance: number; rateApplied: number }> {
  if (!(amountKes > 0)) throw new ValidationError('Amount must be positive');

  const result = await withAdminDb(async (db) => {
    const account = await getOrCreateOrganizationSmsBillingAccount(db, organizationId);
    const rate    = parseFloat(account.sms_rate);
    const credits = amountKes / rate;
    const notes   = opts.notes ?? (opts.reference ? `Top-up — ${opts.reference}` : 'Top-up');

    const { rows: inserted } = await db.query<{ id: string }>(
      `INSERT INTO organization_sms_credits
         (organization_id, billing_account_id, amount_paid, credits_added, rate_applied, added_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [organizationId, account.id, amountKes.toFixed(2), credits.toFixed(4), rate.toFixed(4), actorUserId, notes],
    );

    const { rows: after } = await db.query<{ sms_credits: string }>(
      `UPDATE organization_billing_accounts SET sms_credits = sms_credits + $1, updated_at = NOW()
       WHERE organization_id = $2 RETURNING sms_credits`,
      [credits.toFixed(4), organizationId],
    );

    // sms_ledger_append(payer_type, group_id, organization_id, entry_type,
    // amount, allowance_amount, balance_after, reference_type, reference_id,
    // payment_id, created_by, notes) — the same generic function
    // addSmsCredits already calls with 'group'; this is the first call site
    // ever to pass 'organization'.
    await db.query(
      `SELECT sms_ledger_append($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9::uuid,$10::uuid,$11::uuid,$12)`,
      [
        'organization', null, organizationId, 'purchase',
        credits.toFixed(4), 0, after[0]?.sms_credits ?? null,
        'manual_topup', inserted[0].id, null, actorId(actorUserId ?? undefined), notes,
      ],
    );

    return {
      creditsAdded: credits,
      newBalance:   parseFloat(after[0]?.sms_credits ?? '0'),
      rateApplied:  rate,
    };
  });

  await clearOrganizationLowBalanceFlag(organizationId);
  return result;
}

async function getNextInvoiceNumber(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ next_invoice_number: string }>(
    `SELECT next_invoice_number()`,
  );
  return rows[0].next_invoice_number;
}
