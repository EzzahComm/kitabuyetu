# 07 — Remediation Backlog

Consolidated from `02`–`05`. Ordered by severity, then by the brief's own stated priority (RLS
and M-Pesa reconciliation first). None of these have been fixed yet — each needs either a product
decision, a live-environment check the repo alone can't answer, or a schema change on a
money-movement table that this audit's own rules (see `06-fix-log.md`) require verifying against
a scratch DB first, not shipping from a static read.

## BLOCKER (deployment-readiness gate, see bottom of this file)

**None found that would already be silently broken in production.** The one item that *could*
be a blocker (item 1 below) can't be resolved by reading the repo — it requires checking the live
hosting environment's variables, which this audit had no access to.

## Critical

1. **Confirm whether `TENANT_DATABASE_URL` is provisioned in production.** (`02-security-findings.md` #1)
   Affected: entire tenant-traffic RLS enforcement model.
   Approach: check the live Vercel/hosting environment variables directly — this cannot be
   answered from the repo. If unset, tenant traffic runs 100% on hand-written `WHERE group_id`
   predicates with RLS as inert schema decoration; if set, RLS is a live second layer already.
   Effort: near-zero (a config check), but **the single highest-leverage open question in this
   entire audit** — every other RLS-related finding's real-world severity depends on the answer.

## High

~~2. Add RLS policies to `mpesa_b2c_transactions`, `mpesa_b2b_transactions`, `mpesa_b2c_charge_tiers`.~~
**RETRACTED — false positive.** All three already have `ENABLE ROW LEVEL SECURITY` and a real
policy (migration 012's `DO $$ ... EXECUTE format(...) $$` loop for the transactions tables,
migration 047's literal policy for the charge-tiers table). Found during Phase 6 implementation
research, before any migration was written — see `02-security-findings.md` §2.2 for the full
correction and root cause (a static grep can't see policies created inside dynamic SQL, and
migration 097's own comment had already warned about exactly this blind spot).

## Medium

3. **Paginate `organizationService.listGroupSummaries()`.** (`04-performance-findings.md` #1)
   Affected: `(dashboard)/organization` and `(enterprise)/enterprise/branches` (both wired to this
   endpoint this session) — unbounded for a federation with a large group count.
   Approach: add `page`/`limit` params mirroring every other list service; needs a small shape
   change on both consuming pages' hooks. Not a silent fix — flagged per Phase 6 rule #1.
   Effort: small-medium (one service function + two page call sites + their tests).

4. **Verify the `journal_lines` partition constraint-trigger cloning against a real Postgres 17 instance.** (`03-data-integrity-findings.md` #1)
   Pre-existing, carried over from the accounting-audit series — never actually executed against
   real Postgres due to a sandboxed environment's Docker daemon being unreachable at the time.
   Approach: spin up Postgres 17 locally/in CI, run migrations 094/095, confirm the constraint
   trigger fires correctly on at least one non-default partition.
   Effort: small, but requires an environment this audit pass didn't have.

5. **Run a live ledger-balance reconciliation query.** (`03-data-integrity-findings.md` #2)
   Approach: sum debits/credits across every group's `journal_lines`, assert zero variance,
   against staging (or production, read-only) before the next posting-logic deploy.
   Effort: small (one query), but needs a data environment.

6. **Add a direct test for the registration flow.** (`05-code-quality-findings.md` #1)
   `register_group()` / `POST /api/v1/auth/register` currently only appears as a test-fixture
   helper for *other* tests, never as the subject under test — notable given this flow caused a
   real production incident before ([[project-kitabu-yetu-production-incidents]]).
   Effort: small-medium (one new integration test file, reusing the existing fixture helper as
   its own subject rather than just its setup).

7. **Follow-up grep: second pass for unmasked PII beyond the members-service fix.** (`02-security-findings.md` #3)
   Approach: `SELECT \*` / `RETURNING \*` across `lib/services` cross-referenced against tables
   with a `national_id`/`password_hash`/similar sensitive column, the same method that found the
   original members-service leak.
   Effort: small (a grep + spot-check pass), same shape as the fix already shipped this session.

8. **No formal down-migration/rollback runbook.** (`03-data-integrity-findings.md` #3)
   Mitigated in practice by defensive forward-migration discipline (rename-not-drop, backfill-
   then-constrain) — but no written runbook exists for a true emergency rollback.
   Approach: a short `docs/` runbook documenting the actual recovery pattern this repo already
   follows, not a new down-migration-per-migration convention (that would be a much larger,
   arguably unnecessary process change for a single-environment-per-run Supabase project).
   Effort: small (documentation only).

## Low

9. Trace the refresh-token rotation/reuse-detection path end-to-end. (`02-security-findings.md` #4)
10. Verify the 4 nullable `amount` columns are all intentional (1 of 4 already confirmed intentional — `welfare_requests.amount_approved`). (`03-data-integrity-findings.md` #4)
11. Run `EXPLAIN ANALYZE` against real data volume for the hottest list/report queries. (`04-performance-findings.md` #2)
12. Re-run a bundle-analyzer pass (`next build --analyze`). (`04-performance-findings.md` #3)
13. Cross-reference every mutating service function against the Nexus business-event-logging standard. (`05-code-quality-findings.md` #2)
14. Delete `lib/supabase/client.ts` + `lib/supabase/server.ts` (zero importers) and the three now-unused `NEXT_PUBLIC_SUPABASE_*`/`SUPABASE_SERVICE_ROLE_KEY` env-schema entries. (`01-inventory.md` §5)

---

## Deployment Readiness Gate (per the brief)

| Gate | Status |
|---|---|
| Zero Critical/High findings open in `02-security-findings.md` | ⚠️ **1 Critical open (needs a live-env check, not code). The 1 High item was retracted as a false positive during implementation research — zero real High findings remain.** |
| Cross-tenant isolation test suite passes | ✅ Passes — confirmed running as a required CI job, green on every commit this session |
| Ledger reconciliation check passes across all test/seed data | ⚠️ **Not run this pass** — no data environment available; the DB-level balance-triggers (item 4 above's subject) provide continuous enforcement, but a standalone reconciliation query wasn't executed |
| Environment variable audit is clean | ✅ No leaked secrets found; the one open item (`TENANT_DATABASE_URL` provisioning) is a "is this set to the right thing" question, not a leak |
| Rollback strategy documented for the current migration state | ⚠️ **Partial** — the repo's forward-defensive migration discipline is real and consistently followed, but no written runbook exists (item 8) |

**Bottom line**: nothing found in this pass indicates the platform is silently broken today. The
gate is not fully green because Critical #1 requires a live-environment check this audit had no
access to — not something to silently resolve mid-audit. (The one High item found alongside it
was itself retracted as a false positive before any fix was shipped — see above.) Recommend:
check `TENANT_DATABASE_URL` in production immediately (near-zero effort, resolves the single
biggest open question), then decide priority on the rest with that answer in hand.
