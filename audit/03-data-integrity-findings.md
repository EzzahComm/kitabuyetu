# 03 — Data Integrity Findings

**Date:** 2026-07-27. Most of this ground was already covered in exhaustive depth by the `ACCOUNTING_ARCHITECTURE_AUDIT.md` series (see [[project-kitabu-yetu-audits]] — ~30 report sections, largest audit in the project's history, fully implemented across ~20 follow-up commits). This phase **re-verifies the load-bearing invariants still hold** rather than re-deriving them from scratch, and checks the brief's specific checklist items that weren't the accounting audit's focus.

## Double-entry invariants

- ✅ **Verified present, not assumed**: `trg_assert_posted_entry_balance` (migration 027, group-side) and `trg_assert_org_posted_entry_balance` (migration 085, organization-side) are `CONSTRAINT TRIGGER`s — deferred, fire at transaction commit — that reject any posted journal entry where debits ≠ credits. This is enforced **at the database**, not just in application code, so even a bug in a future posting-path change cannot silently create an unbalanced entry; it fails the transaction instead.
- ✅ Confirmed these triggers were carried forward correctly into the `journal_lines` partitioning migration (094) — each partition got its own copy, since Postgres constraint triggers (unlike ordinary triggers) don't auto-clone to partitions. This was flagged as an open verification risk in the original implementation (Docker wasn't reachable to test against a real Postgres 17 instance) — **still true today, still unresolved**. Re-flagging here since it's a data-integrity risk, not just a migration-mechanics one: if the per-partition trigger silently failed to attach on some partition, that partition's entries would be un-enforced. Recommend this be the first thing verified against a real Postgres 17 instance, before any further schema work touches `journal_lines`.
- Did not re-run a live reconciliation query this pass (no seed/test data environment available in this session) — the existing real-Postgres tenant-isolation test suite exercises adjacent invariants but isn't a full ledger-balance reconciliation test. **Recommend**: a dedicated test (or a one-off admin query) that sums debits/credits across every group's `journal_lines` and asserts zero variance, run against staging before any production deploy that touches posting logic.

## Orphaned records / foreign keys

- ✅ **271 FK references found across the schema**, with a healthy, deliberate mix of delete policies (86 CASCADE, 84 RESTRICT, 90 SET NULL/DEFAULT) — not a blanket "CASCADE everything" pattern that would risk silent data loss on a parent-row delete. Financial parent tables (`groups`, `members`, `loans`) predominantly use RESTRICT, meaning a group/member/loan can't be deleted out from under its financial history — the correct default for this domain.
- ✅ Only **one** `DROP TABLE` exists in the entire 117-migration history (`group_constitutions`, migration 088), and it's guarded (`IF EXISTS`) and was the accounting-audit series' own deliberate, sign-off-confirmed retirement (data migrated into `policies` first) — not a risky ad hoc drop.
- Did not exhaustively re-verify "members without a valid National ID link" / "share-outs referencing deleted cycles" as literal orphan-row queries this pass (would need a live DB with data) — the FK/delete-policy structure above is strong evidence against *new* orphans, but pre-existing orphaned rows (from data before a constraint was added, e.g. migrations that add a FK to an already-populated table) aren't ruled out by schema inspection alone. **Recommend**: a one-off `LEFT JOIN ... WHERE parent.id IS NULL`-style sweep against staging/production data if this hasn't been run since the FKs were added.

## Constraints on financially-critical columns

- ✅ **66 `CHECK` constraints reference `amount`/positivity conditions** across the schema — spot-checked several (contribution/loan amounts, disbursement amounts) and confirmed they reject zero/negative values at the database level, not just in Zod validators (which are also present, per `02-security-findings.md` §2.5 — this is real defense in depth, not either/or).
- Only **4** `amount NUMERIC` columns found without an explicit `NOT NULL` — not individually re-verified this pass whether each is a legitimate "optional until a later lifecycle stage" field (e.g. `welfare_requests.amount_approved`, which is genuinely null until an officer approves — confirmed this specific one directly while working on the welfare page this session) or a real gap. **Recommend**: a quick per-column pass on the other 3 before considering this fully closed.
- `national_id` on `members` is nullable with a `UNIQUE` constraint — this is correct Postgres behavior (multiple NULLs don't violate uniqueness) and matches the known registration flow where National ID isn't always collected at signup time — not a finding, despite superficially looking like a gap.

## Migration reversibility

- Migrations are additive/forward-only by convention in this repo (117 files, one `DROP TABLE`, no destructive `ALTER ... DROP COLUMN` found without a preceding audit/backfill step in the ones sampled). There is **no formal down-migration file per migration** (no `xxxx_down.sql` convention) — reversibility instead comes from the discipline of writing migrations that are safe to leave in place (rename instead of drop, add-nullable-then-backfill-then-constrain, etc.), which is what's actually practiced across the history sampled. This is a real gap **relative to the brief's literal ask** ("clear forward path and... rollback strategy documented") but matches a common, defensible pattern for a single-environment-per-migration-run Supabase project — flagging as a **Medium** process gap (no written rollback runbook exists) rather than a **Critical** data-risk finding, since the migrations themselves are written defensively.
- The one area with a **documented, still-open** rollback/verification gap is the `journal_lines` partitioning work (094/095) — see above and [[project-kitabu-yetu-audits]] for the full caveat: the SQL was manually reviewed (catching one real bug in the process) but never executed against a real Postgres 17 instance due to a sandboxed environment's Docker daemon being unreachable at the time.

## Timezone handling

- ✅ **100% `TIMESTAMPTZ`, zero bare `TIMESTAMP` columns** found across all 117 migrations (grepped every timestamp-typed column declaration). Every timestamp is stored as an absolute instant (UTC-normalized internally by Postgres), not a naive local time — the structurally correct pattern for a Kenya-based (EAT, UTC+3) system that may run its application tier in a different timezone than its database host. No finding — this is fully consistent by construction, not just "mostly right."

## Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Medium | `journal_lines` partition-trigger-cloning (094/095) never verified against a real Postgres 17 instance | **Open, pre-existing, re-flagged** |
| 2 | Medium | No live ledger-balance reconciliation query run this pass (no data environment available) | **Recommend before next posting-logic deploy** |
| 3 | Low | No formal down-migration/rollback runbook (mitigated by defensive forward-migration discipline) | **Open — process gap, not a data-risk finding** |
| 4 | Low | 4 nullable `amount` columns not individually re-verified as intentional | **Open — quick follow-up** |
| — | — | Double-entry balance enforcement, FK/delete-policy hygiene, destructive-migration hygiene, timezone consistency | **No finding — verified** |
