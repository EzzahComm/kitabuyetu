-- =============================================================================
-- 155: quarterly / bi-annual / annual subscription billing cycles
--
-- Purely additive. `subscriptions.monthly_fee` stays exactly what its name
-- says — the group's normalized MONTHLY rate — because admin.service.ts sums
-- it directly for MRR (SUM(monthly_fee) FILTER (WHERE status='active'), in
-- both getPlatformStats and getBillingOverview). Storing the full cycle
-- charge there instead would inflate MRR up to 12x for an annual
-- subscriber — the exact "engine reads a value differently than every other
-- reader of it" mistake migration 148 fixed for loan interest. The actual
-- amount charged this cycle is monthly_fee * the cycle's month count,
-- verified against the payment at activation time and recorded on the
-- `payments` row (which already carries the real amount) — never duplicated
-- into a second column here.
--
-- DEFAULT 'monthly' on every new column: every existing subscription and
-- every existing STK/billing code path that doesn't know about cycles yet
-- keeps behaving exactly as it does today.
-- =============================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscriptions'::regclass
      AND conname  = 'chk_subscriptions_billing_cycle'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT chk_subscriptions_billing_cycle
      CHECK (billing_cycle IN ('monthly', 'quarterly', 'biannual', 'annual'));
  END IF;
END $$;

COMMENT ON COLUMN public.subscriptions.billing_cycle IS
  'Cadence the group pays on (migration 155). monthly_fee is ALWAYS the '
  'normalized per-month rate regardless of this value — it is summed '
  'directly for MRR elsewhere, so it must never hold a multi-month total. '
  'The amount actually charged for one cycle is monthly_fee times the cycle''s '
  'month count (1/3/6/12), which activateSubscriptionForPayment() verifies '
  'against the real payment but does not store separately.';

-- Same column on the STK request, mirroring plan_type/product from migration
-- 138 — the callback needs to know what cycle was actually requested when it
-- eventually activates the subscription, the same reason it needs plan_type.
ALTER TABLE public.mpesa_stk_requests
  ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mpesa_stk_requests'::regclass
      AND conname  = 'chk_stk_requests_billing_cycle'
  ) THEN
    ALTER TABLE public.mpesa_stk_requests
      ADD CONSTRAINT chk_stk_requests_billing_cycle
      CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly', 'quarterly', 'biannual', 'annual'));
  END IF;
END $$;

COMMENT ON COLUMN public.mpesa_stk_requests.billing_cycle IS
  'Requested cadence when purpose=subscription (migration 155). NULLABLE, '
  'unlike plan_type/product which the app always sets for a subscription '
  'request — a pre-155 client or an admin-initiated activation may still '
  'omit it, and the reader treats NULL as monthly (cycle_months=1), never '
  'as an error.';
