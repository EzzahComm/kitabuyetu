-- ─────────────────────────────────────────────────────────────────────────────
-- 102: organization_invitations — multi-staff organizations (Phase 2)
--
-- Real email + phone-OTP invite flow for organization staff, replacing the
-- Phase 1 (migration 101) direct-add-with-temp-password path as the primary
-- onboarding route (addOrgStaff() itself is untouched and stays available
-- for adding someone who's already a known member).
--
-- Deliberately a NEW, parallel table rather than a retrofit of
-- member_invitations (migration 056) — that table is group_id-shaped
-- (NOT NULL) and carries M-Pesa payment-gating columns (stk_checkout_id,
-- paid_at, mpesa_receipt) specific to group membership fees, which don't
-- apply to organization staff at all. member_invitations has zero
-- application-code references anywhere in this repo (grep-verified), so
-- there is no shared-usage benefit to retrofitting it — only unwanted
-- coupling to group-fee semantics. Mirrors its useful shape only: the
-- email-confirm + OTP state machine.
--
-- Two-channel verification before a real backoffice-privileged account is
-- created: the emailed link proves control of the inbox, the SMS OTP
-- (sent only after the link is clicked) proves control of the phone —
-- reuses the exact crypto primitives (hashSecret/generateEmailToken/
-- generateOtp) and RPC-free, plain-service-function style already
-- established by lib/services/group-verification.service.ts (migration 046),
-- not a new pattern.
--
-- The accept-invite flow itself is entirely PUBLIC/unauthenticated (a
-- visitor with only the emailed link, no session) — every route touching
-- this table runs through withAdminDb, same as group-verification's own
-- completeGroupVerificationByToken(). RLS below is defense-in-depth for the
-- admin-authenticated creation/listing path (which also currently uses
-- withAdminDb per migration 101's own established convention), not a live
-- boundary for the public accept flow.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.organization_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  org_role        TEXT NOT NULL DEFAULT 'staff' CHECK (org_role IN ('lead', 'staff')),
  status          TEXT NOT NULL DEFAULT 'invited'
                    CHECK (status IN ('invited', 'email_confirmed', 'otp_sent', 'verified', 'completed', 'expired', 'cancelled')),
  invited_by      UUID NOT NULL REFERENCES public.members(id),
  token_hash      TEXT NOT NULL,
  otp_hash        TEXT,
  otp_expires_at  TIMESTAMPTZ,
  otp_attempts    INT NOT NULL DEFAULT 0,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organization_invitations_org        ON public.organization_invitations (organization_id, status);
CREATE UNIQUE INDEX uq_organization_invitations_token ON public.organization_invitations (token_hash);

CREATE TRIGGER trg_organization_invitations_updated_at
  BEFORE UPDATE ON public.organization_invitations
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

COMMENT ON TABLE public.organization_invitations IS
  'Email + phone-OTP invite flow for organization staff (Phase 2 of multi-staff organizations, migration 101). Public/unauthenticated accept flow — see lib/services/organization-members.service.ts.';

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Defense-in-depth only — see header comment. Mirrors organization_members'
-- (migration 101) lead-gated pattern.

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitations FORCE  ROW LEVEL SECURITY;

CREATE POLICY organization_invitations_select ON public.organization_invitations
  FOR SELECT USING (
    is_super_admin()
    OR organization_id = app_current_organization_id()
  );

CREATE POLICY organization_invitations_insert ON public.organization_invitations
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

CREATE POLICY organization_invitations_update ON public.organization_invitations
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

CREATE POLICY organization_invitations_delete ON public.organization_invitations
  FOR DELETE USING (is_super_admin());
