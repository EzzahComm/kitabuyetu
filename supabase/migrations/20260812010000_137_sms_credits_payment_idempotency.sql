-- =============================================================================
-- 137: Make SMS-credit top-ups idempotent per payment
--
-- Companion to the processFulfillment() fix in
-- app/api/v1/mpesa/callback/route.ts. That handler credited SMS balance only
-- when `payment.invoice_id` was set, but the billing page never sends an
-- invoiceId for a top-up (and generateInvoice() has no callers), so the whole
-- block was dead: Safaricom took the money, the UI said "Credits added", and
-- billing_accounts.sms_credits never moved. One real payment was affected
-- (receipt UH9QZ25LQG, KES 100, 2026-08-09) and was repaired with
-- scripts/backfill-uncredited-sms-topups.ts before this shipped.
--
-- Removing that gate exposes a second problem, which is what this migration
-- closes. handleSTKCallback() computes an `alreadyDone` flag for replayed
-- callbacks but never returns it (lib/services/mpesa-stk.service.ts:278 vs
-- :366), so the route re-runs processFulfillment() on every replay -- and the
-- mpesa_replay_callbacks job replays unprocessed callbacks every 5 minutes.
-- Without a uniqueness guard, un-gating the credit would convert a
-- "never credits" bug into a "credits N times" bug.
--
-- The fix follows the same shape migration 057 used for contributions,
-- loan_repayments, welfare_pool_contributions and share_transactions:
-- a per-table UNIQUE(payment_id) that makes the domain write exactly-once,
-- rather than relying on the caller to not run twice. addSmsCredits() pairs
-- this with ON CONFLICT (payment_id) DO NOTHING and only moves the balance
-- when the ledger insert actually happened.
--
-- payment_id stays NULLable and Postgres allows many NULLs under a UNIQUE
-- constraint, so manually-granted credits (payment_id IS NULL) are unaffected
-- and can still be issued repeatedly.
--
-- Verified before applying: zero duplicate payment_ids in sms_credits.
-- =============================================================================

ALTER TABLE sms_credits
  ADD CONSTRAINT sms_credits_payment_id_key UNIQUE (payment_id);

COMMENT ON CONSTRAINT sms_credits_payment_id_key ON sms_credits IS
  'Exactly-once guard for M-Pesa top-ups: a replayed STK callback must not '
  'credit the same payment twice. Paired with ON CONFLICT (payment_id) DO '
  'NOTHING in billingService.addSmsCredits.';
