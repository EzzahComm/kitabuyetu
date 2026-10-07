-- =============================================================================
-- 218: group → member disbursements on the disbursement spine
--
-- disbursement_requests (migration 066) was built as THE path for every
-- group→member payout, but only loans ever used it: a non-loan row carried no
-- member, so the B2C result callback could neither post the group journal
-- (cash left 1001 with no GL entry — only the Safaricom fee was booked) nor
-- reduce the recipient's own balance. This migration turns a row into a
-- governed member disbursement:
--
--   Workflow   chairperson | secretary initiates   → pending_approval
--              treasurer approves (≠ initiator)    → awaiting_platform
--              Kitabu Yetu backoffice signs off    → approved → dispatched → completed (M-Pesa)
--                                                  → completed              (cash / bank, same transaction)
--              rejected (treasurer or platform) and cancelled (initiator) release the reserved funds.
--
--   Ledgers    the member_payout journal (group ledger) is posted and linked on
--              journal_entry_id in the same transaction that marks the row
--              completed; the member's ledger reads the same row. reference
--              (KY-DIS-000001) is carried onto the journal entry, so one id
--              connects disbursement, group journal, member passbook and audit.
--
-- The office rules are enforced by the service AND by a trigger below, so a
-- code path that forgets them still cannot move money (same pattern as 212).
-- =============================================================================

-- ─── 1. Status values ───────────────────────────────────────────────────────
-- Added, never used in this migration (a new enum value cannot be referenced
-- in the transaction that adds it); the trigger compares them as text.
ALTER TYPE public.disbursement_status ADD VALUE IF NOT EXISTS 'awaiting_platform';
ALTER TYPE public.disbursement_status ADD VALUE IF NOT EXISTS 'cancelled';

-- ─── 2. Columns ─────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.disbursement_reference_seq;

ALTER TABLE public.disbursement_requests
  ADD COLUMN IF NOT EXISTS member_id           UUID REFERENCES public.members (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS group_membership_id UUID REFERENCES public.group_members (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS payout_purpose      TEXT,
  ADD COLUMN IF NOT EXISTS purpose_description TEXT,
  ADD COLUMN IF NOT EXISTS notes               TEXT,
  ADD COLUMN IF NOT EXISTS payment_method      public.payment_method,
  ADD COLUMN IF NOT EXISTS payment_reference   TEXT,
  ADD COLUMN IF NOT EXISTS initiated_by_role   TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by        UUID REFERENCES public.members (id),
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS platform_approved_by UUID,
  ADD COLUMN IF NOT EXISTS platform_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS journal_entry_id    UUID REFERENCES public.journal_entries (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference           TEXT NOT NULL
    DEFAULT ('KY-DIS-' || lpad(nextval('public.disbursement_reference_seq')::text, 6, '0'));

ALTER SEQUENCE public.disbursement_reference_seq OWNED BY public.disbursement_requests.reference;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('uq_disb_reference', 'UNIQUE (reference)'),
      ('chk_disb_payout_purpose',
       'CHECK (payout_purpose IS NULL OR payout_purpose IN (''savings_withdrawal'', ''merry_go_round'', ''other''))'),
      -- A member disbursement always carries purpose, description, method and the initiator's office.
      ('chk_disb_member_payout_shape',
       'CHECK ((member_id IS NULL) = (payout_purpose IS NULL)
          AND (member_id IS NULL OR (purpose_description IS NOT NULL AND length(btrim(purpose_description)) >= 3
                                     AND payment_method IN (''mpesa'', ''cash'', ''bank_transfer'')
                                     AND initiated_by_role IN (''chairperson'', ''secretary''))))'),
      -- A loan disbursement has its borrower via loans.member_id and its own journal.
      ('chk_disb_loan_xor_member', 'CHECK (loan_id IS NULL OR member_id IS NULL)'),
      ('chk_disb_reference_needs_method', 'CHECK (payment_reference IS NULL OR payment_method IS NOT NULL)')
    ) AS t(name, def)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.disbursement_requests'::regclass AND conname = c.name
    ) THEN
      EXECUTE format('ALTER TABLE public.disbursement_requests ADD CONSTRAINT %I %s', c.name, c.def);
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_disb_member
  ON public.disbursement_requests (group_id, member_id, status)
  WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_disb_journal_entry
  ON public.disbursement_requests (journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;

COMMENT ON COLUMN public.disbursement_requests.member_id IS
  'Recipient of a group→member disbursement (migration 218). NULL for loan disbursements.';
COMMENT ON COLUMN public.disbursement_requests.payout_purpose IS
  'savings_withdrawal reduces the member''s savings balance; merry_go_round/other are '
  'recorded on the member passbook only (migration 218).';
COMMENT ON COLUMN public.disbursement_requests.journal_entry_id IS
  'Posted member_payout journal (migration 218). A completed member disbursement with '
  'NULL here is unreconciled and is surfaced by the reconciliation view.';
COMMENT ON COLUMN public.disbursement_requests.reference IS
  'Human reference (KY-DIS-000001) carried onto the journal entry and the member passbook.';

-- ─── 3. Decision ledger: treasurer + platform decisions in settlement_approvals
ALTER TABLE public.settlement_approvals DROP CONSTRAINT IF EXISTS settlement_approvals_subject_type_check;
ALTER TABLE public.settlement_approvals
  ADD CONSTRAINT settlement_approvals_subject_type_check
  CHECK (subject_type = ANY (ARRAY['bank_account', 'settlement', 'vendor_payment', 'campaign_withdrawal', 'member_payout']));

-- ─── 4. Database-level guard on the workflow ────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_member_payout_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_office text;
BEGIN
  IF NEW.member_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text <> 'pending_approval' THEN
      RAISE EXCEPTION 'member disbursement % must start pending treasurer approval', NEW.id USING ERRCODE = '23514';
    END IF;
    SELECT role::text INTO v_office FROM group_members
    WHERE group_id = NEW.group_id AND member_id = NEW.initiated_by AND status = 'active';
    IF v_office IS DISTINCT FROM NEW.initiated_by_role OR v_office NOT IN ('chairperson', 'secretary') THEN
      RAISE EXCEPTION 'member disbursements are initiated by the chairperson or secretary' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Leaving the treasurer stage for anything but a rejection/cancellation.
  IF OLD.status::text = 'pending_approval' AND NEW.status::text NOT IN ('rejected', 'cancelled') THEN
    IF NEW.status::text <> 'awaiting_platform' THEN
      RAISE EXCEPTION 'member disbursement % must be approved by the treasurer, then Kitabu Yetu', NEW.id
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM settlement_approvals sa
      JOIN group_members gm ON gm.group_id = NEW.group_id AND gm.member_id = sa.approver_id
      WHERE sa.subject_type = 'member_payout' AND sa.subject_id = NEW.id
        AND sa.approver_kind = 'officer' AND sa.decision = 'approved'
        AND sa.approver_role = 'treasurer' AND gm.role::text = 'treasurer'
        AND sa.approver_id <> NEW.initiated_by
    ) THEN
      RAISE EXCEPTION 'member disbursement % needs the treasurer''s approval', NEW.id USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Money may only move after Kitabu Yetu's sign-off.
  IF NEW.status::text IN ('approved', 'dispatched', 'completed')
     AND OLD.status::text IN ('pending_approval', 'awaiting_platform') THEN
    IF NOT EXISTS (
      SELECT 1 FROM settlement_approvals
      WHERE subject_type = 'member_payout' AND subject_id = NEW.id
        AND approver_kind = 'backoffice' AND decision = 'approved'
    ) THEN
      RAISE EXCEPTION 'member disbursement % needs Kitabu Yetu sign-off before funds can be released', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_member_payout_workflow() FROM PUBLIC;

DROP TRIGGER IF EXISTS disbursement_requests_member_payout_workflow ON public.disbursement_requests;
CREATE TRIGGER disbursement_requests_member_payout_workflow
  BEFORE INSERT OR UPDATE OF status ON public.disbursement_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_member_payout_workflow();

-- ─── 5. Permission ──────────────────────────────────────────────────────────
-- Gates the member-disbursement routes for the three offices; WHICH office may
-- initiate vs approve is decided by group_members.role (service + trigger).
UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY['member_payouts.manage']) AS p
)
WHERE group_id IS NULL AND code IN ('chairperson', 'treasurer', 'secretary');

