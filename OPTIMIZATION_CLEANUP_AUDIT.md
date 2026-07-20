# Kitabu Yetu — Node.js / Vercel Multi-Tenant SaaS Optimization & Cleanup Audit

**Date:** 2026-07-20
**Scope:** Whole-codebase audit — folder structure, dependencies, dead code, imports, components, API routes, middleware, database layer, multi-tenancy, security, authentication/authorization, error handling, logging, environment variables, caching, performance, frontend, state, types, testing, build/CI. Benchmark: preparing this platform for 100,000+ tenants.
**Method:** Source-grounded review of the actual codebase — every finding below cites a specific file and line, gathered via four parallel research passes (dependencies/dead-code/folders, API/auth/logging/env, database/tenant-isolation/caching, frontend/types/testing/build). Findings are labeled **CONFIRMED** (directly verified by reading the cited code) or **SUSPECTED** (a strong signal that wasn't fully traced to runtime, e.g. external Vercel Cron dashboard config not present in the repo). This pass did **not** run `npm audit`, check dependency version currency against upstream, or probe for CSRF/SSRF/prototype-pollution directly — those are flagged as explicit gaps rather than silently assumed clean.

---

## 1. Executive Summary

Kitabu Yetu's backend service layer (accounting, payments, M-Pesa, policy engine) is the product of an unusually long, deliberate hardening effort — evident in two-layer double-entry enforcement, maker-checker on every money-crossing-a-boundary path, a real Configuration Service, structured logging, and a Zod-validated env schema. Against that same maturity, this pass found a different class of problem: **the pieces don't reliably click together at the seams that matter for scale and trust** — the CI pipeline that gates every deploy never actually runs the test suite; the database role every request uses has `BYPASSRLS`, so the RLS policies audited in every prior session are decorative for the app's own traffic; one route (`workers/email`) has no authentication at all if a single env var is unset; and there is effectively no caching layer anywhere, with every dashboard read hitting Postgres directly.

None of this is exotic — every finding below has a concrete fix, most of them small. But several are the kind of gap that looks fine in a demo and fails exactly when it matters (under load, under attack, or the day someone forgets to set an env var).

| Score | /100 | Basis |
|---|---|---|
| **Overall code health** | **60** | Strong domain logic, weak seams (CI/test gate, caching, DB-role architecture) |
| Maintainability | 57 | 219 `any` usages, oversized files (3,121-line service, 988-line page), type/component duplication |
| Performance | 56 | Zero caching layer, one real request-path timeout risk, several job-loop scaling risks |
| Security | 63 | Good foundations (headers, logging, masking, most auth wrappers) undercut by 2 fail-open gaps and the BYPASSRLS architecture |
| Scalability | 54 | No caching, `DB_POOL_MAX=3`, unbounded driver queries in cron jobs, dual queue systems |
| Technical debt | 50 | Tests never run in CI is the single biggest number here — a safety net that doesn't catch anything |

---

## 2. Prioritized Findings

### Critical

1. **CI never runs the test suite.** `.github/workflows/ci.yml`'s Quality Gate runs `lint` → `typecheck` → `build` only. `package.json` defines `test`, `test:coverage`, and `test:ci` (`jest --ci --forceExit`), and 37 test files exist, but **no CI job invokes any of them.** The 50%-branch coverage threshold in `jest.config.ts` is enforced nowhere in the pipeline that gates production deploys. A regression that breaks accounting logic, posting templates, or auth would ship as long as it type-checks and builds.
2. **The application's Postgres connection role has `BYPASSRLS`.** Confirmed via `.env`/`.env.local` (`DATABASE_URL=postgresql://postgres...`) and in-repo documentation (`supabase/migrations/20260714020000_058_registry_rls_hardening.sql:9`: *"the application pool role (`postgres`) has BYPASSRLS... RLS on these tables exists solely to fence off the PostgREST roles"*). `lib/db/index.ts` uses one pool for `withDb`/`withTransaction`/`withAdminDb` alike — **every RLS policy in this codebase, `FORCE` or not, provides zero enforcement against the app's own traffic.** Tenant isolation today is enforced *entirely* by hand-written `WHERE group_id = $1` clauses in service code (which, per the DB-layer research pass, are in fact correctly applied everywhere sampled — but that's a code-review guarantee, not a database one). This reframes every RLS-related finding in this report and in prior sessions' audits: they matter for defense-in-depth and for the stated future direction (a non-BYPASSRLS tenant role), not for today's actual protection.
3. **`app/api/v1/workers/email/route.ts` has no authentication if `WORKER_SECRET` is unset.** The check is conditional (`if (workerSecret) { ... }`) rather than fail-closed like its sibling `workers/cron` — if that one env var is ever missing, anyone can POST to this route and trigger email/campaign queue processing.
4. **`app/api/v1/email/*` (9 routes) silently swallow unhandled errors.** Every one of these routes uses raw `getAuthContext(req)` with an `if (!auth) return ...` guard — but `getAuthContext` never returns null/undefined, it *throws*. None of the 9 files contain a `try {` block. Any auth failure, DB error, or malformed JSON in these routes bypasses the app's structured `handleError()` envelope entirely and surfaces as Next.js's default opaque error response.
5. **Zero component tests, zero API-route tests, zero tenant-isolation tests exist**, in a multi-tenant fintech app, despite `@testing-library/react` and `@testing-library/user-event` being installed as dependencies and never imported anywhere. All 37 test files cover `lib/services`/`lib/utils` only.

### High

6. **`launchCampaign` (`lib/services/campaign.service.ts:80-129`) runs a per-recipient sequential loop directly inside an HTTP request** (`app/api/v1/email/campaigns/route.ts`), not a background job — one `withAdminDb` INSERT plus one Redis `enqueue()` per recipient, uncapped. A campaign of a few thousand members is a serverless-timeout waiting to happen, and the codebase already has a job-queue table (`lib/jobs`) built for exactly this pattern.
7. **`app/api/v1/webhooks/whatsapp/route.ts` doesn't fail closed** when `WHATSAPP_APP_SECRET` is unset — it logs a warning and accepts the unsigned callback in every environment, including production. The two adjacent webhook handlers (Resend, SendGrid) correctly return 503 in this situation.
8. **No caching layer exists anywhere for hot read paths.** 150 of ~156 API routes are `force-dynamic`; a repo-wide search for Next.js caching primitives (`unstable_cache`, route-segment `revalidate`, `"use cache"`) turns up **one genuine hit in the entire app** (a static counties list). Every dashboard, report, and analytics view — for every tenant, on every request — hits Postgres directly.
9. **`lib/services/mpesa.service.ts` is 3,121 lines** — 2.5× the next-largest service file, and the single most-imported service (16 external references). It mixes STK push, B2C, B2B, reconciliation, and callback handling in one file.
10. **`app/(dashboard)/accounting/page.tsx` is 988 lines**, with 42 `: any`/`as any` usages, 10 hand-rolled `<table>` blocks, and 4 nested sub-components (`PostingTemplatesCard`, `LoanTermsCard`, `SavingsPolicyCard`, `FineScheduleCard`) defined inline rather than extracted. `sms/page.tsx` (871 lines) and `organization/page.tsx` (785 lines) follow the same pattern.
11. **`LOGIN_LOCKOUT_MINUTES` default is inconsistent**: hardcoded to `'15'` independently in 3 route files (`auth/login`, `auth/admin/login`, `auth/admin/login/verify`), while the central Zod-validated `lib/env.ts` schema defaults the same variable to `30`. If the env var is ever unset, the enforced lockout silently disagrees with the validated/documented value.
12. **Two parallel queue systems** exist and overlap: a Redis sorted-set queue (`lib/queue`, used by campaign/SMS/email sends) and a Postgres-table job queue with `FOR UPDATE SKIP LOCKED` (`lib/jobs`, used by the cron dispatcher). No clear rule for which new work should use which.
13. **The central `lib/env.ts` Zod schema is bypassed by most of the codebase.** Only 8 files import the validated `env` object; 104 raw `process.env.*` reads exist elsewhere (63 unique variable names), and several M-Pesa/SMS credentials (`MPESA_CONSUMER_KEY!`, `TEXTSMS_API_KEY!`, etc.) are read via non-null assertion directly, bypassing validation entirely — if `SKIP_ENV_VALIDATION` is ever set at runtime rather than just build time, these would be silently `undefined`.
14. **Production CSP allows `script-src 'unsafe-inline'`** — undercuts the XSS protection the rest of the (otherwise thorough) CSP configuration provides.
15. **`app/api/health/deep/route.ts`'s secret check is not timing-safe and accepts the secret via query string** — unlike every other secret comparison in the codebase (cron, workers/cron, webhooks), which use `crypto.timingSafeEqual` over SHA-256 hashes. A query-string secret can also leak into access logs/referrers.
16. **219 `: any`/`as any` usages** (143 + 76), 97% concentrated in `app/` page files (`accounting/page.tsx` alone has 42). `tsconfig.json` has `strict: true`, but `eslint.config.mjs` extends only `eslint-config-next/core-web-vitals`, not the TypeScript-aware config — `@typescript-eslint/no-explicit-any` is not enforced.
17. **`Paged<T>` is reimplemented identically in 7 separate page files** instead of importing `PaginatedResult<T>` from `types/db.types.ts`. `db.types.ts` defines 19 domain interfaces but is imported by only 7 files in the entire app; 109 page-local `interface`/`type` declarations exist instead, many plausibly overlapping with the shared types.
18. **The `(enterprise)` portal remains 100% mock-data-backed** — `app/(enterprise)/_data.ts`, whose own header comment says *"⚠️ No enterprise/portfolio API yet"*, is still the sole data source for all 3 enterprise pages. Unchanged from a prior audit.
19. **Shared component adoption is inconsistent**: `PaginatedTable` is used by only 8 of ~33 tabular pages, `PageHeader` by 4 of 37, `StatCard` by 5 of 37. Most large pages hand-roll table/header markup the shared components already solve — `accounting/page.tsx` alone has 10 hand-rolled tables.

### Medium

20. `organization_disbursements.group_journal_entry_id` is still a bare UUID with no FK constraint (unchanged from a prior audit).
21. SQL string-interpolation anti-pattern in `lib/services/delivery-tracking.service.ts:172` (`` `AND group_id = '${groupId}'` `` instead of a parameter) — not currently exploitable via its one caller (a session-derived UUID), but a latent injection pattern in a function that already bypasses tenant context via `withAdminDb`.
22. `app/api/cron/route.ts` and `app/api/v1/workers/cron/route.ts` leak raw `err.message` into their JSON response — both contradict their own header comments about returning generic error messages. `app/api/v1/auth/register/route.ts` similarly leaks internal pipeline stage names (`REG_FAIL_${stage}`) on failure.
23. ~40 tables (`mpesa_*`, email/SMS platform tables, governance tables, `feature_flags`, `job_queue`, etc.) have `ENABLE ROW LEVEL SECURITY` but not `FORCE`. Moot for the current `BYPASSRLS` role (see Critical #2), but a real gap the moment a least-privilege DB role is introduced — which the team's own migration comments describe as the intended direction.
24. Cron/job loops with unbounded driver queries and sequential per-row fan-out (`mpesa-reports.service.ts`, `statement-email.service.ts`, `billing-email.service.ts`) — a scaling/timeout risk as tenant count grows, not a correctness bug today.
25. `notifyMany`'s own design comment says "~50 messages" sequential capacity, but its actual callers (`handleLoanDueAlerts`, `handleContributionReminders`) process up to 500–1000 rows each — a real capacity mismatch and timeout risk on a busy day.
26. 4 pages (`admin/analytics`, `admin/billing-admin`, `dashboard/analytics`, `credit-scores/[memberId]`) import `recharts` directly at top level instead of via the team's own lazy-loading wrapper (`components/shared/charts.tsx`), pulling ~360KB into first-load bundle unnecessarily.
27. `withTransaction` (`lib/db/index.ts`) is a byte-for-byte alias of `withDb` despite a docstring implying a distinct guarantee — confusing, not incorrect.
28. Duplicated admin/dashboard shell components: `components/admin/{sidebar,topbar,command-palette}.tsx` vs. `components/layout/{sidebar,topbar,command-palette}.tsx` — ~1,070 lines across 6 files for structurally the same nav-shell pattern per portal.
29. 4 zero-usage dependencies (`@supabase/supabase-js`, `@testing-library/react`, `@testing-library/user-event`, `jest-environment-jsdom`), 2 dead service files (`lib/services/notification-rules.service.ts`, `lib/services/pdf.service.ts` — explicitly superseded by the live `@react-pdf/renderer` pipeline), 1 orphaned script (`scripts/generate-icons.mjs`, superseded by `.ts`).
30. At least 9 API routes with no frontend/hook caller anywhere in the repo: 4 `admin/policies*` routes, `mpesa/stk-query`, `mpesa/bill-manager`, `mpesa/disbursements[/[id]]`, `organization/disbursements/[id]` (approve/reject), `payment-requests[/[id]]`. **`workers/email` itself has zero references anywhere in-repo** (no docs, no CI, no `vercel.json` cron config) — if its only trigger is an out-of-repo Vercel Cron config, that's unverifiable from here and worth confirming directly, since the email/campaign queue may never drain otherwise.
31. Duplicate imports of the same module in 7+ files (`report-email.service.ts` imports from `./email.service` on two separate lines, etc.) — mergeable; the `import/no-duplicates` ESLint rule isn't enabled.
32. 11 audit/report markdown files at repo root (324KB total) — prior point-in-time deliverables, not living docs; candidate for a `docs/audits/` subfolder.
33. No per-identifier rate limiting on `auth/register` beyond the blanket IP limit — unlike login, which has proper lockout.

### Low

34. `components/branding/BrandLogo.tsx` is the sole PascalCase filename in an otherwise all-kebab-case codebase.
35. Two overlapping HTTP clients (`axios`, used in exactly 2 server-side files, vs. native `fetch` everywhere else) — low-priority consolidation candidate.
36. Two JWT libraries (`jsonwebtoken` for Node routes, `jose` for the Edge-runtime `proxy.ts`) — this split is architecturally justified (Edge can't use Node's `crypto`), not debt, but worth documenting explicitly so it isn't "cleaned up" incorrectly later.
37. `BCRYPT_ROUNDS` independently re-parsed with the same fallback in 3 files, and absent from the central env schema entirely.
38. Several M-Pesa env vars used in code but absent from `lib/env.ts`'s schema (`MPESA_B2C_SHORTCODE`, `MPESA_ALLOWED_IPS`, `MPESA_CALLBACK_TOKEN`, others).
39. `admin.service.ts` dashboard functions call `Promise.all([...])` over multiple queries sharing one `PoolClient` — implies parallelism that `node-postgres` actually serializes on a single connection.
40. Jest's coverage threshold is scoped only to `lib/**/*.ts` — even if tests ran in CI (Critical #1), coverage numbers would never reflect `app/`, `components/`, or `hooks/`.

---

## 3. Dependency Cleanup Report

| Package | Action | Evidence |
|---|---|---|
| `@supabase/supabase-js` | **Remove** | Zero direct imports; only `@supabase/ssr` is used, which pulls this in transitively anyway |
| `@testing-library/react` | **Remove** (or start using it) | Zero imports anywhere; no component tests exist |
| `@testing-library/user-event` | **Remove** (or start using it) | Zero imports anywhere |
| `jest-environment-jsdom` | **Remove** (or start using it) | `testEnvironment: 'node'` is set globally; no test overrides to jsdom |
| `axios` | **Consider replacing with `fetch`** | Only 2 server-side call sites (`daraja.service.ts`, `textsms.service.ts`) |
| `jsonwebtoken` + `@types/jsonwebtoken` | **Consider migrating to `jose`** | Would let the whole app share one JWT library; currently split only because `proxy.ts` runs on the Edge runtime |

No deprecated packages, no duplicate icon libraries, no duplicate date libraries, and no `lodash`/`moment`/`xlsx` bloat were found. **Not verified this pass:** dependency version currency against upstream (no `npm outdated`/`npm audit` was run) — recommend running both as a follow-up.

---

## 4. Multi-Tenant Isolation Verification Report

**Headline:** the database role the application connects as (`postgres`) has `BYPASSRLS`. This is documented in the repo itself (migration 058's own comment). Practically:

- Every `ENABLE`/`FORCE ROW LEVEL SECURITY` statement across every migration this session and prior sessions have reviewed is **inert for the app's actual traffic**. It still matters for defense-in-depth and for Supabase's PostgREST auto-API (which this app doesn't appear to use as a primary data path), and the team's own comments confirm this is a known, deliberate tradeoff pending a future non-`BYPASSRLS` tenant role.
- **Tenant isolation today is enforced entirely by application code** — specifically, hand-written `WHERE group_id = $1` / `WHERE organization_id = $1` clauses in `lib/services/*`. The database-layer research pass sampled 40+ `withAdminDb` call sites across the highest-traffic services and found **no accidentally-unscoped per-tenant query** — every site either carries explicit tenant scoping, resolves a single row by unique external ID (webhook path), or is intentionally platform-wide (admin dashboards, cron reconciliation with `groupId=null` used and documented as deliberate).
- **One real latent gap**: `delivery-tracking.service.ts:172`'s SQL string interpolation (Medium #21) is the only case where tenant-scoping logic isn't parameterized — not exploitable via its current single caller, but fragile.
- **Correction to a prior audit finding**: `payment_accounts`'s RLS policy previously had a `group_id IS NULL` bypass branch (flagged in an earlier session). **This was already fixed** in `20260714020000_058_registry_rls_hardening.sql:45-68`, which dropped and recreated the policy without that branch, and did the same for `payment_events`/`payment_reallocations`. That finding should be considered resolved — though moot either way given the BYPASSRLS finding above.
- Background jobs (birthday emails, statements, reminders, loan-due alerts) were checked specifically for cross-tenant leakage in their fan-out loops: **none found** — every row carries its own `group_id`/`member_id` through to the notification/audit layer correctly. The risk in these jobs is unbounded-driver-query/timeout (Medium #24-25), not tenant leakage.

**Recommendation**: treat the `BYPASSRLS` posture as a conscious architectural decision that needs to be written down, not left as an implicit fact discoverable only by reading a migration comment. Either (a) commit to it — and if so, stop investing further engineering time in `FORCE ROW LEVEL SECURITY` migrations that provide no real protection today, redirecting that effort to code-review discipline and the API-route tenant-isolation tests this report recommends in the roadmap — or (b) begin the migration to a genuinely least-privileged, non-`BYPASSRLS` application role, which would make every RLS policy already written start actually protecting the app for the first time.

---

## 5. Performance Optimization Plan

| Area | Finding | Estimated impact of fixing |
|---|---|---|
| Caching | Zero cache layer; every dashboard/report read hits Postgres | High — a Redis-backed cache with a short TTL (30-120s) on the heaviest admin/org dashboard aggregates would cut DB load on the most-repeated queries substantially with minimal staleness risk |
| Request-path fan-out | `launchCampaign` loops per-recipient inside an HTTP request | High — moving this to the existing job queue removes a concrete timeout failure mode entirely, not just a slowdown |
| Job-loop scaling | `mpesa-reports`/`statement-email`/`billing-email` unbounded driver queries + sequential per-row work | Medium — bounding + batching (or `Promise.all` in small batches) keeps these jobs viable as tenant count grows; today's risk is proportional to current scale, not yet acute |
| Connection pool | `DB_POOL_MAX=3` per warm instance | Unquantified without production traffic data — flagged as a scaling variable to monitor, not a confirmed bottleneck (SUSPECTED) |
| Bundle size | `recharts` bypassing the lazy-load wrapper in 4 pages | Low-medium — moving these 4 imports behind the existing `next/dynamic` wrapper is a same-day fix with an immediate, measurable first-load JS reduction on those 4 pages |
| Service file size | `mpesa.service.ts` at 3,121 lines | Indirect — doesn't affect runtime performance, but slows every future change to M-Pesa logic and increases the blast radius of any edit |

---

## 6. Security Hardening Checklist (OWASP-mapped)

| OWASP category | Status | Notes |
|---|---|---|
| A01 Broken Access Control | **Gap found** | `workers/email` conditional auth (Critical #3); otherwise 145/164 routes correctly wrapped, `proxy.ts` correctly strips inbound `x-*` claim headers before stamping its own |
| A02 Cryptographic Failures | **Mostly clean, one gap** | Timing-safe comparisons used almost everywhere secrets are checked; `health/deep` is the exception (High #15) |
| A03 Injection | **Mostly clean, one latent gap** | Parameterized queries throughout; one SQL string-interpolation site not currently exploitable (Medium #21). XSS/CSRF/SSRF were not independently probed this pass — flagged as not verified, not assumed clean |
| A04 Insecure Design | **One architectural flag** | The `BYPASSRLS` posture (Critical #2) needs an explicit decision, not silent acceptance; dual queue systems (High #12) is a design-clarity gap |
| A05 Security Misconfiguration | **Gaps found** | Production CSP allows `unsafe-inline` scripts (High #14); `LOGIN_LOCKOUT_MINUTES` default mismatch (High #11); env schema bypassed by most of the codebase (High #13) |
| A06 Vulnerable/Outdated Components | **Not verified this pass** | No `npm audit`/`npm outdated` was run — recommend as an immediate follow-up |
| A07 Auth Failures | **Mostly strong, two gaps** | Bcrypt, JWT audience separation, per-identifier login lockout, MFA lockout reuse all correctly implemented; the two fail-open webhook/worker gaps (Critical #3, High #7) are the exceptions |
| A08 Software/Data Integrity | **Clean** | No unsigned-update or deserialization risk patterns found |
| A09 Logging/Monitoring Failures | **Mostly strong, minor leaks** | Structured JSON logging in production, PII-masking utility used consistently, no secrets found in logs; two routes leak `err.message` to clients (Medium #22) |
| A10 SSRF | **Not verified this pass** | Not independently probed — flagged as not verified |

---

## 7. Refactoring Roadmap

**Quick wins (under 1 day each):**
- Make `workers/email`'s `WORKER_SECRET` check fail-closed, matching `workers/cron` (Critical #3)
- Make the WhatsApp webhook fail-closed in production when `WHATSAPP_APP_SECRET` is unset (High #7)
- Reconcile `LOGIN_LOCKOUT_MINUTES`'s default to one value, sourced from `lib/env.ts` in all 3 route files instead of re-parsed locally (High #11)
- Remove `err.message`/stage-name leakage from `cron`, `workers/cron`, and `register` routes (Medium #22)
- Fix `health/deep`'s secret check to use `crypto.timingSafeEqual` and stop accepting it via query string (High #15)
- Delete `pdf.service.ts`, `notification-rules.service.ts`, `generate-icons.mjs`, and the 4 zero-usage dependencies (Medium #29)
- Move the 4 direct `recharts` imports behind the existing lazy-load wrapper (Medium #26)
- Merge the 7+ duplicate-import files; enable `import/no-duplicates` in ESLint (Medium #31)
- Move the 11 root-level audit markdown files into `docs/audits/` (Medium #32)
- Confirm whether `workers/email` has a real trigger (Vercel Cron dashboard) or is genuinely dead (Medium #30)

**Medium-term (1-2 weeks):**
- Wire `test:ci` into the GitHub Actions Quality Gate as a required, blocking step (Critical #1) — this is the single highest-leverage change in this entire report
- Add an API-route test suite starting with auth/authorization and tenant-isolation coverage for the highest-risk routes (payments, disbursements, admin) (Critical #5)
- Refactor the `app/api/v1/email/*` module onto the standard `withAuth`/`ok`/`handleError` pattern with real Zod validation (Critical #4)
- Move `launchCampaign`'s per-recipient loop into the existing `lib/jobs` queue instead of running inline in the request (High #6)
- Split `mpesa.service.ts` into cohesive sub-modules by concern (STK / B2C / B2B / reconciliation / callbacks) (High #9)
- Introduce a Redis-backed cache for the heaviest dashboard/report reads (High #8)
- Consolidate `Paged<T>`/`PaginatedResult<T>` and raise `db.types.ts` adoption across the 7 duplicate-declaration files (High #17)
- Write down the `BYPASSRLS` decision explicitly (§4) as a recorded architectural choice, not an implicit fact

**Long-term (architectural):**
- Introduce server-driven data fetching (RSC) for read-heavy dashboard pages to reduce client JS and unlock real route-level caching
- Consolidate the two queue systems (`lib/queue` + `lib/jobs`) into one
- Build a real API for the `(enterprise)` portal to replace `_data.ts` mocks
- Systematic component-library adoption sweep (`PaginatedTable`/`PageHeader`/`StatCard`) across all pages, starting with the largest monoliths (`accounting`, `sms`, `organization` page files)
- Ratchet down `any` usage; enable `@typescript-eslint/no-explicit-any` as a warn-then-error lint rule
- If the `BYPASSRLS` decision (§4) lands on "harden," begin the migration to a genuinely least-privileged application DB role so the RLS policies already written start providing real protection

---

## 8. What This Audit Did Not Cover

For transparency: this pass did not run `npm audit` or check dependency versions against upstream releases; did not independently probe for XSS, CSRF, SSRF, or prototype-pollution beyond what surfaced incidentally; did not load-test the connection pool or caching-absence claims against real traffic; and did not verify whether `workers/email`'s trigger exists outside the repository (e.g., in Vercel's Cron dashboard). These are named explicitly rather than silently assumed clean, and are recommended as immediate follow-ups alongside the roadmap above.
