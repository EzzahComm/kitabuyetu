-- =============================================================================
-- 164: Exactly-once org SMS top-ups (SMS-AUDIT-v3 T3-5 / G27)
--
-- The group side got this in migration 137: UNIQUE(payment_id) on sms_credits,
-- paired with ON CONFLICT (payment_id) DO NOTHING in addSmsCredits, because a
-- replayed STK callback re-enters the fulfilment path with the same payment_id
-- and would otherwise credit the group twice. The organization side has the
-- identical column and no such constraint.
--
-- Today that is latent rather than live: addOrganizationSmsCredits is manual
-- only and never passes a payment_id, so every row carries NULL and no replay
-- exists to guard against. The reason to land it NOW is precisely that — the
-- guard has to be in place BEFORE the first callback-driven org top-up ships,
-- not after someone discovers the double credit in a reconciliation. It costs
-- nothing while nothing uses it.
--
-- payment_id stays NULLable, and Postgres allows unlimited NULLs under a
-- UNIQUE constraint, so manual top-ups continue to apply every time.
-- =============================================================================

-- Refuse to create a constraint that would silently not hold. Migration 137
-- verified the same thing by hand before applying; asserting it in the
-- migration means a different environment cannot apply this while carrying
-- data that violates it.
DO $check$
DECLARE
  v_dupes INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dupes FROM (
    SELECT payment_id
      FROM organization_sms_credits
     WHERE payment_id IS NOT NULL
     GROUP BY payment_id
    HAVING COUNT(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'migration 164: % payment_id value(s) already appear on more than one organization_sms_credits row — resolve the duplicate credits before adding the constraint', v_dupes;
  END IF;
END
$check$;

ALTER TABLE organization_sms_credits
  ADD CONSTRAINT organization_sms_credits_payment_id_key UNIQUE (payment_id);

COMMENT ON CONSTRAINT organization_sms_credits_payment_id_key ON organization_sms_credits IS
  'One credit row per payment. Paired with ON CONFLICT (payment_id) DO NOTHING '
  'in addOrganizationSmsCredits so a replayed callback cannot credit the same '
  'payment twice. NULL payment_id (manual top-ups) is unconstrained. '
  'Mirrors sms_credits_payment_id_key (migration 137) on the group side.';
