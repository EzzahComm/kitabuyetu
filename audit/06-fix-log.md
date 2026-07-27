# 06 — Fix Log

Per the brief's own phase ordering (Inventory → Security → Data Integrity → Performance → Code
Quality → **Remediation**), this pass was scoped to **findings only** — no fixes were applied
during Phases 1-5. This file is the ledger for fixes as they're actually applied, starting below.

**2026-07-27 note**: the first remediation attempted (07's item #2, RLS on the mpesa_b2c/b2b
tables) turned out to be a false positive — caught during implementation research, before any
migration was written. See `02-security-findings.md` §2.2 and `07-remediation-backlog.md` for the
correction. No entry below for it since nothing was actually shipped.

**Rules for entries in this file going forward** (per the brief's Phase 6):
1. One concern per commit — security, performance, and refactor fixes ship separately.
2. Any RLS change gets a cross-tenant negative test before merge, not just SQL review.
3. No destructive migration without a rollback path (see `03-data-integrity-findings.md` on this repo's actual — forward-defensive, not down-migration-file — reversibility convention).
4. Any financial-logic change gets a before/after ledger-reconciliation diff.
5. Every applied fix gets logged here: what changed, why, which finding it resolves, how it was verified (tsc/eslint/jest/CI status, and for money-path changes, the reconciliation diff).

| Date | Commit | Finding # (from which doc) | What changed | Verification |
|---|---|---|---|---|
| 2026-07-27 | _(pending push)_ | `07-remediation-backlog.md` #3 (`04-performance-findings.md` #1) | `organizationService.listGroupSummaries()` was fully unbounded (no LIMIT at all). Added `page`/`limit` params (default 200, capped at 500) and a real `COUNT` query, returning the canonical `PaginatedResult<T>` shape instead of a bare array. Updated the 3 consumers (`(dashboard)/organization`, `(enterprise)/enterprise`, `(enterprise)/enterprise/branches`) to read `.items` — all 3 wanted "everything for client-side search/sort," not a pager UI, so the default limit preserves current behavior at realistic org sizes while capping true unboundedness. Also fixed a latent bug found while making this change: all 3 call sites passed `organizationApi.groups` as a bare `queryFn` reference — harmless before this fix (it took no params), but would have silently passed TanStack Query's `QueryFunctionContext` as the new `params` argument once the function gained one; wrapped as `() => organizationApi.groups()` at all 3 sites. | `tsc --noEmit` clean, `npm run lint` zero new errors (74 pre-existing warnings, unchanged), new `__tests__/unit/services/organization-groups.test.ts` (4 cases: default page/limit, page-2 offset math, limit cap at 500, non-positive page clamped to 1), full suite 329/329 passing. |
| 2026-07-27 | _(pending push)_ | `07-remediation-backlog.md` #7 (`02-security-findings.md` #3) | Follow-up `SELECT \*`/`RETURNING \*` PII grep across `lib/services` + `app/api` against every table with a sensitive column. Found `GET /api/v1/members/[id]/next-of-kin` returned unmasked `national_id`/`phone`/`email`/`address` to any authenticated group member with no role check — inconsistent with `applyMemberMask` restricting the same fields on the member's own record to admin-ish roles. Presented the fork to the user (mask-for-everyone vs. restrict-to-admins vs. leave-as-intentional) rather than picking silently, since broad read access could have been a deliberate emergency-contact-lookup design choice; user chose to restrict. Added `ROLES.canManageMembers` gate to the GET handler, matching the existing POST/PATCH/DELETE gate on the same route. No other gap found — `person`/`member_mfa_secrets`/`refresh_tokens` have zero raw-star queries, and the login/refresh/admin-login routes build response bodies field-by-field with no secret ever spread into JSON. | `tsc --noEmit` clean, `eslint` on the changed file clean, full suite 329/329 passing (no test previously covered this route; none broken). |
