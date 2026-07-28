-- ─────────────────────────────────────────────────────────────────────────────
-- 104: password reset OTP columns on members
--
-- Closes the UX audit's "self-service forgot-password" gap
-- (docs/audits/UX_SURFACE_AUDIT_2026-07.md §8 item 6). Before this,
-- app/(auth)/forgot-password/page.tsx just told the user to "contact your
-- group admin" — its own code comment said self-service could be wired
-- "once the SMS OTP endpoint is live," which was stale: the crypto/OTP
-- pattern (hashSecret/generateOtp/sendSingleSms) has been proven twice
-- already, by group-verification.service.ts (migration 046) and the
-- organization-invitations flow (migration 102). This reuses the same
-- pattern a third time, this time for a plain member's own password.
--
-- Columns live directly on `members` rather than a separate table: unlike
-- organization_invitations (many rows can exist per org over time) or
-- group_verifications (a group's own one-time onboarding step), a password
-- reset is inherently a single in-flight attempt per member — starting a
-- new one always supersedes whatever was there before, so a 1:1 column set
-- is simpler than a join table with no real multiplicity to model.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.members
  ADD COLUMN reset_otp_hash       TEXT,
  ADD COLUMN reset_otp_expires_at TIMESTAMPTZ,
  ADD COLUMN reset_otp_attempts   INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.members.reset_otp_hash IS
  'SHA-256 hash of the active forgot-password OTP, if any. See lib/services/password-reset.service.ts.';
