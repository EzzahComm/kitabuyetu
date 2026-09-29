-- =============================================================================
-- 202_campaign_b2b_payouts.sql
-- Changi$ha withdrawals to a business: a campaign can pay out to an M-Pesa
-- paybill (with an account number) or till via Daraja B2B, as well as to a
-- phone via B2C. Same destination model as vendor_payments (migration 134):
-- a method column plus a CHECK that each method carries exactly its fields.
--
-- campaigns: the shape CHECK only forbids fields that don't belong to the
-- chosen method. Completeness stays an app-layer rule (submitForReview and
-- withdrawal requests), exactly like payout_phone in migration 200 — a draft
-- legitimately has no destination yet, and one live campaign predates the
-- requirement.
--
-- campaign_withdrawals: completeness IS enforced — a withdrawal row is a
-- snapshot of the exact destination it was sent to. payout_phone drops
-- NOT NULL so B2B rows can exist. Every field is tested with IS NOT NULL
-- explicitly: a CHECK passes when its expression is NULL, so a bare
-- `payout_shortcode ~ '...'` would let a paybill row with no shortcode in.
--
-- Grants: new columns inherit each table's existing grants (anon/authenticated
-- remain revoked per migration 201); RLS policies are row-level and unchanged.
-- =============================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS payout_method     text NOT NULL DEFAULT 'phone',
  ADD COLUMN IF NOT EXISTS payout_shortcode  text,
  ADD COLUMN IF NOT EXISTS payout_account    text,
  ADD COLUMN IF NOT EXISTS payout_payee_name text;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_payout_method_check
    CHECK (payout_method IN ('phone', 'paybill', 'till')),
  ADD CONSTRAINT campaigns_payout_shortcode_format
    CHECK (payout_shortcode ~ '^[0-9]{5,7}$'),
  ADD CONSTRAINT campaigns_payout_account_length
    CHECK (char_length(payout_account) BETWEEN 1 AND 20),
  ADD CONSTRAINT campaigns_payout_payee_name_length
    CHECK (char_length(payout_payee_name) BETWEEN 2 AND 120),
  ADD CONSTRAINT campaigns_payout_shape CHECK (
       (payout_method = 'phone'
          AND payout_shortcode IS NULL AND payout_account IS NULL AND payout_payee_name IS NULL)
    OR (payout_method = 'paybill' AND payout_phone IS NULL)
    OR (payout_method = 'till'    AND payout_phone IS NULL AND payout_account IS NULL)
  );

ALTER TABLE public.campaign_withdrawals
  ALTER COLUMN payout_phone DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS payout_method     text NOT NULL DEFAULT 'phone',
  ADD COLUMN IF NOT EXISTS payout_shortcode  text,
  ADD COLUMN IF NOT EXISTS payout_account    text,
  ADD COLUMN IF NOT EXISTS payout_payee_name text;

ALTER TABLE public.campaign_withdrawals
  ADD CONSTRAINT campaign_withdrawals_payout_method_check
    CHECK (payout_method IN ('phone', 'paybill', 'till')),
  ADD CONSTRAINT campaign_withdrawals_payout_destination CHECK (
       (payout_method = 'phone'
          AND payout_phone IS NOT NULL
          AND payout_shortcode IS NULL AND payout_account IS NULL AND payout_payee_name IS NULL)
    OR (payout_method = 'paybill'
          AND payout_phone IS NULL
          AND payout_shortcode IS NOT NULL AND payout_shortcode ~ '^[0-9]{5,7}$'
          AND payout_account IS NOT NULL AND char_length(payout_account) BETWEEN 1 AND 20
          AND payout_payee_name IS NOT NULL)
    OR (payout_method = 'till'
          AND payout_phone IS NULL
          AND payout_shortcode IS NOT NULL AND payout_shortcode ~ '^[0-9]{5,7}$'
          AND payout_account IS NULL
          AND payout_payee_name IS NOT NULL)
  );
