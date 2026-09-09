-- invoice_sequences: RLS must remain OFF.
--
-- This table is a pure internal counter (year_month | last_seq) with no
-- group_id, no user data, and no rows that belong to any tenant.
-- It is accessed exclusively by next_invoice_number() which is SECURITY
-- DEFINER and therefore bypasses RLS as the function owner.
--
-- Enabling RLS with no policy causes PostgreSQL's default-deny to hide every
-- row from all non-owner roles, silently breaking invoice number generation.
-- A group_id-based policy is also impossible — the column does not exist.
--
-- Previous versions of this file incorrectly enabled RLS and attempted a
-- group_id policy. This migration corrects that mistake and acts as the
-- authoritative guard: any earlier ENABLE in the migration sequence is
-- overridden here.

-- Drop the broken policy if it was ever created
DROP POLICY IF EXISTS invoice_sequences_group_isolation ON public.invoice_sequences;

-- Disable RLS — this is intentional and must not be changed
ALTER TABLE public.invoice_sequences DISABLE ROW LEVEL SECURITY;
