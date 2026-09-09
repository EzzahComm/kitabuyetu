-- =============================================================================
-- 045_member_mfa_secrets.sql
-- Phase 2 of backoffice isolation: TOTP enrollment for platform staff.
--
-- One row per member who has enrolled an authenticator. Members with no
-- row (or who deleted their row) are treated as "needs enrollment" — the
-- backoffice login flow walks them through it on next sign-in.
--
-- Privacy / security:
--   - secret_encrypted is AES-256-GCM ciphertext of the TOTP secret using
--     ENCRYPTION_KEY (already in env). Plaintext secret is NEVER stored.
--   - recovery_hashes are bcrypt hashes of single-use recovery codes
--     issued at enrollment. Used codes are removed from the array.
--   - RLS is enabled with no policies because only the service role (the
--     app's DB connection) writes/reads this table — matches the
--     job_queue + job_logs pattern from mig 041.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.member_mfa_secrets (
  member_id           UUID         PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,

  secret_encrypted    TEXT         NOT NULL,
  recovery_hashes     TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  enrolled_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_verified_at    TIMESTAMPTZ,
  label               TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT mfa_secret_not_empty CHECK (length(secret_encrypted) > 0)
);

CREATE INDEX IF NOT EXISTS idx_mfa_secrets_member ON public.member_mfa_secrets (member_id);

ALTER TABLE public.member_mfa_secrets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.touch_member_mfa_secrets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_mfa_secrets_updated_at ON public.member_mfa_secrets;
CREATE TRIGGER trg_member_mfa_secrets_updated_at
  BEFORE UPDATE ON public.member_mfa_secrets
  FOR EACH ROW EXECUTE FUNCTION public.touch_member_mfa_secrets_updated_at();

COMMENT ON TABLE public.member_mfa_secrets IS
  'TOTP secret + recovery code hashes for platform staff (backoffice MFA). One row per enrolled member. Secret encrypted with ENCRYPTION_KEY env var via AES-256-GCM.';
