-- =============================================================================
-- 201_campaign_withdrawals.sql
-- Changi$ha monetization, part 2: the withdrawal table itself. Modeled
-- directly on vendor_payments (migration 129/134) — the closest existing
-- analog, an external non-member payee paid via Daraja B2C, same
-- reserve -> dual-approve -> dispatch-outside-transaction -> settle-on-
-- callback spine.
--
-- Every financial fact on the row is snapshotted at request time (platform
-- fee %, fee amount, M-Pesa charge, and even the payout phone itself — see
-- campaign-withdrawals.service.ts for why the destination is snapshotted
-- too, not just re-read live from campaigns.payout_phone at dispatch time).
--
-- RLS/grants follow campaigns' pattern (FORCE ROW LEVEL SECURITY, no grant
-- to anon/authenticated at all), not vendor_payments' looser one — verified
-- live via pg_class/information_schema.role_table_grants before writing
-- this migration that the two tables actually differ here, and campaigns'
-- is the current, tighter convention worth extending to a brand-new table
-- holding real payout amounts and phone numbers.
-- =============================================================================

CREATE TABLE public.campaign_withdrawals (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id                 uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE RESTRICT,
  group_id                    uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  payout_phone                text NOT NULL,
  gross_amount                numeric(14,2) NOT NULL CHECK (gross_amount > 0),
  platform_fee_pct            numeric(5,2)  NOT NULL,
  platform_fee_amount         numeric(12,2) NOT NULL CHECK (platform_fee_amount >= 0),
  mpesa_charge_amount         numeric(12,2) NOT NULL CHECK (mpesa_charge_amount >= 0),
  net_amount                  numeric(14,2) NOT NULL CHECK (net_amount > 0),
  status                      text NOT NULL DEFAULT 'pending_approval'
                                 CHECK (status IN ('pending_approval','approved','processing','completed',
                                                    'failed','rejected','timed_out','reconciled')),
  requested_by                uuid REFERENCES public.members (id) ON DELETE SET NULL,
  requested_at                timestamptz NOT NULL DEFAULT now(),
  originator_conversation_id  text,
  journal_entry_id            uuid REFERENCES public.journal_entries (id) ON DELETE SET NULL,
  completed_at                timestamptz,
  failure_reason              text,
  reconciled_at               timestamptz,
  idempotency_key             text,

  CONSTRAINT campaign_withdrawals_net_consistent CHECK (
    net_amount = gross_amount - platform_fee_amount - mpesa_charge_amount
  )
);

CREATE UNIQUE INDEX campaign_withdrawals_idempotency_unique
  ON public.campaign_withdrawals (group_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_campaign_withdrawals_campaign_id ON public.campaign_withdrawals (campaign_id, status);
CREATE INDEX idx_campaign_withdrawals_group_id    ON public.campaign_withdrawals (group_id, status);
CREATE INDEX idx_campaign_withdrawals_orig_conv    ON public.campaign_withdrawals (originator_conversation_id);

ALTER TABLE public.campaign_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_withdrawals FORCE ROW LEVEL SECURITY;

CREATE POLICY campaign_withdrawals_select ON public.campaign_withdrawals
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());

CREATE POLICY campaign_withdrawals_insert ON public.campaign_withdrawals
  FOR INSERT WITH CHECK (is_super_admin() OR group_id = app_current_group_id());

CREATE POLICY campaign_withdrawals_update ON public.campaign_withdrawals
  FOR UPDATE USING (is_super_admin() OR group_id = app_current_group_id());

-- No delete policy — withdrawals are never deleted, only status-transitioned
-- (same as vendor_payments/campaigns).

GRANT SELECT, INSERT, UPDATE ON public.campaign_withdrawals TO app_tenant;
GRANT SELECT, INSERT, UPDATE ON public.campaign_withdrawals TO service_role;
-- Deliberately no grant to anon/authenticated — matches campaigns' own
-- posture (migration 182 header): this table is never read via PostgREST,
-- only through withDb/withTransaction/withAdminDb in application code.
