-- =============================================================================
-- 026_fix_welfare_fk_members.sql
--
-- The original welfare module (021) mistakenly referenced public.users(id)
-- which does not exist — the platform's user table is public.members.
-- This migration drops the broken FK constraints and re-adds them pointing
-- to public.members. Idempotent: uses IF EXISTS guards throughout.
-- =============================================================================

-- ── welfare_requests ─────────────────────────────────────────────────────────

ALTER TABLE public.welfare_requests
  DROP CONSTRAINT IF EXISTS welfare_requests_reviewed_by_fkey,
  DROP CONSTRAINT IF EXISTS welfare_requests_approved_by_fkey,
  DROP CONSTRAINT IF EXISTS welfare_requests_disbursed_by_fkey,
  DROP CONSTRAINT IF EXISTS welfare_requests_rejected_by_fkey;

ALTER TABLE public.welfare_requests
  ADD CONSTRAINT welfare_requests_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.members(id) ON DELETE SET NULL,
  ADD CONSTRAINT welfare_requests_approved_by_fkey
    FOREIGN KEY (approved_by) REFERENCES public.members(id) ON DELETE SET NULL,
  ADD CONSTRAINT welfare_requests_disbursed_by_fkey
    FOREIGN KEY (disbursed_by) REFERENCES public.members(id) ON DELETE SET NULL,
  ADD CONSTRAINT welfare_requests_rejected_by_fkey
    FOREIGN KEY (rejected_by) REFERENCES public.members(id) ON DELETE SET NULL;

-- ── welfare_pool_contributions ────────────────────────────────────────────────

ALTER TABLE public.welfare_pool_contributions
  DROP CONSTRAINT IF EXISTS welfare_pool_contributions_recorded_by_fkey;

ALTER TABLE public.welfare_pool_contributions
  ADD CONSTRAINT welfare_pool_contributions_recorded_by_fkey
    FOREIGN KEY (recorded_by) REFERENCES public.members(id) ON DELETE RESTRICT;
