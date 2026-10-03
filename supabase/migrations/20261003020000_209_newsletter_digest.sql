-- =============================================================================
-- 209_newsletter_digest.sql
-- Admin-composed campaign digest emails to newsletter_subscribers (migration
-- 197). Platform-level, like newsletter_subscribers itself — no group_id,
-- not modeled on email_campaigns/email_campaign_recipients (migration 012),
-- which are group-tenant-scoped and have no path for a platform-wide
-- audience. Preview-before-fire: a digest is composed as a draft, the admin
-- reviews/edits it, then explicitly sends — mirrors the weekly
-- savings-update SMS workflow (migration 207/208) at the UI level, not the
-- schema level (no recurring schedule here; every send is a one-off,
-- admin-triggered action).
-- =============================================================================

CREATE TABLE newsletter_digests (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject          TEXT        NOT NULL,
  html_body        TEXT        NOT NULL,
  campaign_ids     UUID[]      NOT NULL DEFAULT '{}',
  status           TEXT        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  total_recipients INTEGER,
  sent_count       INTEGER     NOT NULL DEFAULT 0,
  failed_count     INTEGER     NOT NULL DEFAULT 0,
  created_by       UUID        REFERENCES members (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ
);

CREATE INDEX idx_newsletter_digests_status ON newsletter_digests (status, created_at DESC);

CREATE TABLE newsletter_digest_recipients (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_id      UUID        NOT NULL REFERENCES newsletter_digests (id) ON DELETE CASCADE,
  subscriber_id  UUID        NOT NULL REFERENCES newsletter_subscribers (id) ON DELETE CASCADE,
  email          TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  error_message  TEXT,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (digest_id, subscriber_id)
);

CREATE INDEX idx_newsletter_digest_recipients_pending
  ON newsletter_digest_recipients (digest_id)
  WHERE status = 'pending';

ALTER TABLE newsletter_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_digests FORCE ROW LEVEL SECURITY;
ALTER TABLE newsletter_digest_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_digest_recipients FORCE ROW LEVEL SECURITY;

-- Same restriction as newsletter_subscribers (migration 197): platform data,
-- no tenant to scope to, so only super_admin can see it. All access in
-- practice goes through withAdminDb via newsletter-digest.service.ts anyway.
CREATE POLICY rls_newsletter_digests_super_admin ON newsletter_digests
  FOR ALL USING ((SELECT is_super_admin()));

CREATE POLICY rls_newsletter_digest_recipients_super_admin ON newsletter_digest_recipients
  FOR ALL USING ((SELECT is_super_admin()));

REVOKE ALL ON public.newsletter_digests FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.newsletter_digests TO service_role;
REVOKE ALL ON public.newsletter_digest_recipients FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.newsletter_digest_recipients TO service_role;
