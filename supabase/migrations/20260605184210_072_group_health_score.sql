-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260605184210  name: 072_group_health_score
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

CREATE TABLE public.governance_health_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  as_of       date NOT NULL,
  period_type text NOT NULL DEFAULT 'monthly',
  score       numeric NOT NULL,
  category    text NOT NULL,
  components  jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, as_of, period_type)
);
CREATE INDEX idx_gov_health_group ON public.governance_health_scores (group_id, as_of DESC);

ALTER TABLE public.governance_health_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY gov_health_select ON public.governance_health_scores
  FOR SELECT USING (group_id = app_current_group_id() OR is_super_admin());

INSERT INTO public.governance_metrics (code, name, category, unit, direction, sort_order, description) VALUES
  ('group_health', 'Group Health Score', 'health', 'score', 'higher_better', 5, 'Composite 0-100 of repayment, savings, attendance, governance & more')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.governance_thresholds (group_id, metric_code, green_min, green_max, amber_min, amber_max) VALUES
  (NULL, 'group_health', 70, NULL, 55, NULL)
ON CONFLICT (group_id, metric_code, effective_from) DO NOTHING;
