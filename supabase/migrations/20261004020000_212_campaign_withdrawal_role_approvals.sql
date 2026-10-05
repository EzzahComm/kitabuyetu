-- =============================================================================
-- 212: Changi$ha withdrawals need sign-off from three offices, then Kitabu Yetu.
--
-- Before: one second officer (anyone but the requester) approved, and a
-- configurable policy could switch the Kitabu Yetu sign-off off. Only
-- chairperson/treasurer held payouts.manage, so a secretary could not take part.
--
-- Now:
--   1. A new permission, campaigns.withdraw, held by chairperson, treasurer and
--      secretary. It gates requesting and deciding a campaign withdrawal
--      instead of payouts.manage, which also covers vendor payments and
--      settlements and is deliberately left as it was.
--   2. The requester's office counts as their sign-off; the OTHER two offices
--      must each approve. Approvals are recorded with the approver's office
--      (settlement_approvals.approver_role) and the requester's office is
--      snapshotted on the withdrawal (requested_by_role).
--   3. Kitabu Yetu's sign-off is mandatory.
--
-- Rules 2 and 3 are enforced by the service and again here by a trigger, so a
-- code path that forgets them still cannot move money.
-- =============================================================================

-- ─── 1. Permission ──────────────────────────────────────────────────────────

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY['campaigns.withdraw']) AS p
)
WHERE group_id IS NULL AND code IN ('chairperson', 'treasurer', 'secretary');

-- ─── 2. Record the office on each decision and on the request ───────────────

ALTER TABLE public.settlement_approvals ADD COLUMN IF NOT EXISTS approver_role text;
ALTER TABLE public.campaign_withdrawals ADD COLUMN IF NOT EXISTS requested_by_role text;

ALTER TABLE public.settlement_approvals DROP CONSTRAINT IF EXISTS settlement_approvals_approver_role_check;
ALTER TABLE public.settlement_approvals
  ADD CONSTRAINT settlement_approvals_approver_role_check
  CHECK (approver_role IS NULL OR approver_role IN ('chairperson', 'treasurer', 'secretary'));

ALTER TABLE public.campaign_withdrawals DROP CONSTRAINT IF EXISTS campaign_withdrawals_requested_by_role_check;
ALTER TABLE public.campaign_withdrawals
  ADD CONSTRAINT campaign_withdrawals_requested_by_role_check
  CHECK (requested_by_role IS NULL OR requested_by_role IN ('chairperson', 'treasurer', 'secretary'));

-- One approval per office per withdrawal, even if two people hold the same
-- office (a group can have two treasurers) or two requests race.
CREATE UNIQUE INDEX IF NOT EXISTS settlement_approvals_one_approval_per_office
  ON public.settlement_approvals (subject_id, approver_role)
  WHERE subject_type = 'campaign_withdrawal' AND approver_kind = 'officer'
    AND decision = 'approved' AND approver_role IS NOT NULL;

-- ─── 3. Database-level guard on the approval stages ─────────────────────────
-- A row may only leave 'pending_approval' for 'awaiting_platform' once all
-- three offices have signed off (the requester's plus the other two), and may
-- only enter a money-moving status once Kitabu Yetu has signed off as well.
-- Rows without requested_by_role pre-date this migration and keep the old
-- officer rule (production had none); the platform sign-off applies to all.

CREATE OR REPLACE FUNCTION public.enforce_campaign_withdrawal_signoffs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_offices_signed int;
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Stage 1 -> 2: all three offices.
  IF OLD.status = 'pending_approval'
     AND NEW.status IN ('awaiting_platform', 'approved', 'processing', 'completed')
     AND NEW.requested_by_role IS NOT NULL THEN
    SELECT count(DISTINCT role) INTO v_offices_signed
    FROM (
      SELECT NEW.requested_by_role AS role
      UNION
      SELECT approver_role FROM public.settlement_approvals
      WHERE subject_type = 'campaign_withdrawal' AND subject_id = NEW.id
        AND approver_kind = 'officer' AND decision = 'approved' AND approver_role IS NOT NULL
    ) offices;
    IF v_offices_signed < 3 THEN
      RAISE EXCEPTION 'campaign withdrawal % needs sign-off from the chairperson, treasurer and secretary before it can proceed', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Stage 2 -> money moves: Kitabu Yetu must have signed off.
  IF OLD.status IN ('pending_approval', 'awaiting_platform')
     AND NEW.status IN ('approved', 'processing', 'completed') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.settlement_approvals
      WHERE subject_type = 'campaign_withdrawal' AND subject_id = NEW.id
        AND approver_kind = 'backoffice' AND decision = 'approved'
    ) THEN
      RAISE EXCEPTION 'campaign withdrawal % needs Kitabu Yetu sign-off before funds can be released', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaign_withdrawals_enforce_signoffs ON public.campaign_withdrawals;
CREATE TRIGGER campaign_withdrawals_enforce_signoffs
  BEFORE UPDATE OF status ON public.campaign_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_campaign_withdrawal_signoffs();
