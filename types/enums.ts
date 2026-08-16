export type PlanType           = 'starter' | 'growth' | 'premium' | 'enterprise';
/**
 * Which product a subscription entitles a group to (migration 127).
 * A group holds at most one ACTIVE subscription per product, so these are
 * concurrent entitlements rather than mutually exclusive tiers — plan_type is
 * scoped *within* a product, which is why the three tables below are keyed by
 * (product, plan) rather than by plan alone.
 */
export type SubscriptionProduct = 'kitabu_yetu' | 'chama_reminder';
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'suspended' | 'trial';

export const DEFAULT_PRODUCT: SubscriptionProduct = 'kitabu_yetu';

/** Customer-facing product names. Used anywhere a product is shown to a user. */
export const PRODUCT_LABEL: Record<SubscriptionProduct, string> = {
  kitabu_yetu:    'Kitabu Yetu',
  chama_reminder: 'Chama Reminder',
};
export type ContributionStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'overdue';
export type LoanStatus         = 'pending' | 'approved' | 'rejected' | 'disbursed' | 'active' | 'completed' | 'defaulted' | 'written_off';
export type PaymentMethod      = 'mpesa' | 'cash' | 'bank_transfer' | 'cheque' | 'standing_order';
export type PaymentStatus      = 'pending' | 'completed' | 'failed' | 'refunded' | 'reversed';
export type MemberRole         = 'chairperson' | 'treasurer' | 'secretary' | 'member';
export type PlatformRole       = 'super_admin' | 'support' | 'organization_coordinator' | 'member';
export type AccountType        = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type JournalStatus      = 'draft' | 'posted' | 'void';
export type NotificationType   = 'sms' | 'in_app' | 'email';
export type SmsStatus          = 'queued' | 'sent' | 'delivered' | 'failed' | 'rejected';
export type Gender             = 'male' | 'female' | 'other' | 'prefer_not_to_say';
export type GroupType          = 'chama' | 'sacco' | 'welfare' | 'investment' | 'organization_group';
export type OrganizationAccessLevel     = 'read' | 'report';

export const ROLE_HIERARCHY: Record<MemberRole | PlatformRole, number> = {
  super_admin:     100,
  chairperson:      80,
  treasurer:        60,
  secretary:        40,
  member:           20,
  organization_coordinator:  10,
  support:           5,
};

export interface PlanFeatures {
  maxMembers: number | null;
  historicalImport: boolean;
  loanTracking: boolean;
  analytics: boolean;
  advancedReports: boolean;
  apiAccess: boolean;
  multiGroup: boolean;
}

// ALL features unlocked on ALL plans. Pricing tiers are kept for
// billing/SMS-rate purposes only; product features are not gated.
// If feature gating is reintroduced later, this is the single place
// to edit. The original audit (2026-05-22) flagged the previous
// inverted matrix; opting for full-access blanket is the simplest
// consistent posture.
//
// One shared object rather than six identical literals: the blanket posture is
// a deliberate single decision, and spelling it out per (product, plan) would
// invite the six copies to drift apart silently.
const ALL_FEATURES: PlanFeatures = {
  maxMembers:       null,
  historicalImport: true,
  loanTracking:     true,
  analytics:        true,
  advancedReports:  true,
  apiAccess:        true,
  multiGroup:       true,
};

const EVERY_PLAN = <T,>(value: T): Record<PlanType, T> => ({
  starter: value, growth: value, premium: value, enterprise: value,
});

/**
 * Keyed by (product, plan) since migration 127 — a Chama Reminder "growth" is
 * a different entitlement from a Kitabu Yetu "growth", and a group can hold
 * both at once.
 */
export const PLAN_FEATURES: Record<SubscriptionProduct, Record<PlanType, PlanFeatures>> = {
  kitabu_yetu:    EVERY_PLAN(ALL_FEATURES),
  chama_reminder: EVERY_PLAN(ALL_FEATURES),
};

/**
 * SMS_RATES lived here and is gone (migration 143).
 *
 * It was typed `(volume: number) => number` and read like a volume pricing
 * engine, but it never priced anything: all four call sites passed 0, and the
 * rate actually charged at send time comes from `subscriptions.sms_rate` — a
 * scalar frozen onto the subscription at purchase, which reserve_sms_credits
 * reads with MIN(). Its tiers (0.60/0.75/0.90) had also drifted from any
 * agreed price list.
 *
 * Real, configurable volume pricing now lives in `sms_pricing_tiers` and is
 * read through `lib/services/sms-pricing.service.ts`. Pricing is by VOLUME,
 * not by subscription plan, which is why it is no longer keyed by PlanType.
 */

