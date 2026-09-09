-- =============================================================================
-- 008_audit_notifications.sql
-- Immutable audit trail and in-app / SMS notification records
-- =============================================================================

-- ---------------------------------------------------------------------------
-- audit_logs
-- Append-only log of all significant actions. Rows are never updated or
-- deleted (enforced via a BEFORE UPDATE/DELETE trigger below).
-- group_id is nullable because super_admin actions may not be group-scoped.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID        REFERENCES groups  (id) ON DELETE SET NULL,
  actor_id      UUID        REFERENCES members (id) ON DELETE SET NULL,
  action        VARCHAR(100) NOT NULL,   -- e.g. 'member.view_pii', 'loan.approve'
  resource_type VARCHAR(100) NOT NULL,   -- e.g. 'member', 'loan', 'contribution'
  resource_id   UUID,
  old_values    JSONB,
  new_values    JSONB,
  ip_address    INET,
  user_agent    TEXT,
  -- Immutable timestamp — no updated_at column
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_group_id      ON audit_logs (group_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor_id      ON audit_logs (actor_id,  created_at DESC);
CREATE INDEX idx_audit_logs_action        ON audit_logs (action);
CREATE INDEX idx_audit_logs_resource      ON audit_logs (resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at    ON audit_logs (created_at DESC);

-- Prevent any modification or deletion of audit records
CREATE OR REPLACE FUNCTION audit_logs_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs rows are immutable';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.audit_logs_immutable() FROM anon, authenticated, public;

CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- ---------------------------------------------------------------------------
-- notifications
-- In-app notification records. SMS notifications are tracked in sms_usage_logs.
-- reference_type / reference_id allow deep-linking to the originating resource.
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id             UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID              REFERENCES groups  (id) ON DELETE CASCADE,
  member_id      UUID              REFERENCES members (id) ON DELETE CASCADE,
  type           notification_type NOT NULL,
  title          VARCHAR(255)      NOT NULL,
  body           TEXT              NOT NULL,
  is_read        BOOLEAN           NOT NULL DEFAULT false,
  read_at        TIMESTAMPTZ,
  reference_type VARCHAR(50),     -- 'loan', 'contribution', 'billing', 'sms'
  reference_id   UUID,
  created_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_member_id   ON notifications (member_id, created_at DESC);
CREATE INDEX idx_notifications_group_id    ON notifications (group_id,  created_at DESC);
CREATE INDEX idx_notifications_unread      ON notifications (member_id, is_read)
  WHERE is_read = false;
CREATE INDEX idx_notifications_reference   ON notifications (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;
