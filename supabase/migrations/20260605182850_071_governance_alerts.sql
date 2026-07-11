-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260605182850  name: 071_governance_alerts
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

CREATE TABLE public.governance_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  metric_code     text NOT NULL REFERENCES public.governance_metrics(code),
  as_of           date NOT NULL,
  period_type     text NOT NULL DEFAULT 'monthly',
  severity        text NOT NULL,
  value           numeric,
  message         text NOT NULL,
  status          text NOT NULL DEFAULT 'open',
  acknowledged_by uuid REFERENCES public.members(id),
  acknowledged_at timestamptz,
  dedup_key       text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT governance_alerts_severity_chk CHECK (severity IN ('amber','red')),
  CONSTRAINT governance_alerts_status_chk   CHECK (status IN ('open','acknowledged','resolved'))
);
CREATE INDEX idx_gov_alerts_group  ON public.governance_alerts (group_id, status, created_at DESC);
CREATE INDEX idx_gov_alerts_metric ON public.governance_alerts (metric_code);

ALTER TABLE public.governance_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY gov_alerts_select ON public.governance_alerts
  FOR SELECT USING (group_id = app_current_group_id() OR is_super_admin());