/**
 * Monthly plan fees in KES. This is the ONLY source of truth for what a plan
 * costs: the /billing/plans API quotes it, and the M-Pesa callback verifies
 * the amount actually paid against it before activating anything. The billing
 * page used to carry its own hardcoded copy (growth 2500, enterprise 8000)
 * that disagreed with this table — customers were charged the client's number
 * while the server believed a different one. It now reads these values.
 *
 * There is no free tier. Every plan below enterprise is self-serve via STK
 * push; `enterprise` is 0 here because it is NEGOTIATED, not free — it must
 * never be sold through the self-serve payment path, and the STK validator
 * rejects it for exactly that reason.
 */
export const PLAN_MONTHLY_FEES: Record<SubscriptionProduct, Record<PlanType, number>> = {
  kitabu_yetu: {
    starter:    150,
    growth:     300,
    premium:    500,
    enterprise: 0, // negotiated — never self-serve
  },
  chama_reminder: {
    starter:    100,
    growth:     250,
    premium:    400,
    enterprise: 0, // negotiated — never self-serve
  },
};

/**
 * SMS messages INCLUDED with a plan, granted per billing cycle on successful
 * activation, and reset to zero each cycle by resetMonthlySmsAllowance().
 *
 * This is the ONLY source of truth for the allowance. Before it existed,
 * neither of billing.service.ts's two `INSERT INTO subscriptions` statements
 * set `sms_allowance_included` at all, so EVERY plan silently fell through to
 * the column default of 50 from migration 124 — starter and premium alike,
 * both products, all 8 live subscriptions. Meanwhile PLAN_COPY advertised
 * "Higher SMS allowance" as a premium feature, which the system did not
 * honour. Set this explicitly at creation; do not rely on the column default.
 *
 * Once exhausted, a group buys top-up credits at its own `sms_rate` — the
 * allowance is a floor, not a cap on sending. The pricing page says so.
 *
 * `enterprise` is NEGOTIATED, mirroring PLAN_MONTHLY_FEES. The number below is
 * a contractual FLOOR used when an enterprise subscription is created without
 * a bespoke figure; a real enterprise allowance is set per account.
 */
export const PLAN_SMS_ALLOWANCE: Record<SubscriptionProduct, Record<PlanType, number>> = {
  kitabu_yetu: {
    starter:    100,
    growth:     200,
    premium:    300,
    enterprise: 300, // floor — negotiated per contract
  },
  chama_reminder: {
    starter:    100,
    growth:     200,
    premium:    300,
    enterprise: 300, // floor — negotiated per contract
  },
};

/** Plans a group can buy itself. `enterprise` is negotiated and excluded. */
export const SELF_SERVE_PLANS: readonly PlanType[] = ['starter', 'growth', 'premium'];

/**
 * Display copy only — NO prices. Prices always come from `PLAN_MONTHLY_FEES`
 * above (or the live `/billing/plans` API, which reads the same table). This
 * used to be a private const inside `components/billing/plan-purchase.tsx`;
 * moved here so the PUBLIC pricing page and preview can share the exact same
 * per-tier bullets instead of maintaining an independent, driftable copy of
 * their own — which is what produced fictional member-count and SMS-quota
 * claims on the public pages while this list (real, reviewed, already sold
 * to authenticated customers) sat one import away.
 *
 * Keyed by product: Kitabu Yetu's "Accounting module" and "Advanced reports"
 * are meaningless on a communication-only plan, and a Chama Reminder customer
 * reading them would reasonably expect to get them.
 */
export const PLAN_COPY: Record<SubscriptionProduct, { type: PlanType; label: string; features: string[] }[]> = {
  kitabu_yetu: [
    { type: 'starter',    label: 'Starter',    features: ['Basic reporting', 'M-Pesa integration', 'SMS included'] },
    { type: 'growth',     label: 'Growth',     features: ['All Starter features', 'Advanced reports', 'Accounting module'] },
    { type: 'premium',    label: 'Premium',    features: ['All Growth features', 'Priority support', 'Higher SMS allowance'] },
    { type: 'enterprise', label: 'Enterprise', features: ['All Premium features', 'Enterprise portal', 'API access', 'Dedicated support'] },
  ],
  chama_reminder: [
    { type: 'starter',    label: 'Starter',    features: ['Member list & SMS', 'Birthday greetings', 'SMS included'] },
    { type: 'growth',     label: 'Growth',     features: ['All Starter features', 'Scheduled campaigns', 'Message templates'] },
    { type: 'premium',    label: 'Premium',    features: ['All Growth features', 'Higher SMS allowance', 'Priority support'] },
    { type: 'enterprise', label: 'Enterprise', features: ['All Premium features', 'Custom sender ID', 'Dedicated support'] },
  ],
};
