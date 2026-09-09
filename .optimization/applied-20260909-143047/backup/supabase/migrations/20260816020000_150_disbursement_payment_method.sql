-- =============================================================================
-- 150: record HOW an organization disbursement was actually paid
--
-- `organization_disbursements` has never had a method/channel column, so the
-- live EZZAHCOMM -> THE FIONA'S allocation of KES 1,470,000 carries no record
-- of whether it moved as cash, cheque, bank transfer or M-Pesa. Only M-Pesa
-- leaves a receipt of its own; a cash or cheque hand-over leaves nothing at all
-- unless the system stores it. That is a real audit gap on the single largest
-- money movement in the platform.
--
-- Member loans ALREADY solved this: `loans.payment_method` exists, and all four
-- live Fionas loans are recorded as 'cash'. Only the organization side was
-- missing it, so this closes an asymmetry rather than inventing a concept.
--
-- REUSES the existing `payment_method` enum (mpesa, cash, bank_transfer,
-- cheque, standing_order) deliberately. A second parallel vocabulary for the
-- same idea is exactly how two enums drift apart until a report has to map
-- between them.
--
-- NULLABLE ON PURPOSE. Back-filling a guess onto the existing row would be
-- fabricating an audit record for money that has already moved — NULL honestly
-- means "not recorded", which is the true state for every row created before
-- today. New disbursements supply it at creation.
--
-- payment_reference is the companion the cash/cheque case actually needs: a
-- cheque number or bank slip is the only traceable artefact those channels
-- produce. Without it "cheque" is a label with nothing behind it. M-Pesa keeps
-- its own receipt elsewhere, so this stays optional.
-- =============================================================================

ALTER TABLE public.organization_disbursements
  ADD COLUMN IF NOT EXISTS payment_method public.payment_method,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT;

COMMENT ON COLUMN public.organization_disbursements.payment_method IS
  'How the money physically moved (migration 150). NULL means not recorded — '
  'true for every row created before 2026-08-16, and never back-filled with a '
  'guess. Reuses the same payment_method enum as loans.payment_method.';

COMMENT ON COLUMN public.organization_disbursements.payment_reference IS
  'Cheque number, bank slip or transfer reference (migration 150). The only '
  'traceable artefact a cash/cheque hand-over produces; M-Pesa carries its own '
  'receipt separately.';

-- A reference without a method is meaningless, and only some methods can carry
-- one. Cash genuinely has no reference to give, so it is not required for any
-- method — but a reference with no method at all is a data-entry error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organization_disbursements'::regclass
      AND conname  = 'chk_org_disb_reference_needs_method'
  ) THEN
    ALTER TABLE public.organization_disbursements
      ADD CONSTRAINT chk_org_disb_reference_needs_method
      CHECK (payment_reference IS NULL OR payment_method IS NOT NULL);
  END IF;
END $$;
