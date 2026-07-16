-- LoanPolicy — the second Configuration Service domain (ACCOUNTING_ARCHITECTURE_AUDIT.md
-- §29.5/§33.5), reusing the generic `policies` engine built in migration 086.
-- Replaces credit-scores.service.ts's hardcoded TIER_THRESHOLDS constant
-- (the literal example §29.6 cites) with a Platform -> Organization -> Group
-- configurable value: the reliability-tier ladder and each tier's loan
-- multiplier used to compute a member's advisory loan_eligibility_limit.
--
-- Note: loan_eligibility_limit is informational only today — grep confirms
-- no loan-approval code path reads it, so this migration changes zero
-- lending-enforcement behavior. It only makes the number configurable.
--
-- Seeded to the EXACT array TIER_THRESHOLDS already hardcoded, so this
-- changes zero behavior for any group until it (or its organization, or the
-- platform) explicitly configures an override.

INSERT INTO policies (domain, policy_key, value, version)
VALUES (
  'loan', 'tier_thresholds',
  '[
    {"tier": "excellent", "min": 85, "loanMultiplier": 10},
    {"tier": "good",      "min": 70, "loanMultiplier": 5},
    {"tier": "fair",      "min": 55, "loanMultiplier": 3},
    {"tier": "poor",      "min": 40, "loanMultiplier": 1},
    {"tier": "high_risk", "min": 0,  "loanMultiplier": 0.5}
  ]'::jsonb,
  1
);
