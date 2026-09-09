-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260602145735  name: 055_email_suppressions
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

CREATE TABLE email_suppressions (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT         NOT NULL,
  reason      VARCHAR(20)  NOT NULL CHECK (reason IN ('bounced','complained','unsubscribed','manual')),
  source      VARCHAR(60),
  metadata    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_email_suppression_email ON email_suppressions (lower(email));
CREATE INDEX idx_email_suppression_reason ON email_suppressions (reason);

CREATE TRIGGER set_email_suppressions_updated_at
  BEFORE UPDATE ON email_suppressions
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppressions FORCE  ROW LEVEL SECURITY;

CREATE POLICY email_suppressions_admin ON email_suppressions
  FOR ALL USING (is_super_admin());
