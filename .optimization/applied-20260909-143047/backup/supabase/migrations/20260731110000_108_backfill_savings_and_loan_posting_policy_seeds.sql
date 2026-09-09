-- =============================================================================
-- 108: Backfill the policy seed rows migrations 092 and 093 never actually
-- wrote to production.
--
-- Found by docs/audits/PRODUCTION_SCHEMA_DRIFT_AUDIT.md (L1). Both migrations
-- were applied by hand (schema_migrations had no ledger entry for either
-- until this audit's L3 fix), and somewhere in that manual process the plain
-- INSERT statements were skipped or lost — the tables/columns/functions each
-- migration also shipped are all live, only the seed rows are missing.
--
-- No behavioural impact either way: configuration.service.ts's getPolicy()
-- already falls back to identical in-code defaults (DEFAULT_TEMPLATES,
-- DEFAULT_SAVINGS_LIMITS) when a domain/policy_key has zero rows. This just
-- makes the Policies UI show a real stored row (provenance 'platform') at
-- version 1 instead of reporting a fallback that isn't backed by data.
--
-- ON CONFLICT targets migration 086's policies_active_scope_unique partial
-- index directly (domain, policy_key, COALESCE'd org/group scope, WHERE
-- is_active) rather than 092/093's plain INSERT, so a fresh environment that
-- already ran 092/093 successfully is a no-op instead of a duplicate/error.
-- =============================================================================

INSERT INTO policies (domain, policy_key, value, version)
VALUES ('savings', 'limits',
  '{"minContribution": 0, "maxContribution": null, "gracePeriodDays": 0}'::jsonb,
  1)
ON CONFLICT (
  domain, policy_key,
  COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'),
  COALESCE(group_id,        '00000000-0000-0000-0000-000000000000')
) WHERE is_active DO NOTHING;

INSERT INTO policies (domain, policy_key, value, version)
VALUES
  ('accounting', 'posting_template.loan_disbursement',
   '{"lines": [
     {"accountCode": "1101", "side": "debit",  "amount": "principal"},
     {"accountCode": "1001", "side": "credit", "amount": "principal"},
     {"accountCode": "5001", "side": "debit",  "amount": "charge"},
     {"accountCode": "1001", "side": "credit", "amount": "charge"}
   ]}'::jsonb,
   1),
  ('accounting', 'posting_template.loan_repayment',
   '{"lines": [
     {"accountCode": "1001", "side": "debit",  "amount": "principal"},
     {"accountCode": "1101", "side": "credit", "amount": "principal"},
     {"accountCode": "1001", "side": "debit",  "amount": "interest"},
     {"accountCode": "4002", "side": "credit", "amount": "interest"}
   ]}'::jsonb,
   1)
ON CONFLICT (
  domain, policy_key,
  COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'),
  COALESCE(group_id,        '00000000-0000-0000-0000-000000000000')
) WHERE is_active DO NOTHING;
