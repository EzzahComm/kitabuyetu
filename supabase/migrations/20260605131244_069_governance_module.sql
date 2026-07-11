-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260605131244  name: 069_governance_module
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

CREATE TABLE public.governance_metrics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text UNIQUE NOT NULL,
  name        text NOT NULL,
  category    text NOT NULL,
  unit        text NOT NULL DEFAULT 'percent',
  direction   text NOT NULL DEFAULT 'higher_better',
  sort_order  int  NOT NULL DEFAULT 100,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.governance_thresholds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  metric_code   text NOT NULL REFERENCES public.governance_metrics(code),
  green_min     numeric, green_max numeric,
  amber_min     numeric, amber_max numeric,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, metric_code, effective_from)
);
CREATE INDEX idx_gov_thresholds_metric ON public.governance_thresholds (metric_code);
CREATE INDEX idx_gov_thresholds_group  ON public.governance_thresholds (group_id);

CREATE TABLE public.governance_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  as_of       date NOT NULL,
  period_type text NOT NULL DEFAULT 'monthly',
  metric_code text NOT NULL REFERENCES public.governance_metrics(code),
  value       numeric,
  numerator   numeric,
  denominator numeric,
  rag         text NOT NULL DEFAULT 'na',
  prior_value numeric,
  trend       text,
  details     jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, as_of, period_type, metric_code)
);
CREATE INDEX idx_gov_snap_group_asof ON public.governance_snapshots (group_id, as_of DESC);
CREATE INDEX idx_gov_snap_metric     ON public.governance_snapshots (metric_code, as_of DESC);

ALTER TABLE public.governance_metrics    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_snapshots  ENABLE ROW LEVEL SECURITY;

CREATE POLICY gov_metrics_select ON public.governance_metrics FOR SELECT USING (true);
CREATE POLICY gov_thresholds_select ON public.governance_thresholds
  FOR SELECT USING (group_id IS NULL OR group_id = app_current_group_id() OR is_super_admin());
CREATE POLICY gov_snap_select ON public.governance_snapshots
  FOR SELECT USING (group_id = app_current_group_id() OR is_super_admin());

INSERT INTO public.governance_metrics (code, name, category, unit, direction, sort_order, description) VALUES
  ('liquidity_ratio',   'Liquidity Ratio',            'liquidity',     'percent','higher_better', 10, 'Liquid assets / member deposits'),
  ('ldr',               'Loan-to-Deposit Ratio',      'liquidity',     'percent','band',          20, 'Gross loan portfolio / member deposits'),
  ('par30',             'Portfolio at Risk >30d',     'credit',        'percent','lower_better',  30, 'Balance of loans >30 days late / gross portfolio'),
  ('npl',               'Non-Performing Loan Ratio',  'credit',        'percent','lower_better',  40, 'Defaulted/written-off loans / gross portfolio'),
  ('recovery_rate',     'Loan Recovery Rate',         'credit',        'percent','higher_better', 50, 'Repayments collected / amounts due (trailing 12m)'),
  ('concentration',     'Concentration Risk',         'credit',        'percent','lower_better',  60, 'Largest 10 loans / gross portfolio'),
  ('oss',               'Operational Self-Sufficiency','profitability','percent','higher_better', 70, 'Operating revenue / operating expenses (trailing 12m)'),
  ('cost_to_income',    'Cost-to-Income Ratio',       'efficiency',    'percent','lower_better',  80, 'Operating expenses / operating income (trailing 12m)'),
  ('roa',               'Return on Assets',           'profitability', 'percent','higher_better', 90, 'Net surplus / total assets (trailing 12m)'),
  ('roe',               'Return on Equity',           'profitability', 'percent','higher_better',100, 'Net surplus / member equity (trailing 12m)'),
  ('savings_growth',    'Savings Growth',             'growth',        'percent','higher_better',110, 'Period-over-period change in member savings'),
  ('membership_growth', 'Membership Growth',          'growth',        'percent','higher_better',120, 'Period-over-period change in active members'),
  ('loan_growth',       'Loan Portfolio Growth',      'growth',        'percent','higher_better',130, 'Period-over-period change in gross loans'),
  ('total_savings',     'Member Savings (net)',       'base',          'currency','none',         200, 'Completed contributions - share-outs'),
  ('gross_loans',       'Gross Loan Portfolio',       'base',          'currency','none',         210, 'Outstanding balance of active/disbursed loans'),
  ('active_members',    'Active Members',             'base',          'count',   'none',         220, 'Active group members'),
  ('total_assets',      'Total Assets',               'base',          'currency','none',         230, 'Sum of asset-account balances'),
  ('car',               'Capital Adequacy Ratio',     'capital',       'percent','higher_better',300, 'Institutional capital / risk-weighted assets (needs RWA data)'),
  ('provision_coverage','Provision Coverage',         'credit',        'percent','higher_better',310, 'Loan-loss provisions / NPL (needs provision account)'),
  ('savings_protection','Savings Protection',         'capital',       'percent','higher_better',320, 'Protected assets / deposits (needs protection fund)');

INSERT INTO public.governance_thresholds (group_id, metric_code, green_min, green_max, amber_min, amber_max) VALUES
  (NULL,'liquidity_ratio',   15, NULL, 10,  NULL),
  (NULL,'ldr',               60, 90,   40,  100),
  (NULL,'par30',             NULL, 5,   NULL, 10),
  (NULL,'npl',               NULL, 5,   NULL, 8),
  (NULL,'recovery_rate',     95, NULL, 85,  NULL),
  (NULL,'concentration',     NULL, 25,  NULL, 30),
  (NULL,'oss',               110, NULL,100,  NULL),
  (NULL,'cost_to_income',    NULL, 50,  NULL, 60),
  (NULL,'roa',               1,  NULL,  0,   NULL),
  (NULL,'roe',               10, NULL,  5,   NULL),
  (NULL,'savings_growth',    10, NULL,  0,   NULL),
  (NULL,'membership_growth', 5,  NULL,  0,   NULL),
  (NULL,'loan_growth',       10, NULL,  0,   NULL),
  (NULL,'car',               15, NULL, 10,   NULL),
  (NULL,'provision_coverage',100,NULL, 70,   NULL),
  (NULL,'savings_protection',100,NULL, 80,   NULL);
