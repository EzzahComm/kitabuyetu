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
// Must match the group_type Postgres enum EXACTLY (supabase/migrations/
// 20260101000000_001_init_enums.sql, extended by migration 154). This used to
// say 'organization_group', which the enum has never contained — the real value
// is 'ngo_group' — so registering or retyping a group as "Organization" threw a
// raw Postgres 22P02 (invalid enum input) that surfaced to the user as a 500.
//
// GROUP_TYPE_LABELS below is the single source of the user-facing wording; the
// signup and create-group dropdowns both render from it rather than hardcoding
// their own <option> text, which is how "Organization" survived in two places
// after the value itself was corrected.
export type GroupType =
  | 'chama' | 'sacco' | 'welfare' | 'investment' | 'ngo_group'
  | 'self_help_group' | 'cbo' | 'society' | 'cooperative' | 'faith_based' | 'other';

export const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  chama:           'Chama',
  self_help_group: 'Self Help Group (SHG)',
  cbo:             'Community Based Organisation (CBO)',
  society:         'Registered Society',
  sacco:           'SACCO',
  cooperative:     'Cooperative',
  welfare:         'Welfare Group',
  investment:      'Investment Club',
  faith_based:     'Faith-Based Group',
  ngo_group:       'NGO',
  other:           'Other',
};

// Insertion order above is the dropdown order — commonest Kenyan forms first,
// 'other' last. Object key order is guaranteed for string keys, so this needs
// no separate ordering array to stay in sync with.
export const GROUP_TYPES = Object.keys(GROUP_TYPE_LABELS) as [GroupType, ...GroupType[]];
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
 * Billing cadence a group can pay on (migration 155). `monthly` is the
 * original, unchanged behaviour every existing subscription is on.
 *
 * Deliberately NO discount for the longer cycles — BILLING_CYCLE_MONTHS is a
 * straight multiplier on PLAN_MONTHLY_FEES, not a separate price list. A
 * discounted annual price is a real business decision nobody has made yet;
 * inventing one here would be exactly the kind of unauthorised number this
 * codebase's pricing discipline (PLAN_MONTHLY_FEES itself, "the only source
 * of truth") exists to prevent. Add a discount multiplier here, explicitly,
 * the day someone actually decides on one.
 */
export const BILLING_CYCLES = ['monthly', 'quarterly', 'biannual', 'annual'] as const;
export type BillingCycle = typeof BILLING_CYCLES[number];

export const BILLING_CYCLE_MONTHS: Record<BillingCycle, number> = {
  monthly:  1,
  quarterly: 3,
  biannual: 6,
  annual:   12,
};

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly:  'Monthly',
  quarterly: 'Quarterly',
  biannual: 'Bi-annual',
  annual:   'Annual',
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

// ─────────────────────────────────────────────────────────────────────────────
// Organization plans — a DIFFERENT axis from PlanType/PLAN_FEATURES above,
// which is entirely group-scoped. Organizations (federating bodies overseeing
// many groups) had no plan/tier concept at all until this — confirmed by an
// exhaustive search, the only prior trace was three completely dead,
// unreferenced columns on `organizations` from a 2026-06 migration.
//
// UNLIKE groups, this is real, enforced from day one (chosen deliberately —
// the group side's PLAN_FEATURES currently unlocks everything on every tier
// after an audit found the gating inverted; the team chose to disable it
// rather than fix it). And UNLIKE groups, there is no self-serve path here at
// all: only super_admin/Kitabu Yetu staff create organizations, so a plan is
// always assigned by staff — never purchased, never upgraded by a coordinator.
// ─────────────────────────────────────────────────────────────────────────────

export type OrganizationPlanType    = 'starter' | 'growth' | 'premium' | 'premium_plus';
export type OrganizationSupportTier = 'standard' | 'priority' | 'priority_plus';

export interface OrganizationPlanFeatures {
  maxLinkedGroups:      number | null; // null = unlimited
  maxStaff:             number | null;
  maxFundingPrograms:   number | null;
  smsAllowanceIncluded: number;        // bundled credits granted per monthly anniversary
  whiteLabelBranding:   boolean;
  advancedReports:      boolean;       // budget variance + donor spend reports
  supportTier:          OrganizationSupportTier;
}

/**
 * premium_plus is deliberately absent — "custom, including pricing" was
 * explicit: every field is negotiated per deal and entered by hand at
 * assignment time (organization-plan.service.ts#assignOrganizationPlan),
 * never read from this static map. Mirrors PLAN_MONTHLY_FEES.enterprise's
 * existing "0 = negotiated" convention, just structurally stricter — there is
 * no fallback numeric here at all for premium_plus to accidentally read.
 */
export const ORGANIZATION_PLAN_FEATURES: Record<'starter' | 'growth' | 'premium', OrganizationPlanFeatures> = {
  starter: {
    maxLinkedGroups: 5, maxStaff: 2, maxFundingPrograms: 1,
    smsAllowanceIncluded: 0, whiteLabelBranding: false, advancedReports: false,
    supportTier: 'standard',
  },
  growth: {
    maxLinkedGroups: 15, maxStaff: 5, maxFundingPrograms: 5,
    smsAllowanceIncluded: 500, whiteLabelBranding: false, advancedReports: true,
    supportTier: 'priority',
  },
  premium: {
    maxLinkedGroups: null, maxStaff: 15, maxFundingPrograms: 10,
    smsAllowanceIncluded: 1500, whiteLabelBranding: false, advancedReports: true,
    supportTier: 'priority',
  },
};

export const ORGANIZATION_PLAN_MONTHLY_FEES: Record<'starter' | 'growth' | 'premium', number> = {
  starter: 2999, growth: 4999, premium: 8999,
};

export const ORGANIZATION_PLAN_COPY: { type: OrganizationPlanType; label: string; features: string[] }[] = [
  { type: 'starter', label: 'Starter', features: [
    'Up to 5 linked groups', 'Up to 2 staff seats', '1 active funding program',
    'Basic reports', 'Pay-as-you-go SMS', 'Standard support',
  ] },
  { type: 'growth', label: 'Growth', features: [
    'All Starter features', 'Up to 15 linked groups', 'Up to 5 staff seats',
    '5 active funding programs', 'Budget variance & donor spend reports',
    '500 SMS credits/month included', 'Priority support',
  ] },
  { type: 'premium', label: 'Premium', features: [
    'All Growth features', 'Unlimited linked groups', 'Up to 15 staff seats',
    '10 active funding programs', '1,500 SMS credits/month included', 'Priority support',
  ] },
  { type: 'premium_plus', label: 'Premium+', features: [
    'All Premium features', 'Unlimited everything, negotiated per contract',
    'White-label branding', 'Negotiated SMS rate & custom allowance', 'Priority+ support',
  ] },
];
