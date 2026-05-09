export type PlanType           = 'starter' | 'growth' | 'enterprise';
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'suspended' | 'trial';
export type ContributionStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'overdue';
export type LoanStatus         = 'pending' | 'approved' | 'rejected' | 'disbursed' | 'active' | 'completed' | 'defaulted' | 'written_off';
export type PaymentMethod      = 'mpesa' | 'cash' | 'bank_transfer' | 'cheque' | 'standing_order';
export type PaymentStatus      = 'pending' | 'completed' | 'failed' | 'refunded' | 'reversed';
export type MemberRole         = 'group_admin' | 'treasurer' | 'secretary' | 'member';
export type PlatformRole       = 'super_admin' | 'support' | 'ngo_coordinator' | 'member';
export type AccountType        = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type JournalStatus      = 'draft' | 'posted' | 'void';
export type NotificationType   = 'sms' | 'in_app' | 'email';
export type SmsStatus          = 'queued' | 'sent' | 'delivered' | 'failed' | 'rejected';
export type Gender             = 'male' | 'female' | 'other' | 'prefer_not_to_say';
export type GroupType          = 'chama' | 'sacco' | 'welfare' | 'investment' | 'ngo_group';
export type NgoAccessLevel     = 'read' | 'report';

export const ROLE_HIERARCHY: Record<MemberRole | PlatformRole, number> = {
  super_admin:     100,
  group_admin:      80,
  treasurer:        60,
  secretary:        40,
  member:           20,
  ngo_coordinator:  10,
  support:           5,
};

export const PLAN_FEATURES: Record<PlanType, {
  maxMembers: number | null;
  historicalImport: boolean;
  loanTracking: boolean;
  analytics: boolean;
  advancedReports: boolean;
  apiAccess: boolean;
  multiGroup: boolean;
}> = {
  starter: {
    maxMembers:       null,
    historicalImport: false,
    loanTracking:     false,
    analytics:        false,
    advancedReports:  false,
    apiAccess:        false,
    multiGroup:       false,
  },
  growth: {
    maxMembers:       30,
    historicalImport: true,
    loanTracking:     true,
    analytics:        true,
    advancedReports:  false,
    apiAccess:        false,
    multiGroup:       false,
  },
  enterprise: {
    maxMembers:       null,
    historicalImport: true,
    loanTracking:     true,
    analytics:        true,
    advancedReports:  true,
    apiAccess:        true,
    multiGroup:       true,
  },
};

export const SMS_RATES: Record<PlanType, (volume: number) => number> = {
  starter:    (_) => 0.90,
  growth:     (_) => 0.90,
  enterprise: (volume) => {
    if (volume > 50000) return 0.60;
    if (volume > 10000) return 0.75;
    return 0.90;
  },
};

export const PLAN_MONTHLY_FEES: Record<PlanType, number> = {
  starter:    0,
  growth:     1000,
  enterprise: 0, // negotiated
};
