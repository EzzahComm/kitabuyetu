-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260602112320  name: 052_loan_par_buckets
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

CREATE TYPE par_bucket AS ENUM ('CURRENT', 'PAR30', 'PAR60', 'PAR90');

ALTER TABLE loans
  ADD COLUMN par_bucket      par_bucket  NOT NULL DEFAULT 'CURRENT',
  ADD COLUMN days_in_arrears INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN par_updated_at  TIMESTAMPTZ;

CREATE INDEX idx_loans_par ON loans (group_id, par_bucket) WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.recompute_par_buckets(p_group_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n INTEGER;
BEGIN
  WITH upd AS (
    UPDATE loans l SET
      days_in_arrears = d.dia,
      par_bucket = (CASE
        WHEN d.dia <= 0  THEN 'CURRENT'
        WHEN d.dia <= 30 THEN 'PAR30'
        WHEN d.dia <= 60 THEN 'PAR60'
        ELSE 'PAR90'
      END)::par_bucket,
      par_updated_at = NOW()
    FROM (
      SELECT id,
        CASE
          WHEN status = 'active'
           AND COALESCE(outstanding_balance, 0) > 0
           AND next_payment_date IS NOT NULL
          THEN GREATEST(0, (CURRENT_DATE - next_payment_date))
          ELSE 0
        END AS dia
      FROM loans
      WHERE status = 'active'
        AND (p_group_id IS NULL OR group_id = p_group_id)
    ) d
    WHERE l.id = d.id
    RETURNING 1
  )
  SELECT COUNT(*) INTO n FROM upd;
  RETURN n;
END;
$$;