-- ─── 6. Notifications (SMS trigger engine; sent only after commit) ──────────
INSERT INTO sms_templates (group_id, template_key, name, body, variables, category, is_system)
SELECT NULL, v.key, v.name, v.body, v.vars, 'transactional', true
FROM (VALUES
  ('member_payout_requested', 'Disbursement awaiting approval',
   'Disbursement {{reference}} of KES {{amount}} to {{recipient_name}} awaits your approval on Kitabu Yetu.',
   ARRAY['reference', 'amount', 'recipient_name']),
  ('member_payout_received', 'Disbursement received',
   'Dear {{first_name}}, your disbursement of KES {{amount}} has been received. Ref {{reference}}.',
   ARRAY['first_name', 'amount', 'reference']),
  ('member_payout_completed_officer', 'Disbursement completed',
   'Disbursement {{reference}} of KES {{amount}} to {{recipient_name}} is complete.',
   ARRAY['reference', 'amount', 'recipient_name']),
  ('member_payout_rejected', 'Disbursement rejected',
   'Disbursement {{reference}} of KES {{amount}} to {{recipient_name}} was rejected: {{reason}}',
   ARRAY['reference', 'amount', 'recipient_name', 'reason'])
) AS v(key, name, body, vars)
WHERE NOT EXISTS (SELECT 1 FROM sms_templates t WHERE t.group_id IS NULL AND t.template_key = v.key);

INSERT INTO sms_trigger_rules (name, description, event_type, template_key, recipient_spec, conditions)
SELECT v.name, v.description, v.event_type, v.template_key, v.spec::jsonb, '{}'::jsonb
FROM (VALUES
  ('member_payout_requested_treasurer', 'Tell the treasurer a member disbursement awaits approval.',
   'member_payout.requested', 'member_payout_requested', '{"type":"roles","roles":["treasurer"]}'),
  ('member_payout_received_member', 'Tell the member their disbursement was received.',
   'member_payout.completed', 'member_payout_received', '{"type":"event_member","field":"memberId"}'),
  ('member_payout_completed_initiator', 'Tell the initiator their disbursement completed.',
   'member_payout.completed', 'member_payout_completed_officer', '{"type":"event_member","field":"initiatorId"}'),
  ('member_payout_completed_treasurer', 'Tell the treasurer a disbursement completed.',
   'member_payout.completed', 'member_payout_completed_officer', '{"type":"roles","roles":["treasurer"]}'),
  ('member_payout_rejected_initiator', 'Tell the initiator their disbursement was rejected.',
   'member_payout.rejected', 'member_payout_rejected', '{"type":"event_member","field":"initiatorId"}')
) AS v(name, description, event_type, template_key, spec)
WHERE NOT EXISTS (
  SELECT 1 FROM sms_trigger_rules r
  WHERE r.group_id IS NULL AND r.organization_id IS NULL AND r.event_type = v.event_type AND r.name = v.name
);
