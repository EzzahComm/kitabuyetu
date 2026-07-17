-- SavingsPolicy — a new Configuration Service domain (ACCOUNTING_ARCHITECTURE_AUDIT.md
-- §29.5/§33.5), following the exact Platform -> Organization -> Group pattern
-- already proven by ApprovalPolicy/LoanPolicy/FinePolicy. Unlike those domains,
-- there is no prior hardcoded constant or retired group_constitutions column to
-- migrate here — §22 found min/max contribution and grace-period concepts are
-- simply absent from the codebase today. These seed values ARE the definition
-- of "no limit" (min 0, no max, no grace period), not a preservation of
-- existing behavior, since none existed.
--
-- Confirmed advisory, not enforced: contributions.service.ts's create() is
-- unchanged by this migration. The contribution form reads this policy only
-- to pre-fill/annotate, exactly like loan terms (migration 088) — a treasurer
-- can still record any positive amount.

INSERT INTO policies (domain, policy_key, value, version)
VALUES ('savings', 'limits',
  '{"minContribution": 0, "maxContribution": null, "gracePeriodDays": 0}'::jsonb,
  1);
