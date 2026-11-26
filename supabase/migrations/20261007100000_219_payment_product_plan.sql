-- 219 — Product and plan on payments (platform revenue by product and plan)
--
-- Subscriptions already carry product (kitabu_yetu | chama_reminder) and
-- plan_type, but the payments that settle them did not, so platform revenue
-- could not be split by product or plan. This adds both columns, backfills
-- STK subscription payments from their mpesa_stk_requests row, and indexes the
-- breakdown query. Nullable: registration, SMS top-up, and manual payments
-- carry no product.

ALTER TABLE payments
  ADD COLUMN product   subscription_product,
  ADD COLUMN plan_type plan_type;

COMMENT ON COLUMN payments.product IS
  'Product this payment bought a subscription for. NULL for payments that are not product subscriptions (registration, SMS top-up, PayBill, manual).';
COMMENT ON COLUMN payments.plan_type IS
  'Plan purchased within product. NULL when product is NULL.';

-- Backfill STK subscription payments from the request that initiated them.
UPDATE payments p
SET    product   = s.product::text::subscription_product,
       plan_type = s.plan_type::text::plan_type
FROM   mpesa_stk_requests s
WHERE  s.checkout_request_id = p.mpesa_checkout_request_id
  AND  s.purpose = 'subscription'
  AND  p.product IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_product_plan
  ON payments (product, plan_type)
  WHERE status = 'completed' AND product IS NOT NULL;
