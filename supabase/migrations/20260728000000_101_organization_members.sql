-- ─────────────────────────────────────────────────────────────────────────────
-- 101: organization_members — multi-staff organizations (Phase 1)
--
-- Context: organizations (NGOs/federations that fund/oversee groups) have
-- always supported exactly ONE coordinator, via organizations.coordinator_
-- member_id (a single FK to members). This isn't just a UX limitation:
-- organization-finance.service.ts's approveDisbursement() maker-checker
-- logic already requires a DIFFERENT coordinator to approve a disbursement
-- than the one who initiated it — structurally impossible today, since only
-- one member can ever resolve to a given org. This migration unblocks that
-- existing, currently-unusable safety control.
--
-- organizations.coordinator_member_id is deliberately left untouched — not
-- dropped, not dual-written. It becomes a legacy/display-only pointer to the
-- ORIGINAL coordinator; admin-organizations.service.ts's existing JOIN on it
-- keeps working unchanged. organization_members is the real source of truth
-- going forward. Dropping the column is an explicit later cleanup, not
-- required for this feature to work.
--
-- RLS mirrors organization_wallets_all/funding_programs_all's existing
-- GUC-based pattern (app_current_role() = 'organization_coordinator' AND
-- organization_id = app_current_organization_id()) rather than checking
-- coordinator_member_id directly — no existing RLS policy on any other
-- organization-scoped table needs to change for this feature; only the
-- login-time org-resolution query does (see the app code changes in the
-- same commit as this migration).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id       UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  org_role        TEXT NOT NULL DEFAULT 'staff' CHECK (org_role IN ('lead', 'staff')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  invited_by      UUID REFERENCES public.members(id),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at     TIMESTAMPTZ,
  archived_by     UUID REFERENCES public.members(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT organization_members_unique UNIQUE (organization_id, member_id)
);

CREATE INDEX idx_organization_members_org    ON public.organization_members (organization_id);
CREATE INDEX idx_organization_members_member ON public.organization_members (member_id);
CREATE INDEX idx_organization_members_status ON public.organization_members (organization_id, status);

CREATE TRIGGER trg_organization_members_updated_at
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

COMMENT ON TABLE public.organization_members IS
  'Multi-staff membership for organizations — supersedes organizations.coordinator_member_id (kept, legacy/display-only) as the source of truth for who can act on behalf of an org. org_role: lead (can manage staff + org settings) vs staff (day-to-day operations only, service-layer enforced, not RLS-enforced — see lib/services/organization-members.service.ts).';

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members FORCE  ROW LEVEL SECURITY;

CREATE POLICY organization_members_select ON public.organization_members
  FOR SELECT USING (
    is_super_admin()
    OR organization_id = app_current_organization_id()
  );

-- Only a lead of the SAME org (or super_admin) may add/remove/re-role staff.
-- Self-referential EXISTS check against this same table — same pattern
-- group_members' own role-gated policies already use.
CREATE POLICY organization_members_insert ON public.organization_members
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (
      organization_id = app_current_organization_id()
      AND EXISTS (
        SELECT 1 FROM public.organization_members lead
        WHERE lead.organization_id = app_current_organization_id()
          AND lead.member_id = app_current_user_id()
          AND lead.org_role = 'lead'
          AND lead.status = 'active'
      )
    )
  );

CREATE POLICY organization_members_update ON public.organization_members
  FOR UPDATE USING (
    is_super_admin()
    OR (
      organization_id = app_current_organization_id()
      AND EXISTS (
        SELECT 1 FROM public.organization_members lead
        WHERE lead.organization_id = app_current_organization_id()
          AND lead.member_id = app_current_user_id()
          AND lead.org_role = 'lead'
          AND lead.status = 'active'
      )
    )
  );

CREATE POLICY organization_members_delete ON public.organization_members
  FOR DELETE USING (is_super_admin());

-- ─── Backfill ────────────────────────────────────────────────────────────────
-- Every existing single-coordinator org gets that coordinator as its 'lead' —
-- zero behavior change for orgs that already have exactly one coordinator.

INSERT INTO public.organization_members (organization_id, member_id, org_role, status)
SELECT id, coordinator_member_id, 'lead', 'active'
FROM public.organizations
WHERE coordinator_member_id IS NOT NULL
ON CONFLICT (organization_id, member_id) DO NOTHING;
