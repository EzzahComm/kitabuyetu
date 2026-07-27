# 04 — Performance & Scalability Findings

**Date:** 2026-07-27. `OPTIMIZATION_CLEANUP_AUDIT.md` already covered most of this ground (Redis caching for heavy reads, `mpesa.service.ts` module split, `no-explicit-any` sweep incidentally hardening several list endpoints — see [[project-kitabu-yetu-audits]]). This phase re-verifies current state and adds what wasn't that audit's focus.

## N+1 query patterns

- Did not find a classic N+1 (one query to list rows, then one query per row in a loop) in the service layer sampled — the pattern used throughout `lib/services` is a single query with `JOIN`s pulling in related display fields (e.g. `organizationService.listGroupSummaries()`'s one query joining `groups`/`group_members`/`contributions`/`loans`/`subscriptions` with aggregates, rather than fetching groups then querying each group's stats separately). This is a genuinely good, consistent pattern across the ~66 service files, not spot luck.
- **New finding, freshly verified this session while wiring the enterprise portal (not from the prior audit)**: `organizationService.listGroupSummaries()` (`lib/services/organization.service.ts`) has **no `LIMIT`/pagination at all** — it returns every group linked to an organization in one query. For a small federation this is harmless; for a large one (the B2B audit's own mock data imagined federations with 400+ groups) this becomes an unbounded result set on every dashboard load. **Medium** — recommend adding pagination (mirroring the `page`/`limit` pattern every other list service already uses) before an organization with a large group count is onboarded. Not fixed in this pass since it's a shape change to an endpoint two pages now depend on (`(dashboard)/organization` and the newly-wired `(enterprise)/enterprise/branches`) — flagged per the brief's own Phase 6 rule rather than changed silently.
- `fiscal-periods.service.ts` and `contribution-splits.service.ts` also have no `LIMIT`, but both are naturally small per-group lists (fiscal periods closed = at most a handful ever; contribution split rules = a handful of active rules) — **Low**, not flagging as a real risk.

## Indexes

- **39** explicit `CREATE INDEX` statements reference `group_id` directly, plus every column carrying a `UNIQUE` constraint (M-Pesa receipt/checkout IDs, `national_id`, membership numbers) gets an implicit index from Postgres automatically — a naive grep for "indexes on national_id" undercounts this for exactly that reason, worth stating explicitly so this doesn't get miscounted as a gap in a future pass.
- Did not run `EXPLAIN ANALYZE` against live/staging data this pass (no data environment available in this session) — schema-level index presence is confirmed, but whether the *query planner actually uses* those indexes for the app's real query shapes (as opposed to falling back to a sequential scan due to a missing composite index or a function-wrapped predicate) can only be confirmed against real data volume. **Recommend** this as a staging-environment follow-up rather than treating schema inspection as sufficient proof of query performance.

## Pagination / unbounded queries

- This session's own Phase D table-migration work (see [[project-kitabu-yetu-audits]]) found and fixed a real, concrete instance of this exact risk: the accounting Journal Entries tab, and the Dividends/Credit Scores/WhatsApp message-log pages, all fetched a **fixed first page** (`limit=20`–`100`) with **no pagination controls in the UI** — rows beyond the first fetch were structurally unreachable, not just slow. Fixed this session (commits `e93a696`, `43d828f`) by wiring real `page`/`onPageChange` state through `PaginatedTable`.
- The `organization.service.ts` finding above is the same underlying failure mode (missing `LIMIT`) but with the query itself unbounded rather than merely stuck on page 1 — worth tracking as the same class of bug, different severity.

## Real-time subscriptions

- ✅ **N/A** — the brief's concern (broad-table Supabase Realtime listens leaking load/data across tenants) doesn't apply. Confirmed in Phase 1: zero usages of `.channel(`/Realtime anywhere in the codebase, and the two files that would use Supabase's client SDK (`lib/supabase/client.ts`/`server.ts`) have no importers. All "live" UI (M-Pesa polling, job status) uses TanStack Query polling (`refetchInterval`) against the REST API, not a push-based subscription — a different tradeoff (poll cost vs. push complexity) but not the specific risk the brief describes.

## Bundle size / client dependencies

- ✅ Confirmed the `recharts`-behind-`next/dynamic` lazy-load wrapper (`components/shared/charts.tsx` → `charts-impl.tsx`) from the prior audit's Medium item is still in place and was used directly by this session's own enterprise-portal work (`TrendChart`/`DonutChart`/`Sparkline` imports) — not a regression.
- Did not re-run a full bundle-analyzer pass this session (no `next build --analyze` executed) — recommend as a periodic check rather than a one-time audit item, since bundle size drifts with every new dependency added.

## Caching / re-fetching

- ✅ **6 usages of the Redis-backed `cached()` helper** (`lib/redis`) confirmed across the heaviest report-style reads (`organizationFinanceService.getDashboard()`, `programBudgetReport()`, `donorSpendReport()` all confirmed directly in this session's own reading of `organization-finance.service.ts`) — this is the prior audit's High #8 fix, still in place, not regressed.
- **154 of 167 API routes still set `export const dynamic = 'force-dynamic'`** (essentially unchanged from the prior audit's count of ~150 — the small increase tracks new routes added since, not regression). This remains a deliberate, documented tradeoff for a multi-tenant app where nearly every response is tenant-specific and must never be cached at the CDN/edge layer by accident — not re-litigating it as a fresh finding, since the one genuinely cacheable, tenant-independent endpoint found in this pass (`GET /api/v1/jurisdictions/counties` — Kenya's county list, truly global reference data) already **does** set an explicit `Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800` header, confirmed by direct reading this session. That's the correct pattern already applied where it actually matters; force-dynamic-by-default elsewhere is the safe, not lazy, choice for tenant data.
- No evidence found of redundant client-side re-fetching (missing `staleTime`) beyond what's normal — TanStack Query is used consistently with explicit `staleTime`/`enabled` guards on the hooks sampled this session (`use-billing.ts`, `use-organization`-adjacent inline queries, the enterprise portal's own new hooks).

## Offline-first / conflict resolution

- ✅ **N/A** — no offline-first sync layer exists in this codebase (no service worker, no local-first storage/sync engine found). The brief's concern doesn't apply; not a gap since offline-first was never a stated requirement anywhere in the project's audit history.

## Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Medium | `organizationService.listGroupSummaries()` has no pagination — unbounded for large federations | **New, open — needs a shape change to two dependent pages, flagged not fixed** |
| 2 | Low | No live `EXPLAIN ANALYZE` run against real data volume this pass | **Recommend as a staging follow-up** |
| 3 | Low | No fresh bundle-analyzer run this session | **Recommend as a periodic check** |
| — | — | N+1 patterns (none found), caching layer, force-dynamic rationale, lazy chart loading, real-time/offline (both N/A) | **No finding — verified** |
