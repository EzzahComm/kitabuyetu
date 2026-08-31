-- =============================================================================
-- 162: A real consent record for SMS opt-outs (SMS-AUDIT-v3 INV-24 / G20)
--
-- Opt-outs lived in sms_group_settings.opt_out_phones, a text[]. That shape
-- cannot record WHEN someone opted out, HOW (did they ask an officer, use the
-- portal, reply STOP), or WHO actioned it — which is exactly what a data
-- subject or a regulator asks for under the Kenya Data Protection Act 2019.
-- An array also has nowhere to hang an opt-IN event, so the history of a
-- member changing their mind is unrecoverable.
--
-- The array is deliberately LEFT IN PLACE and still backfilled from here.
-- Dropping a column that four code paths read is a separate, riskier change,
-- and keeping it means a rollback of the application does not lose consent
-- state. New writes go to this table; the array is no longer authoritative.
--
-- Safe to introduce now specifically because production has ZERO rows in
-- sms_group_settings — no opt-out has ever been recorded, so the backfill is
-- empty and there is no reconciliation to get wrong. It will not be this cheap
-- again once officers start using it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sms_opt_outs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  phone        VARCHAR(20) NOT NULL,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- How the request reached us. 'member' = the portal toggle, 'officer' = a
  -- group official recording a verbal/in-person request, 'inbound_stop' =
  -- reserved for a provider reply-handler if TextSMS ever supports one,
  -- 'import' = migrated from the legacy array.
  source       TEXT NOT NULL DEFAULT 'member'
                 CHECK (source IN ('member', 'officer', 'inbound_stop', 'import')),
  -- Who recorded it. NULL for a member acting on their own behalf, or for a
  -- migrated row where the actor is genuinely unknown — recording "we do not
  -- know" is more honest than attributing it to whoever ran the migration.
  actor_id     UUID REFERENCES members(id) ON DELETE SET NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live opt-out per (group, phone). Opting back in DELETEs the row, so the
-- absence of a row is the consent state; re-opting out inserts a fresh one
-- with its own timestamp.
CREATE UNIQUE INDEX IF NOT EXISTS sms_opt_outs_group_phone_unique
  ON sms_opt_outs (group_id, phone);

-- The send path asks "is this number opted out" for one group on every send.
CREATE INDEX IF NOT EXISTS idx_sms_opt_outs_group ON sms_opt_outs (group_id);

COMMENT ON TABLE sms_opt_outs IS
  'Live SMS opt-outs, one row per (group, phone). Supersedes '
  'sms_group_settings.opt_out_phones, which could not carry when/how/who.';

-- ─── Backfill from the legacy array ──────────────────────────────────────────
-- Empty in production today. Written anyway so a fresh build or another
-- environment carries its consent state across rather than silently losing it.

INSERT INTO sms_opt_outs (group_id, phone, source, note)
SELECT s.group_id, p, 'import',
       'Migrated from sms_group_settings.opt_out_phones; original date unknown'
  FROM sms_group_settings s
  CROSS JOIN LATERAL unnest(COALESCE(s.opt_out_phones, '{}')) AS p
 WHERE p IS NOT NULL AND p <> ''
ON CONFLICT (group_id, phone) DO NOTHING;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Same group-scoping every other sms_* table uses.

ALTER TABLE sms_opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_opt_outs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_sms_opt_outs_group ON sms_opt_outs;
CREATE POLICY rls_sms_opt_outs_group ON sms_opt_outs
  FOR ALL
  USING (
    (SELECT is_super_admin())
    OR group_id = (SELECT app_current_group_id())
  );

-- Supabase grants full CRUD to anon/authenticated on every new public table.
-- That is safe where a real per-tenant policy constrains it, but this table is
-- a consent record and there is no reason for PostgREST to reach it at all.
REVOKE ALL ON public.sms_opt_outs FROM anon, authenticated;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT, INSERT, DELETE ON public.sms_opt_outs TO app_tenant;
    -- Explicitly removed, not merely un-granted: a blanket default privilege
    -- hands app_tenant UPDATE on new tables regardless of what is granted
    -- here (confirmed in the dry run). Consent state is opt-out-by-INSERT and
    -- opt-in-by-DELETE, so an in-place edit has no legitimate caller — and
    -- silently rewriting when or how someone opted out is precisely what this
    -- table exists to make impossible.
    REVOKE UPDATE ON public.sms_opt_outs FROM app_tenant;
  END IF;
END
$grant$;
