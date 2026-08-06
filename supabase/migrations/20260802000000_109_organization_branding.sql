-- ─────────────────────────────────────────────────────────────────────────────
-- 109: organization branding (logo + primary color)
--
-- Closes ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md Phase 4's "branding"
-- enterprise-portal nav item. Zero schema existed on `organizations` for
-- this before — the only `logo_url`/`primary_color` columns anywhere are on
-- `groups` (migration 001) and `group_email_branding` (migration 012), both
-- a different, already-solved problem (per-group email template branding).
--
-- Scope deliberately minimal (logo + primary color only, no custom domain —
-- decided via AskUserQuestion, 2026-08-02): mirrors group_email_branding's
-- shape, just scoped to the organization itself rather than email templates.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN logo_url      TEXT,
  ADD COLUMN primary_color VARCHAR(7);

COMMENT ON COLUMN public.organizations.logo_url IS
  'Organization logo shown in the enterprise portal header/sidebar. Plain URL, no upload pipeline (mirrors group_email_branding.logo_url).';
COMMENT ON COLUMN public.organizations.primary_color IS
  'Hex color (e.g. #16a34a) accenting the enterprise portal for this organization.';
