-- 204: per-campaign PayBill account number.
--
-- Donors can already give by STK push on /fundraise/<slug>. This adds the
-- direct PayBill route: pay the platform paybill with the campaign's account
-- number (e.g. CH4K7M2Q) and the C2B confirmation credits that campaign
-- instead of filing the payment to mpesa_unrouted.
--
-- account_code: 'CH' + 6 chars from [A-Z0-9], uppercase, unique. New campaigns
-- get a random code at creation (campaigns.service); existing rows are
-- backfilled deterministically from the id so the migration is replayable.

ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS account_code text;

UPDATE public.campaigns
SET    account_code = 'CH' || upper(substr(md5(id::text), 1, 6))
WHERE  account_code IS NULL;

ALTER TABLE public.campaigns
  ALTER COLUMN account_code SET NOT NULL,
  ADD CONSTRAINT campaigns_account_code_format CHECK (account_code ~ '^CH[A-Z0-9]{6}$');

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_account_code ON public.campaigns (account_code);
