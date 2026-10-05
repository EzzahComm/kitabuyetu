-- 205: platform activity log + admin notification delivery tracking.
--
-- Every material platform event is written once to platform_activity_logs
-- (lib/notifications emitActivity). Administrator SMS/email alerts for an
-- event are tracked one row per (event, channel, recipient) in
-- notification_deliveries, whose idempotency_key makes a duplicate emit or a
-- retried callback unable to notify twice.
--
-- Platform-only data: RLS is enabled with a super-admin SELECT policy and NO
-- grants for anon/authenticated. The app writes through the privileged pool
-- (withAdminDb), exactly like audit_logs. No secrets are ever stored: the
-- application strips credential-like keys before insert.

CREATE TABLE IF NOT EXISTS public.platform_activity_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq               bigint GENERATED ALWAYS AS IDENTITY,
  event_type        text        NOT NULL,
  severity          text        NOT NULL CHECK (severity IN ('INFO','WARNING','HIGH','CRITICAL')),
  title             text        NOT NULL,
  description       text,
  actor_user_id     uuid,
  actor             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  organization_id   uuid,
  organization_name text,
  group_id          uuid,
  group_name        text,
  transaction_id    text,
  reference         text,
  amount            numeric(18,2),
  currency          text,
  status            text,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ip_address        text,
  user_agent        text,
  -- Caller-supplied natural key (a receipt, a withdrawal id + status…). A
  -- second emit with the same key is a no-op, so repeated provider callbacks
  -- cannot generate a second alert.
  dedup_key         text,
  notify            boolean     NOT NULL DEFAULT true,
  -- High-volume events are not alerted one by one; the digest job sends one
  -- summary and stamps digest_sent_at.
  aggregate         boolean     NOT NULL DEFAULT false,
  digest_sent_at    timestamptz,
  occurred_at       timestamptz NOT NULL DEFAULT NOW(),
  created_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_activity_dedup ON public.platform_activity_logs (dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_activity_created  ON public.platform_activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_activity_type     ON public.platform_activity_logs (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_activity_severity ON public.platform_activity_logs (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_activity_org      ON public.platform_activity_logs (organization_id, created_at DESC) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_activity_group    ON public.platform_activity_logs (group_id, created_at DESC) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_activity_actor    ON public.platform_activity_logs (actor_user_id, created_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_activity_ref      ON public.platform_activity_logs (reference) WHERE reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_activity_digest   ON public.platform_activity_logs (created_at) WHERE aggregate AND notify AND digest_sent_at IS NULL;

-- Audit rows are never deleted.
CREATE OR REPLACE FUNCTION public.platform_activity_no_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'platform_activity_logs rows cannot be deleted';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.platform_activity_no_delete() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS trg_platform_activity_no_delete ON public.platform_activity_logs;
CREATE TRIGGER trg_platform_activity_no_delete
  BEFORE DELETE ON public.platform_activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.platform_activity_no_delete();

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                 bigint GENERATED ALWAYS AS IDENTITY,
  activity_id         uuid        NOT NULL REFERENCES public.platform_activity_logs (id),
  channel             text        NOT NULL CHECK (channel IN ('sms','email')),
  recipient           text        NOT NULL,
  status              text        NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','QUEUED','SENT','DELIVERED','FAILED','RETRYING','CANCELLED')),
  provider            text,
  provider_message_id text,
  attempt_count       integer     NOT NULL DEFAULT 0,
  error_message       text,
  -- event_id + channel + recipient
  idempotency_key     text        NOT NULL,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_deliveries_idem ON public.notification_deliveries (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_activity ON public.notification_deliveries (activity_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status   ON public.notification_deliveries (status, created_at DESC);

-- Per-event overrides of the built-in routing defaults (NULL = use default).
CREATE TABLE IF NOT EXISTS public.admin_notification_preferences (
  event_type    text PRIMARY KEY,
  sms_enabled   boolean,
  email_enabled boolean,
  aggregate     boolean,
  updated_at    timestamptz NOT NULL DEFAULT NOW()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_activity_logs','notification_deliveries','admin_notification_preferences'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_super_admin_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_super_admin())', t || '_super_admin_select', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
