-- =============================================================================
-- 001_init_enums.sql
-- All PostgreSQL enum types for Kitabu Yetu
-- =============================================================================

-- Subscription plan tiers
CREATE TYPE plan_type AS ENUM (
  'starter',
  'growth',
  'enterprise'
);

-- Subscription lifecycle states
CREATE TYPE subscription_status AS ENUM (
  'active',
  'expired',
  'cancelled',
  'suspended',
  'trial'
);

-- Contribution payment states
CREATE TYPE contribution_status AS ENUM (
  'pending',
  'completed',
  'failed',
  'cancelled',
  'overdue'
);

-- Loan lifecycle states
CREATE TYPE loan_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'disbursed',
  'active',
  'completed',
  'defaulted',
  'written_off'
);

-- Payment methods accepted
CREATE TYPE payment_method AS ENUM (
  'mpesa',
  'cash',
  'bank_transfer',
  'cheque',
  'standing_order'
);

-- Payment transaction states
CREATE TYPE payment_status AS ENUM (
  'pending',
  'completed',
  'failed',
  'refunded',
  'reversed'
);

-- Group-level member roles (scoped per group)
CREATE TYPE member_role AS ENUM (
  'group_admin',
  'treasurer',
  'secretary',
  'member'
);

-- Platform-wide roles (not group-scoped)
CREATE TYPE platform_role AS ENUM (
  'super_admin',
  'support',
  'ngo_coordinator',
  'member'
);

-- Double-entry account classifications
CREATE TYPE account_type AS ENUM (
  'asset',
  'liability',
  'equity',
  'income',
  'expense'
);

-- Journal entry lifecycle
CREATE TYPE journal_status AS ENUM (
  'draft',
  'posted',
  'void'
);

-- Notification delivery channels
CREATE TYPE notification_type AS ENUM (
  'sms',
  'in_app',
  'email'
);

-- SMS delivery pipeline states
CREATE TYPE sms_status AS ENUM (
  'queued',
  'sent',
  'delivered',
  'failed',
  'rejected'
);

-- Member gender options
CREATE TYPE gender AS ENUM (
  'male',
  'female',
  'other',
  'prefer_not_to_say'
);

-- Group entity types
CREATE TYPE group_type AS ENUM (
  'chama',
  'sacco',
  'welfare',
  'investment',
  'ngo_group'
);

-- NGO data access levels
CREATE TYPE ngo_access_level AS ENUM (
  'read',
  'report'
);
