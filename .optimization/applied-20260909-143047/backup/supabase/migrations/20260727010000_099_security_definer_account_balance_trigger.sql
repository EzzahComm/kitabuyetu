-- ─────────────────────────────────────────────────────────────────────────────
-- 099: private.update_account_balance() — make it SECURITY DEFINER
--
-- Context: docs/adr/001-bypassrls-two-role-split.md (ADR-001) Phase 1. This
-- AFTER trigger on journal_lines (migration 017, re-bound per-partition by
-- migration 094) maintains accounts.balance for every posted journal line —
-- the actual mechanism behind "trigger-maintained balances", called out as a
-- well-engineered part of this schema by prior audits. It was defined as a
-- plain trigger function, which executes with the privileges of whoever
-- performed the triggering statement, not a privileged system identity.
--
-- accounts_update's RLS policy (migration 050) requires `is_system = false`
-- to allow an UPDATE — a deliberate guard against tenant-context code
-- directly editing the platform-seeded chart-of-accounts skeleton. Every
-- real account (1001 Cash, 1002 Bank, 1101 Loans Receivable, etc.) is seeded
-- with is_system = true. So the moment a real tenant role (app_tenant, no
-- BYPASSRLS) posts a journal line — which is the normal path for every
-- contribution, loan disbursement/repayment, and more — this trigger's own
-- `UPDATE public.accounts SET balance = ...` would silently match zero rows
-- under that same policy. No error is raised (an UPDATE matching no rows
-- isn't a failure), so journal_lines keeps inserting correctly while
-- accounts.balance silently stops tracking reality for every group, with no
-- visible symptom until a report or reconciliation job disagrees with the
-- ledger. Found via this branch's own app_tenant CI proof, before this ever
-- reached production.
--
-- Fix: SECURITY DEFINER, matching the pattern already established for
-- register_group() and link_member_to_group() (migration 098) — the trigger
-- always runs with its owner's (postgres, BYPASSRLS) privileges regardless
-- of who posted the journal line, since "every posted journal line updates
-- its account's balance" is a system invariant, not something that should be
-- gated by the acting user's own RLS scope. Body is otherwise unchanged.
--
-- Note: organization_journal_lines has a structurally identical trigger,
-- update_organization_account_balance() (migration 085), also not SECURITY
-- DEFINER. Left untouched here — organization_accounts' own RLS policy has
-- no is_system gate, and this session's own app_tenant CI run already proved
-- the org-disbursement path posts correctly today (no is_system condition to
-- silently fail against). Flagged for a future pass rather than changed
-- speculatively alongside an unrelated, already-demonstrated bug.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.update_account_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public AS $$
DECLARE
  v_entry_status public.journal_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_entry_status
    FROM public.journal_entries WHERE id = OLD.journal_entry_id;
  ELSE
    SELECT status INTO v_entry_status
    FROM public.journal_entries WHERE id = NEW.journal_entry_id;
  END IF;

  IF v_entry_status <> 'posted' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    UPDATE public.accounts SET balance = balance + NEW.debit - NEW.credit WHERE id = NEW.account_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.accounts SET balance = balance - OLD.debit + OLD.credit WHERE id = OLD.account_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.accounts
    SET balance = balance - OLD.debit + OLD.credit + NEW.debit - NEW.credit
    WHERE id = NEW.account_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
