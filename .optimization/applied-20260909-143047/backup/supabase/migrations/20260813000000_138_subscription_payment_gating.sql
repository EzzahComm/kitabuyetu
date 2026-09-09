-- =============================================================================
-- 138: Payment-gated subscription activation + the `premium` tier
--
-- Two problems this closes, both in the same money path.
--
-- 1. upgradePlan() activated any paid plan with no payment check at all. The
--    only gate was the `billing.manage` permission, so a chairperson could
--    POST /api/v1/billing/plans and land on `enterprise` with zero money
--    moving. The billing page did run an STK push first, but that sequencing
--    lived entirely in the client -- the server never verified it.
--
-- 2. The M-Pesa callback accepted `purpose:'subscription'` and then did
--    nothing with it (fulfilStkCallback's dead branch), so paying for a plan
--    genuinely could not activate it. Same shape as the sms_topup bug fixed
--    in migration 137: a confirmation signal that never reached its domain
--    write.
--
-- The fix needs the callback to know WHAT was bought, which nothing recorded:
-- mpesa_stk_requests carried `purpose` but no plan or product, and the UI sent
-- a constant accountReference ('SUBSCRIPT') with the plan name only in a
-- 20-char free-text description. Hence plan_type/product columns here.
--
-- subscriptions.payment_id makes activation exactly-once per payment, the same
-- device migrations 057 and 137 use. It is what lets the callback and the
-- client's own "claim my payment" call both run without double-activating:
-- whichever arrives second sees the payment already consumed and no-ops.
--
-- `premium` slots between growth and enterprise (BEFORE 'enterprise' so
-- enumsortorder stays meaningful for ORDER BY plan_type). Prices move to
-- KES 150/300/500/custom for kitabu_yetu and 100/250/400/custom for
-- chama_reminder in types/enums.ts -- deliberately not stored here, since
-- PLAN_MONTHLY_FEES is already the single source of truth the API quotes.
--
-- NOTE: ALTER TYPE ... ADD VALUE is permitted inside a transaction on PG12+,
-- but the new label cannot be USED until that transaction commits. Nothing in
-- this migration references 'premium' as a literal, so it is safe here; any
-- migration that needs to write 'premium' rows must be a separate one.
-- =============================================================================

ALTER TYPE plan_type ADD VALUE IF NOT EXISTS 'premium' BEFORE 'enterprise';

-- What the payer was actually buying. NULL for every non-subscription STK
-- request (contributions, top-ups) and for rows predating this migration.
ALTER TABLE mpesa_stk_requests
  ADD COLUMN IF NOT EXISTS plan_type plan_type,
  ADD COLUMN IF NOT EXISTS product   subscription_product;

COMMENT ON COLUMN mpesa_stk_requests.plan_type IS
  'Plan being purchased when purpose = ''subscription''. The callback needs '
  'this to know what to activate -- account_reference is the constant '
  '''SUBSCRIPT'' and description is 20 chars of free text, neither usable.';
COMMENT ON COLUMN mpesa_stk_requests.product IS
  'Product the purchased plan belongs to; a group holds one active '
  'subscription per product, so activation cannot be resolved without it.';

-- Exactly-once activation. A replayed Safaricom callback, or the client
-- claiming a payment the callback already fulfilled, must not produce a
-- second subscription or re-cancel the current one.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES payments (id) ON DELETE SET NULL;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_payment_id_key UNIQUE (payment_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_id
  ON subscriptions (payment_id) WHERE payment_id IS NOT NULL;

COMMENT ON COLUMN subscriptions.payment_id IS
  'The M-Pesa payment that bought this subscription. NULL for rows created '
  'without payment (register_group''s seed, manual/negotiated enterprise '
  'deals, grandfathered plans) -- Postgres does not constrain NULLs under a '
  'UNIQUE, so those stay unrestricted.';
