-- =============================================================================
-- 203_campaign_withdrawal_platform_signoff.sql
-- Changi$ha: Kitabu Yetu signs off every release of campaign funds.
--
-- Donations are paid into the platform paybill and held on the group's
-- Changi$ha account, so the platform — not only the group's own officials —
-- decides when they leave. A withdrawal now goes:
--   pending_approval  (a group official requested it)
--   -> awaiting_platform  (a second group official approved it, maker != checker)
--   -> approved  (a Kitabu Yetu super-admin signed off) -> processing -> ...
--
-- platform_signoff_required snapshots the rule at request time (like the fee
-- and the destination), so switching the policy later never changes an
-- in-flight withdrawal. Rows that existed before this migration are
-- 'false': they were requested under the group-only rule.
--
-- The platform decision is recorded in settlement_approvals with
-- approver_kind = 'backoffice' (already allowed by migration 129) — same
-- ledger as the officers' decisions, so the audit trail is one place.
-- Grants are unchanged: new columns inherit the table's existing grants.
-- =============================================================================

ALTER TABLE public.campaign_withdrawals
  ADD COLUMN IF NOT EXISTS platform_signoff_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.campaign_withdrawals
  DROP CONSTRAINT IF EXISTS campaign_withdrawals_status_check;

ALTER TABLE public.campaign_withdrawals
  ADD CONSTRAINT campaign_withdrawals_status_check
  CHECK (status IN ('pending_approval', 'awaiting_platform', 'approved', 'processing',
                    'completed', 'failed', 'rejected', 'timed_out', 'reconciled'));

CREATE INDEX IF NOT EXISTS idx_campaign_withdrawals_awaiting_platform
  ON public.campaign_withdrawals (requested_at)
  WHERE status = 'awaiting_platform';
