export type PlanType           = 'starter' | 'growth' | 'enterprise';
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
  starter: value, growth: value, enterprise: value,
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
 * PLACEHOLDER PRICING FOR chama_reminder. These mirror Kitabu Yetu's numbers
 * because real Chama Reminder pricing has not been decided — inventing a rate
 * here would bury a made-up commercial number in code that bills customers.
 * Nothing reads them yet (no chama_reminder subscription exists until the
 * Phase 4 portal), so they are inert placeholders, not live prices. Set them
 * deliberately before the first Chama Reminder subscription is ever sold.
 */
export const SMS_RATES: Record<SubscriptionProduct, Record<PlanType, (volume: number) => number>> = {
  kitabu_yetu: {
    starter:    (_) => 0.90,
    growth:     (_) => 0.90,
    enterprise: (volume) => {
      if (volume > 50000) return 0.60;
      if (volume > 10000) return 0.75;
      return 0.90;
    },
  },
  chama_reminder: {
    starter:    (_) => 0.90,
    growth:     (_) => 0.90,
    enterprise: (volume) => {
      if (volume > 50000) return 0.60;
      if (volume > 10000) return 0.75;
      return 0.90;
    },
  },
};

/** See SMS_RATES' note — chama_reminder's figures are placeholders. */
export const PLAN_MONTHLY_FEES: Record<SubscriptionProduct, Record<PlanType, number>> = {
  kitabu_yetu: {
    starter:    0,
    growth:     1000,
    enterprise: 0, // negotiated
  },
  chama_reminder: {
    starter:    0,
    growth:     1000,
    enterprise: 0, // negotiated
  },
};
