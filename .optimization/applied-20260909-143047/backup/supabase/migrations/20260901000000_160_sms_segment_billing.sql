-- =============================================================================
-- 160: Bill SMS by provider SEGMENT, not by recipient (SMS-AUDIT-v3 G5)
--
-- Billing charged one credit per recipient regardless of length while TextSMS
-- bills per segment. A 300-character message is 2 GSM-7 segments, or 5 if one
-- character forces UCS-2 — so long messages cost the platform a multiple of
-- what they billed, and sms-margin.service reported the wrong unit as if it
-- were right.
--
-- Two changes here; the application computes segment counts via
-- lib/sms/segments.ts.
--
-- 1. sms_usage_logs.segments — what the provider was actually billed for, so
--    the charge on every row is auditable rather than inferred. DEFAULT 1
--    because that is exactly what every historical row was charged, which
--    keeps history truthful instead of retroactively re-pricing it.
--
-- 2. settle_sms_credit_reservation's allowance arithmetic. It derived the
--    allowance decrement from a ROW COUNT
--    (SUM(CASE WHEN from_allowance > 0 THEN 1 ELSE 0 END)) while
--    reserve_sms_credits increments sms_allowance_reserved by a MESSAGE COUNT.
--    Those agreed only because credits_from_allowance was always 0 or 1. The
--    moment a row is worth N segments the identity breaks: settle gives back
--    less than reserve took, and the difference is stranded on the account
--    forever. Now SUM(from_allowance) on both sides.
--
-- No behaviour changes for existing data: every current row has
-- credits_from_allowance of 0 or 1, for which SUM and COUNT are identical.
-- =============================================================================

ALTER TABLE sms_usage_logs
  ADD COLUMN IF NOT EXISTS segments SMALLINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN sms_usage_logs.segments IS
  'Provider-billable parts for this message (GSM-7 160/153, UCS-2 70/67). '
  'Historical rows default to 1, which is what they were actually charged.';

-- ─── settle_sms_credit_reservation, with the allowance fix ───────────────────
-- Reproduced in full because CREATE OR REPLACE needs the whole body. Only the
-- allowance_count expression changed; everything else is migration 146's.

CREATE OR REPLACE FUNCTION public.settle_sms_credit_reservation(p_log_ids uuid[], p_outcome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settled INTEGER := 0;
  v_total   NUMERIC := 0;
  v_paid    NUMERIC;
  r         RECORD;
BEGIN
  IF p_outcome NOT IN ('consume', 'release') THEN
    RAISE EXCEPTION 'outcome must be consume or release, got %', p_outcome
      USING ERRCODE = '22023';
  END IF;

  FOR r IN
    WITH claimed AS (
      SELECT id,
             group_id,
             payer_organization_id  AS org_id,
             payer_type,
             credits_reserved       AS amt,
             credits_from_allowance AS from_allowance
      FROM sms_usage_logs
      WHERE id = ANY(p_log_ids)
        AND billing_state = 'reserved'
      FOR UPDATE
    ),
    upd AS (
      UPDATE sms_usage_logs l
      SET billing_state          = CASE WHEN p_outcome = 'consume' THEN 'consumed' ELSE 'released' END,
          credits_deducted       = CASE WHEN p_outcome = 'consume' THEN c.amt ELSE l.credits_deducted END,
          credits_reserved       = 0,
          credits_from_allowance = 0,
          settled_at             = NOW(),
          updated_at             = NOW()
      FROM claimed c
      WHERE l.id = c.id
      RETURNING c.payer_type AS payer_type, c.group_id AS group_id, c.org_id AS org_id,
                c.amt AS amt, c.from_allowance AS from_allowance
    )
    SELECT payer_type, group_id, org_id,
           SUM(amt)            AS credits,
           SUM(from_allowance) AS allowance_amt,
           -- SUM, not a row COUNT. These agreed only while every row's
           -- credits_from_allowance was 0 or 1. Once a row can be worth N
           -- segments, a row count under-decrements sms_allowance_reserved
           -- against what reserve_sms_credits added, stranding the
           -- difference permanently (SMS-AUDIT-v3 G5).
           SUM(from_allowance) AS allowance_count
    FROM upd
    GROUP BY payer_type, group_id, org_id
  LOOP
    v_settled := v_settled + 1;
    v_total   := v_total + r.credits;

    IF r.payer_type = 'organization' THEN
      UPDATE organization_billing_accounts
      SET reserved_sms_credits = GREATEST(reserved_sms_credits - r.credits, 0),
          sms_credits          = CASE WHEN p_outcome = 'consume'
                                      THEN GREATEST(sms_credits - r.credits, 0) ELSE sms_credits END,
          updated_at           = NOW()
      WHERE organization_id = r.org_id;

      IF p_outcome = 'consume' THEN
        PERFORM sms_ledger_append(
          'organization', NULL, r.org_id, 'consume',
          -r.credits, 0,
          (SELECT sms_credits FROM organization_billing_accounts WHERE organization_id = r.org_id),
          'sms_settle', NULL, NULL, NULL, NULL
        );
      END IF;

    ELSIF r.payer_type = 'group' THEN
      v_paid := r.credits - r.allowance_amt;

      UPDATE billing_accounts
      SET reserved_sms_credits   = GREATEST(reserved_sms_credits - (r.credits - r.allowance_amt), 0),
          sms_credits            = CASE WHEN p_outcome = 'consume'
                                        THEN GREATEST(sms_credits - (r.credits - r.allowance_amt), 0)
                                        ELSE sms_credits END,
          sms_allowance_reserved = GREATEST(sms_allowance_reserved - r.allowance_count, 0),
          sms_allowance_used     = sms_allowance_used
                                    + CASE WHEN p_outcome = 'consume' THEN r.allowance_count ELSE 0 END,
          updated_at              = NOW()
      WHERE group_id = r.group_id;

      IF p_outcome = 'consume' THEN
        PERFORM sms_ledger_append(
          'group', r.group_id, NULL, 'consume',
          -v_paid, r.allowance_amt,
          (SELECT sms_credits FROM billing_accounts WHERE group_id = r.group_id),
          'sms_settle', NULL, NULL, NULL, NULL
        );

        -- Migration 146. Only the PAID portion draws a lot: an
        -- allowance-funded message consumes no purchased credit.
        PERFORM draw_sms_credit_lots(r.group_id, v_paid);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('payers', v_settled, 'credits', v_total, 'outcome', p_outcome);
END;
$function$;


-- CREATE OR REPLACE resets a function's privileges to the default, which is
-- how this project re-opened the same PostgREST hole twice (migrations 107,
-- 126). Re-apply them explicitly rather than assuming they survived.
REVOKE ALL ON FUNCTION public.settle_sms_credit_reservation(UUID[], TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_sms_credit_reservation(UUID[], TEXT)
  TO service_role;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT EXECUTE ON FUNCTION public.settle_sms_credit_reservation(UUID[], TEXT)
      TO app_tenant;
  END IF;
END
$grant$;
