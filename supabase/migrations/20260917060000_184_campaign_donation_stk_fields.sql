-- =============================================================================
-- 184: campaign_donation STK fields
--
-- Same pattern as migration 138's plan_type/product columns for the
-- subscription STK purpose: mpesa_stk_requests carries whatever
-- purpose-specific data its fulfilment handler needs to read back out of the
-- callback, since AccountReference is truncated to 12 characters by Safaricom
-- (daraja.service.ts's `.slice(0, 12)`) and cannot itself carry a donation's
-- full identity.
--
-- campaign_id is what applyCampaignDonationFromSTK (mpesa-stk.service.ts)
-- uses to create the campaign_donations row and increment amount_raised;
-- donor_name/donor_message/is_anonymous are the donor's optional public-page
-- inputs, captured at initiation (the public donate form) and carried through
-- to settlement, exactly the way plan_type/product carry a subscription
-- purchase's choice through to activation.
-- =============================================================================

ALTER TABLE public.mpesa_stk_requests
  ADD COLUMN IF NOT EXISTS campaign_id    UUID REFERENCES public.campaigns (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS donor_name     TEXT,
  ADD COLUMN IF NOT EXISTS donor_message  TEXT,
  ADD COLUMN IF NOT EXISTS is_anonymous   BOOLEAN;

COMMENT ON COLUMN public.mpesa_stk_requests.campaign_id IS
  'Set only when purpose = campaign_donation (migration 182/184) — the '
  'Changi$ha campaign this donation is for.';
