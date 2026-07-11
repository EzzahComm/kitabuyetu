-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260602154552  name: 056_member_invitations
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

CREATE TYPE invitation_kind AS ENUM ('officer', 'member');

CREATE TYPE invitation_status AS ENUM (
  'pending_payment', 'invited', 'email_confirmed', 'otp_sent', 'verified',
  'completed', 'expired', 'cancelled'
);

CREATE TABLE member_invitations (
  id                  UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id           UUID               NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  group_id            UUID               NOT NULL REFERENCES groups  (id) ON DELETE CASCADE,
  kind                invitation_kind    NOT NULL,
  status              invitation_status  NOT NULL DEFAULT 'invited',
  email               TEXT,
  email_confirmed_at  TIMESTAMPTZ,
  otp_hash            TEXT,
  otp_expires_at      TIMESTAMPTZ,
  otp_attempts        INTEGER            NOT NULL DEFAULT 0,
  otp_verified_at     TIMESTAMPTZ,
  stk_checkout_id     TEXT,
  paid_at             TIMESTAMPTZ,
  mpesa_receipt       VARCHAR(50),
  invited_by          UUID               REFERENCES members (id) ON DELETE SET NULL,
  completed_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ        NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  metadata            JSONB              NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_member_invitations_member   ON member_invitations (member_id);
CREATE INDEX idx_member_invitations_group    ON member_invitations (group_id, status);
CREATE INDEX idx_member_invitations_checkout ON member_invitations (stk_checkout_id) WHERE stk_checkout_id IS NOT NULL;
CREATE UNIQUE INDEX uq_member_invitation_active ON member_invitations (member_id, group_id)
  WHERE status NOT IN ('completed', 'expired', 'cancelled');

CREATE TRIGGER set_member_invitations_updated_at
  BEFORE UPDATE ON member_invitations
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE member_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_invitations FORCE  ROW LEVEL SECURITY;

CREATE POLICY member_invitations_select ON member_invitations
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY member_invitations_modify ON member_invitations
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('group_admin','treasurer','secretary'))
  );
