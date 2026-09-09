-- ─────────────────────────────────────────────────────────────────────────────
-- 115: group_funding_sources — the group-side funding attribution anchor
--
-- First implementation step of the Capital & Investment Layer
-- (docs/capital-layer/capital-layer-spec.md §3.4). Deliberately the smallest
-- useful slice: it depends on NONE of the six open decisions in
-- docs/capital-layer/impact-report.md §7, so it can land while D1 (capital
-- model), D5 (member visibility / Kenya DPA), and the four architectural
-- questions are still being decided.
--
-- WHY THIS TABLE EXISTS
-- Today a group's money is implicitly assumed to be its own internal savings.
-- Nothing records where a shilling came from, so nothing can attribute a member
-- loan back to a funding source, and therefore no organization-side portfolio
-- reporting is possible. This table is the anchor that makes attribution
-- expressible. It is the prerequisite for loan_funding_splits (the keystone),
-- which is in turn the prerequisite for everything the capital layer does.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- No money moves. No GL posting. No balance is stored here — this is a
-- classification/provenance table, not a ledger. Repayable
-- organization_allocation sources are representable (the columns and CHECKs are
-- here) but nothing creates them yet; that arrives with the allocation
-- lifecycle in Phase 2.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.group_funding_sources (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  source_type      TEXT NOT NULL CHECK (source_type IN (
                     'internal_savings',
                     'organization_allocation',
                     'external_grant',
                     'bank_loan',
                     'other'
                   )),
  -- Set only for source_type = 'organization_allocation'. organization_disbursements
  -- is this codebase's existing allocation table (see impact-report.md §0) — the
  -- capital layer extends it rather than introducing a parallel cap_allocations.
  allocation_id    UUID REFERENCES public.organization_disbursements(id) ON DELETE RESTRICT,
  organization_id  UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  label            TEXT NOT NULL,
  is_repayable     BOOLEAN NOT NULL DEFAULT FALSE,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- An allocation-backed source must name both its allocation and its
  -- organization; any other source type must name neither. Enforced here rather
  -- than in the service layer so no write path can create an unattributable row.
  CONSTRAINT chk_gfs_allocation_linkage CHECK (
    (source_type = 'organization_allocation'
       AND allocation_id IS NOT NULL AND organization_id IS NOT NULL)
    OR
    (source_type <> 'organization_allocation'
       AND allocation_id IS NULL)
  ),

  -- A group's own savings are never a debt owed to anyone.
  CONSTRAINT chk_gfs_internal_savings_not_repayable CHECK (
    source_type <> 'internal_savings' OR is_repayable = FALSE
  ),

  CONSTRAINT chk_gfs_closed_at CHECK (
    (status = 'closed' AND closed_at IS NOT NULL)
    OR (status = 'active' AND closed_at IS NULL)
  )
);

-- Exactly one internal_savings source per group, ever. This is the invariant the
-- auto-provisioning trigger below relies on, and what makes "default the loan to
-- internal savings" a deterministic lookup rather than a guess.
CREATE UNIQUE INDEX uq_group_funding_sources_internal
  ON public.group_funding_sources (group_id)
  WHERE source_type = 'internal_savings';

-- One funding source per allocation — an allocation cannot be double-counted
-- into a group's books.
CREATE UNIQUE INDEX uq_group_funding_sources_allocation
  ON public.group_funding_sources (allocation_id)
  WHERE allocation_id IS NOT NULL;

CREATE INDEX idx_group_funding_sources_group
  ON public.group_funding_sources (group_id, status);

CREATE INDEX idx_group_funding_sources_org
  ON public.group_funding_sources (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE TRIGGER trg_group_funding_sources_updated_at
  BEFORE UPDATE ON public.group_funding_sources
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

COMMENT ON TABLE public.group_funding_sources IS
  'Provenance of a group''s capital: internal savings, organization allocations, grants, bank loans. Attribution anchor for loan_funding_splits. Not a ledger — holds no balances. See docs/capital-layer/capital-layer-spec.md.';

-- ─── Auto-provision the internal_savings source ──────────────────────────────
-- Every group must have one from the moment it exists, or the "default a member
-- loan to internal savings" path has nothing to point at.
--
-- Implemented as an AFTER INSERT trigger rather than inside register_group().
-- Two reasons: (1) trg_groups_payment_prefix already sets the precedent for
-- auto-provisioning a per-group resource via a trigger on groups; (2) a trigger
-- covers every creation path unconditionally, whereas register_group() is one
-- of several and is a large SECURITY DEFINER RPC on the registration path that
-- this change has no other reason to touch.
--
-- SECURITY DEFINER is REQUIRED, not incidental. group_funding_sources has FORCE
-- RLS below, and its INSERT policy is scoped to app_current_group_id() — which
-- during group creation is not yet the new group. A plain trigger would insert
-- zero rows silently under a non-BYPASSRLS role. This codebase has already
-- shipped exactly that bug once (private.update_account_balance, fixed in
-- migration 099 after the app_tenant CI job caught it); this is the same trap.
CREATE OR REPLACE FUNCTION private.provision_internal_funding_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.group_funding_sources (group_id, source_type, label, is_repayable)
  VALUES (NEW.id, 'internal_savings', 'Internal savings', FALSE)
  ON CONFLICT DO NOTHING;   -- idempotent against the partial unique index
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_groups_internal_funding_source
  AFTER INSERT ON public.groups
  FOR EACH ROW EXECUTE FUNCTION private.provision_internal_funding_source();

-- ─── Backfill existing groups ────────────────────────────────────────────────
-- Idempotent: the partial unique index makes a re-run a no-op. Production had 5
-- groups and 0 loans at the time this was written (see impact-report.md §5), so
-- there is no loan attribution to reconstruct — only the sources themselves.
INSERT INTO public.group_funding_sources (group_id, source_type, label, is_repayable)
SELECT g.id, 'internal_savings', 'Internal savings', FALSE
FROM public.groups g
ON CONFLICT DO NOTHING;

-- Assert the invariant this migration is responsible for. If any group lacks
-- its source, fail the migration rather than leave a half-provisioned state.
DO $$
DECLARE
  missing INTEGER;
BEGIN
  SELECT count(*) INTO missing
  FROM public.groups g
  WHERE NOT EXISTS (
    SELECT 1 FROM public.group_funding_sources s
    WHERE s.group_id = g.id AND s.source_type = 'internal_savings'
  );

  IF missing > 0 THEN
    RAISE EXCEPTION
      'group_funding_sources backfill incomplete: % group(s) have no internal_savings source', missing;
  END IF;
END;
$$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Two read audiences: the group itself, and organization staff for sources that
-- represent their own organization's capital. Writes are service-layer only for
-- now (no tenant-role write path exists yet) — the allocation lifecycle in
-- Phase 2 will introduce one, and will need its own policy review at that point.
--
-- Note per impact-report.md §D-D: the app's DB role still has BYPASSRLS, so
-- these policies are defense-in-depth for the app_tenant cutover, not today's
-- live enforcement boundary. They are verified by the app_tenant CI job.

ALTER TABLE public.group_funding_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_funding_sources FORCE  ROW LEVEL SECURITY;

CREATE POLICY group_funding_sources_select ON public.group_funding_sources
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (organization_id IS NOT NULL AND organization_id = app_current_organization_id())
  );

CREATE POLICY group_funding_sources_insert ON public.group_funding_sources
  FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY group_funding_sources_update ON public.group_funding_sources
  FOR UPDATE USING (is_super_admin());

CREATE POLICY group_funding_sources_delete ON public.group_funding_sources
  FOR DELETE USING (is_super_admin());
