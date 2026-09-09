-- Migration 025: Admin backoffice tables
-- support_tickets, ticket_comments, feature_flags, platform_notifications
-- + groups table extensions for lifecycle management

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared trigger function (admin context, avoids schema resolution issues)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Support tickets
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number   text        NOT NULL DEFAULT 'TKT-' || UPPER(SUBSTRING(gen_random_uuid()::text, 1, 8)),
  group_id        uuid        REFERENCES public.groups(id) ON DELETE SET NULL,
  member_id       uuid        REFERENCES public.members(id) ON DELETE SET NULL,
  assigned_to     uuid        REFERENCES public.members(id) ON DELETE SET NULL,
  category        text        NOT NULL DEFAULT 'general',
  priority        text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status          text        NOT NULL DEFAULT 'open'   CHECK (status  IN ('open','in_progress','waiting','resolved','closed')),
  subject         text        NOT NULL,
  description     text,
  resolution      text,
  sla_hours       integer     NOT NULL DEFAULT 24,
  sla_breach_at   timestamptz,
  first_response_at timestamptz,
  resolved_at     timestamptz,
  closed_at       timestamptz,
  satisfaction_score integer  CHECK (satisfaction_score BETWEEN 1 AND 5),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_tickets_number ON public.support_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_support_tickets_group    ON public.support_tickets(group_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status   ON public.support_tickets(status, priority);
CREATE INDEX IF NOT EXISTS idx_support_tickets_sla      ON public.support_tickets(sla_breach_at) WHERE status NOT IN ('resolved','closed');

CREATE TRIGGER trg_support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.admin_set_updated_at();

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all_tickets" ON public.support_tickets
  USING (current_setting('app.current_role', true) = 'super_admin');

CREATE POLICY "group_own_tickets" ON public.support_tickets
  USING (group_id = current_setting('app.current_group_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Ticket comments (internal notes + customer replies)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ticket_comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid        NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id   uuid        REFERENCES public.members(id) ON DELETE SET NULL,
  is_internal boolean     NOT NULL DEFAULT false,
  content     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON public.ticket_comments(ticket_id, created_at);

ALTER TABLE public.ticket_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all_comments" ON public.ticket_comments
  USING (current_setting('app.current_role', true) = 'super_admin');

CREATE POLICY "group_non_internal_comments" ON public.ticket_comments
  USING (
    is_internal = false
    AND ticket_id IN (
      SELECT id FROM public.support_tickets
      WHERE group_id = current_setting('app.current_group_id', true)::uuid
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Feature flags
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text        NOT NULL,
  description text,
  enabled     boolean     NOT NULL DEFAULT false,
  rollout_pct integer     NOT NULL DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  applies_to  text        NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all','plan','group','member')),
  conditions  jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES public.members(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_flags_key ON public.feature_flags(key);

CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.admin_set_updated_at();

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_feature_flags" ON public.feature_flags
  USING (current_setting('app.current_role', true) = 'super_admin');

-- Seed default flags
INSERT INTO public.feature_flags (key, description, enabled, applies_to, conditions) VALUES
  ('new_dashboard',           'New enterprise dashboard with enhanced analytics',             false, 'all',    '{}'),
  ('ai_loan_recommendations', 'AI-powered loan approval recommendations',                    false, 'plan',   '{"min_plan": "growth"}'),
  ('welfare_module',          'Welfare fund management module',                               true,  'all',    '{}'),
  ('investment_module',       'Investment portfolio tracking module',                         true,  'all',    '{}'),
  ('meeting_management',      'Digital meeting management and resolutions',                   true,  'all',    '{}'),
  ('mpesa_automation',        'Automated M-Pesa contribution reconciliation',                 false, 'plan',   '{"min_plan": "growth"}'),
  ('bulk_sms',                'Bulk SMS notifications for group announcements',               false, 'plan',   '{"min_plan": "growth"}'),
  ('advanced_analytics',      'Advanced analytics dashboard with export capabilities',        false, 'plan',   '{"min_plan": "enterprise"}'),
  ('multi_currency',          'Multi-currency support for international groups',              false, 'plan',   '{"min_plan": "enterprise"}'),
  ('api_access',              'REST API access for third-party integrations',                 false, 'plan',   '{"min_plan": "enterprise"}'),
  ('white_label',             'White-label branding for enterprise deployments',              false, 'plan',   '{"min_plan": "enterprise"}')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Platform notifications (broadcast messages from admin)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text        NOT NULL DEFAULT 'info' CHECK (type IN ('info','warning','error','success','maintenance')),
  title       text        NOT NULL,
  message     text,
  target      text        NOT NULL DEFAULT 'all' CHECK (target IN ('all','admins','group_admins','members')),
  active      boolean     NOT NULL DEFAULT true,
  expires_at  timestamptz,
  created_by  uuid        REFERENCES public.members(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_notifications_active ON public.platform_notifications(active, expires_at);

ALTER TABLE public.platform_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_notifications" ON public.platform_notifications
  USING (current_setting('app.current_role', true) = 'super_admin');

CREATE POLICY "read_active_notifications" ON public.platform_notifications
  FOR SELECT USING (active = true AND (expires_at IS NULL OR expires_at > now()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Extend groups table for lifecycle management
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS onboarding_status text    NOT NULL DEFAULT 'pending'
    CHECK (onboarding_status IN ('pending','active','suspended','deactivated')),
  ADD COLUMN IF NOT EXISTS risk_score        integer DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS engagement_score  integer DEFAULT 0 CHECK (engagement_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS kyc_verified_at   timestamptz,
  ADD COLUMN IF NOT EXISTS kyc_verified_by   uuid REFERENCES public.members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspended_at      timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason  text,
  ADD COLUMN IF NOT EXISTS admin_notes       text;

-- Backfill existing groups to active status
UPDATE public.groups SET onboarding_status = 'active' WHERE onboarding_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_groups_onboarding_status ON public.groups(onboarding_status);
CREATE INDEX IF NOT EXISTS idx_groups_risk_score        ON public.groups(risk_score DESC) WHERE risk_score > 0;
