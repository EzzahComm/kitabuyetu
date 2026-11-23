-- =============================================================================
-- 213: Changi$ha becomes a paid product.
--
-- A group may only create and launch campaigns while it holds an active
-- 'changisha' subscription, bought through the same plan checkout as Kitabu Yetu
-- and Chama Reminder (STK push, amount verified server-side, one active row per
-- group and product, renewals and expiry handled by the existing subscription
-- jobs). Plan prices live in types/enums.ts (PLAN_MONTHLY_FEES), not here.
--
-- The only schema change is the new enum value. Postgres allows ADD VALUE inside
-- a transaction as long as the value is not used in the same transaction; this
-- file does not use it. Nothing is backfilled: existing campaigns keep working
-- and their groups are asked to subscribe before creating or launching another.
-- =============================================================================

ALTER TYPE public.subscription_product ADD VALUE IF NOT EXISTS 'changisha';
