-- =============================================================================
-- 197: Phase 10 — newsletter subscribers (public marketing site)
--
-- Not a resurrection of the newsletter_subscribers table dropped in migration
-- 177 (confirmed dead: 0 rows, 0 references) — that one was per-group
-- (`group_id NOT NULL`-via-uniqueness), which never made sense for a public
-- marketing-site newsletter: a blog visitor isn't a member of any chama and
-- has no tenant context. This is a fresh, deliberately PLATFORM-level table —
-- no group_id/organization_id at all, same "genuinely platform-wide" shape
-- as sms_provider_health_state (163) — readable only by super_admin/support,
-- written only by the public subscribe/unsubscribe API routes via the admin
-- pool (which bypasses RLS as it always does).
--
-- Single opt-in, not double: subscribing IS the explicit consent action
-- (matches crm_contacts' "marketing_opt_in defaults false, must be
-- deliberately set" bar from migration 192 — a public sign-up submission is
-- exactly that deliberate act). No confirmation-email round trip for v1.
-- =============================================================================

CREATE TABLE newsletter_subscribers (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT         NOT NULL,
  name              TEXT,
  source            VARCHAR(50)  NOT NULL DEFAULT 'website',
  unsubscribe_token UUID         NOT NULL DEFAULT gen_random_uuid(),
  subscribed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  unsubscribed_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One row per email, ever — re-subscribing an unsubscribed address updates
-- the existing row (clears unsubscribed_at) rather than inserting a
-- duplicate, so the unsubscribe_token stays stable across the lifecycle.
CREATE UNIQUE INDEX idx_newsletter_subscribers_email ON newsletter_subscribers (lower(email));
CREATE UNIQUE INDEX idx_newsletter_subscribers_token ON newsletter_subscribers (unsubscribe_token);
-- Hot path: "who do we actually send to" — the audience resolver for a
-- future newsletter campaign filters on this.
CREATE INDEX idx_newsletter_subscribers_active ON newsletter_subscribers (subscribed_at DESC)
  WHERE unsubscribed_at IS NULL;

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_subscribers FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_newsletter_subscribers_super_admin ON newsletter_subscribers
  FOR ALL
  USING ((SELECT is_super_admin()));

REVOKE ALL ON public.newsletter_subscribers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.newsletter_subscribers TO service_role;
