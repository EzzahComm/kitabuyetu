# Codebase Cleanup, UI/UX Simplification & RBAC — Proposal vs. Current State Audit

**Date**: 2026-08-02
**Scope**: Gap analysis between a large pasted "Simple First" cleanup/redesign/RBAC-rewrite prompt and what actually exists in the codebase, delivered via 4 parallel research passes (navigation structure, RBAC/permission model, verified dead-code inventory, dashboard/design-system state) before any code was touched.
**Method**: Source-grounded. Every dead-code claim in this report was checked by grepping for real usage repo-wide, not sampled by eye — this codebase's own audit history has twice produced false-positive "unused" findings (an `EmptyState` believed unused, an RLS policy believed missing), so nothing here is reported as a finding without a passing/failing grep to back it.

---

## 1. Executive summary

**The headline finding: most of this proposal describes work that's already done, or infrastructure that's already built but sitting dead.** This changes the shape of the response — rather than a large destructive cleanup + ground-up RBAC rewrite, the highest-leverage work here is *activation* of things that already exist, plus a handful of genuinely real, well-scoped gaps.

| Proposal section | Reality |
|---|---|
| §1 Codebase cleanup (remove unused everything) | **Mostly moot.** 20 sampled "legacy-looking" files: 0 verified unused. Sampled dependencies: 0 verified unused. Commented-out code: 0 verified. `tsc --noEmit`: 0 errors. `lint`: 0 errors, 67 warnings (all cheap `no-unused-vars`). Real gap found instead: ~15 env vars bypass the validated schema. |
| §2 Navigation ("current nav is a flat 21-item list") | **Inaccurate as stated.** Current nav is already grouped into 4-5 titled sections (untitled/Money/Insights/Engage, +Ecosystem for org coordinators) — not flat. No "More"/overflow component exists though; the proposed regrouping is a legitimate, buildable simplification. |
| §3-4 Dashboard + Quick Actions | **Partially exists.** Dashboard is already a curated 3-zone layout (task alerts, 4 stat cards, recent contributions), not cluttered. 3 of 8 proposed stats already computed elsewhere but unsurfaced; 1 (Upcoming Loan Repayments) needs genuinely new backend aggregation. Quick Actions exists today only in the member app, not the officer dashboard. |
| §5 Design system | **Substantially already in place.** Documented token system (`DESIGN_SYSTEM.md`), decent shared-component adoption (PageHeader 60/83 pages, StatCard 39, StatusPill 35, PaginatedTable 23). |
| §7 Performance | **Partially already in place.** Chart lazy-loading already consistent (5/5 recharts consumers behind `next/dynamic`). Table virtualization genuinely doesn't exist — real gap, but low-value given server-side pagination is already the norm. |
| §10 RBAC redesign | **The single biggest surprise.** The proposed 4 roles (chairperson/treasurer/secretary/member) ARE the current, live roles — not a redesign target. Enforcement is already centralized (not scattered). A `permissions text[]` column already exists on the `roles` table, **pre-seeded with permission strings in exactly the proposed style** (`members.view`, `loans.approve`, `treasury.manage`, etc.) — but it is never read by any authorization check anywhere in the app. Subscription-aware feature gating (`min_plan`) is also already built and working. |

**What this means**: the real work here isn't "redesign from scratch," it's narrower and lower-risk than the prompt implies in most sections — except RBAC activation, which is genuinely valuable but touches authorization on every route in the app and needs to be done carefully, not as part of a sweeping rewrite.

---

## 2. Codebase cleanup (§1) — grounded findings

Sampled ~20 legacy-looking candidates (parallel `command-palette.tsx` files, duplicate-looking `sidebar.tsx`/`topbar.tsx` pairs, `charts.tsx` vs `charts-impl.tsx`, several services/hooks) and a dozen dependencies. Every single one resolved to real, active usage on a repo-wide grep:

- The "duplicate" sidebars aren't duplicates — `components/admin/*` backs `(admin)`, `components/layout/*` backs `(dashboard)`, two genuinely different portals.
- `charts.tsx` is a confirmed intentional `next/dynamic` lazy-load wrapper around `charts-impl.tsx`, not leftover duplication.
- All sampled "one-off" services (`mpesa-unrouted.service.ts`, `outbox.service.ts`, `reminder.service.ts`, etc.) are dispatched through `lib/jobs/handlers.ts` or the `mpesa.service.ts` barrel.
- Dependencies like `axios`, `csv-parse`, `jose`, `jsonwebtoken` all resolve to exact real import sites.
- Zero commented-out code blocks found (grepped for disabled-code patterns, not doc comments) — the 8 hits that matched were all prose.

**What's real:**
- **67 ESLint warnings**, all `@typescript-eslint/no-unused-vars` — genuinely unused imports/locals across ~10 files (`import.service.ts`'s unused CSV column types, `topbar.tsx`'s unused `Button` import, `welfare.service.ts`'s unused `ForbiddenError`, etc.). Cheap, safe, zero-risk to fix.
- **~15 environment variables read via raw `process.env` instead of the validated `lib/env.ts` schema** — `BCRYPT_ROUNDS`, the M-Pesa credential/cert vars, all the SMTP/SES/Mailgun email adapter vars, `REDIS_TOKEN`, `NEXT_PUBLIC_MPESA_PAYBILL`, others. This is a real gap: `lib/env.ts` exists specifically to fail-fast on missing/malformed config at boot, and these vars currently bypass that safety net.

**Not real / not worth doing**: a sweeping "remove all unused components/pages/routes/APIs/dependencies" pass. There's nothing to remove that this session could verify — attempting it anyway risks deleting something a narrower grep missed (this exact codebase's audit history has hit that false-positive twice already).

---

## 3. Navigation (§2) — grounded findings

The proposal's "current navigation" list presents 21 items as one flat menu. The actual file (`components/layout/sidebar.tsx`) already groups them into 4 sections plus a 5th conditional one:

- *(untitled, top)*: Dashboard, Contributions, Loans, M-Pesa, Members
- **Money**: Welfare, Shares, Dividends, Treasury, Accounting, Billing
- **Insights**: Analytics, Credit scores, Investments, Reports
- **Engage**: Meetings, SMS, WhatsApp, Email, Data import
- **Ecosystem** *(organization_coordinator only)*: Funding Portal

"Money" and "Insights" in the proposal's list are actually already-existing section *headers*, not flat peer nav items — the proposal mis-describes them as items alongside Dashboard/Loans/etc.

**What's real to build**: no "More"/overflow menu component exists anywhere in the design system today (`PortalSidebar` supports flat titled sections + optional collapse-to-icons + optional search, nothing else). The proposed `Dashboard / Members / Contributions / Loans / Finance / Reports / More` structure is a legitimate simplification — 4-5 sections down to a cleaner 7-item primary rail with one overflow menu — but it requires building that overflow primitive from scratch, then re-slotting all 20 existing items into the new grouping. This is real, scoped, low-risk UI work (no backend, no auth changes).

---

## 4. Dashboard & Quick Actions (§3-4) — grounded findings

Current `app/(dashboard)/dashboard/page.tsx` is already a curated 3-zone layout: a "Needs you now" task-alert card (unrouted M-Pesa, pending loan approvals, welfare requests, non-contributing members), a 4-stat-card grid (Cash/M-Pesa, Welfare fund, External funding, Members), and a Recent Contributions list. Not cluttered.

Against the proposal's 8 target stats:

| Target stat | Status |
|---|---|
| Available Cash | Already on dashboard |
| Welfare Balance | Already on dashboard |
| Total Savings | Computed in `analytics/page.tsx`'s `ExecutiveSummary`, not surfaced on dashboard — **wiring work, not new computation** |
| Outstanding Loans | Same — computed in analytics, not on dashboard — **wiring work** |
| This Month's Contributions | `analytics/page.tsx` has `periodAmount`; needs a month-scoped variant — **small new work** |
| Recent Transactions | Exists narrowly (contributions only) — **extending to all transaction types is new work** |
| Upcoming Loan Repayments | **Genuinely doesn't exist.** Only a per-loan installment schedule exists; no "next N repayments due across all loans" aggregation — real new backend query needed |
| Quick Actions | **Doesn't exist for officers.** A `QuickActions` component exists but only in the member self-service app (`components/member/quick-actions.tsx`) — the 6 proposed officer actions (Record Contribution, Disburse Loan, Receive Repayment, Send Money, Add Member, Record Welfare) need a new officer-facing version |

This is real, valuable, and cleanly scoped work — mostly wiring existing computations onto the dashboard, plus two genuinely new pieces (upcoming repayments, officer quick actions).

---

## 5. Design system & performance (§5, §7) — grounded findings

A real token system already exists (`components/DESIGN_SYSTEM.md`, `lib/ui/tokens.ts`): brand colors, an Inter/Fraunces/DM Mono type system, spacing/breakpoint/radius/motion scales. Shared components (`PageHeader`, `StatCard`, `StatusPill`, `PaginatedTable`) are adopted across roughly half to three-quarters of pages already — real, but with real remaining long-tail (per this project's own prior UX audit, which already tracked this adoption sweep across several sessions).

Chart lazy-loading is already fully consistent — every recharts consumer goes through a `next/dynamic` wrapper. Table virtualization genuinely does not exist anywhere (`react-window`/`react-virtual` not installed) — real gap, but low priority given `PaginatedTable`'s server-side pagination already avoids the large-DOM problem virtualization solves.

---

## 6. RBAC (§10) — grounded findings, the headline item

This is where the proposal and reality diverge most, in both directions — significant parts already exist, and there's a genuinely valuable activation opportunity hiding underneath.

**Roles**: `member_role` enum is `chairperson | treasurer | secretary | member` — confirmed live, exactly the proposal's 4 roles (a past migration, 050, already renamed the historical `group_admin` value to `chairperson`; a later migration, 096, already swept ~15 stale RLS literals left over from that rename). There's no "officer" catch-all or 5th role to remove.

**Enforcement architecture**: already centralized, not scattered. `lib/auth/rbac.ts` provides rank-based (`ROLE_HIERARCHY`) and allowlist (`requireOneOf`) helpers; `lib/auth/middleware.ts` wraps these into route-level `withRole`/`withOneOf`/`withPlatformRole` used across ~80 route files (e.g. `withRole(req, 'treasurer', ...)` on loan routes, `withRole(req, 'chairperson', ...)` on dividend-approval routes). Postgres RLS policies provide a second, defense-in-depth layer using the same role literals.

**The permission-string system the proposal wants — already exists, unused**: a `permissions text[]` column on the `roles` table (migrations 077/079), pre-seeded per-role with exactly the proposal's permission-string style (`members.view`, `loans.approve`, `payments.approve`, `treasury.manage`, `billing.manage`, `roles.manage`, etc.), and the schema already supports group-scoped custom roles (`base_role`, `rank`, `group_id`). **Nothing in the application reads this column for authorization.** `member-roles.service.ts` only round-trips it as metadata when assigning a role. This is the same "fully built, zero callers" pattern this project's audit series has repeatedly found (`group_constitutions`, the governance-scoring tables, `sendPasswordResetEmail`) — except this time the dead infrastructure is authorization-relevant, which raises the stakes of getting the activation right.

**Subscription-aware gating — already exists, already works**: `feature-flags.service.ts`'s `isFeatureEnabled`/`assertEnabled` already supports `applies_to: 'plan'` with a `conditions.min_plan` check against `subscriptions.plan_type`, ranked via `PLAN_RANK`, plus deterministic rollout-percentage bucketing. This is exactly the proposal's "subscription-aware feature access" mechanism — built, not proposed — though it isn't necessarily applied to every module in the proposal's feature/plan table yet (that table's specific mappings would need to be checked module-by-module against existing flag rows).

**Member data isolation**: already enforced server-side, not just hidden in the UI — `/api/v1/me/*` routes derive scope purely from the JWT's `userId`/`groupId`, with no client-substitutable `memberId` parameter.

### What this means for implementation

The proposal's RBAC section, read literally, asks for a rewrite. What the codebase actually needs is narrower and different:

1. **Activate the existing `permissions` column** — build the read/check path (`hasPermission(ctx, 'loans.approve')` or similar) that currently doesn't exist, backed by the schema that already does.
2. **Migrate `withRole`/`withOneOf` call sites to permission checks incrementally**, not in one sweep — ~80 route files, every one auth-critical on a platform moving real money. This is exactly the class of change this project's own established practice treats with `EnterPlanMode` + research-before-build, not a fast pass.
3. **Verify the seeded `permissions` arrays are actually correct** for each role against real usage before trusting them — they were seeded once (migrations 077/079) and never validated against 80 real route-level checks since.
4. **Map the proposal's feature/plan table against the real `feature_flags` rows** — likely mostly a data/config task (seeding flag rows with the right `min_plan`), not new engineering, given the mechanism already exists.
5. **Custom roles on higher plans** — the schema already supports this (`roles.group_id`, `base_role`, `rank`); front-end/admin UI to create/edit custom roles doesn't exist yet and would be new work.

None of this should happen as a single large PR given the blast radius (every authenticated route in the app). It should be phased, with the highest-risk step (migrating existing route guards) done last, incrementally, and verified against the real Postgres RLS layer the same way the `app_tenant` CI-verification work in this project's history caught 3 real pre-cutover breaks that BYPASSRLS had hidden.

---

## 7. Recommendation

Given how much of this proposal turned out to already be true or already built, treat it as five independent workstreams rather than one big cleanup PR:

1. **Cheap, zero-risk, do now**: the 67 lint warnings; the ~15 env vars migrated into `lib/env.ts`'s validated schema.
2. **Dashboard completion**: wire Total Savings/Outstanding Loans/This-Month's-Contributions onto the dashboard from existing analytics computations; build Upcoming Loan Repayments (new query) and an officer-facing Quick Actions block (new component, mirroring the member app's existing one). Low risk, no auth changes.
3. **Navigation regroup**: build a "More" overflow primitive for `PortalSidebar`, re-slot the 20 existing items into the proposed 7-primary-item structure. Low risk, no backend changes.
4. **RBAC activation**: build the permission-check path against the already-seeded `permissions` column, verify the seeded data, then migrate route guards incrementally with the same research-before-build discipline this project uses for every other auth-architecture change. Highest risk item in this report — should not be rushed or bundled with the other four.
5. **Not recommended**: a sweeping "remove all unused X" pass — there's nothing verified to remove, and attempting one anyway risks deleting something a narrower check missed.

---

## 8. Implementation — Workstreams 1-3 (2026-08-02)

Shipped in the "safe stuff first" order the user chose. RBAC activation (workstream 4) deliberately not started — held for its own careful, separate pass per §6's recommendation.

### Workstream 1 — cheap/zero-risk fixes

- **67 lint warnings → 0.** Added an `argsIgnorePattern`/`varsIgnorePattern: '^_'` override to `eslint.config.mjs` (codifies a convention already in use, e.g. `_unused`/`_secret`/`_invert`), which resolved 7 by itself; the remaining 60 were fixed by hand across ~34 files. Two real findings surfaced along the way rather than being silently deleted: (1) `reconcileBillManagerPayment` (an outbound notify-Safaricom function for manually reconciling a cash/bank payment against a Bill Manager invoice) has zero callers anywhere — not a wiring gap, a genuinely unbuilt "mark invoice paid manually" feature; import removed, feature flagged here rather than built silently. (2) `sms/page.tsx`'s `usageStats`/`SummaryStatsGrid` — computed stats that exactly matched an unused component's prop shape but were never rendered; wired in rather than deleted, closing a real small gap instead of just silencing the warning.
- **~19 env vars added to `lib/env.ts`'s validated Zod schema** (`BCRYPT_ROUNDS`, `REGISTRATION_FEE_KES`, the M-Pesa cert/allowlist/shortcode vars, `TEXTSMS_BASE_URL`, `REDIS_TOKEN`, all SMTP/SES/Mailgun vars, `EMAIL_FROM_NAME`, `NEXT_PUBLIC_MPESA_PAYBILL`), all optional or defaulted to match existing inline fallback behavior exactly — zero behavior change. **Deliberately did not migrate call sites** to read from `env` instead of `process.env`: `validateEnv()` parses the *entire* `process.env` object once at cold-start regardless of which file later reads an individual var, so adding to the schema alone closes the fail-fast-validation gap the audit found. Migrating call sites would have been pure extra risk for zero additional benefit — especially in `daraja.service.ts`, which has its own established raw-`process.env` pattern even for already-governed vars, and specifically for `MPESA_CALLBACK_TOKEN`, which a real test (`daraja-callback-token.test.ts`) mutates at runtime via `jest.resetModules()`.

### Workstream 2 — dashboard completion

- **Total Savings, Outstanding Loans, This Month's Contributions** — all three came from a single already-existing endpoint, `GET /analytics/executive?period=12mo`, not new computation. `contributions.totalAmount` is all-time (= Total Savings), `loans.outstandingBalance` maps directly, and — better than expected — `contributions.monthlyBuckets` (ordered ascending over the trailing 12 months) already gives calendar-month buckets, so its last entry *is* "this month" with zero new backend work, not the "small new addition" the original audit assumed was needed.
- **Upcoming Loan Repayments** — genuinely new: `loansService.listUpcomingRepayments()` queries the existing, DB-trigger-generated `loan_repayments` table (already group-scoped, already has `due_date`/`status`/`total_due` per installment) for the next N pending installments group-wide, ordered by due date. New route `GET /api/v1/loans/upcoming-repayments`, new dashboard card.
- **Officer-facing Quick Actions** — rather than building a second component, moved the member app's existing `QuickActions` (`components/member/quick-actions.tsx` → `components/shared/quick-actions.tsx`, single import site updated) since it was already fully generic and exactly matched what the officer dashboard needed. 6 actions: Record contribution, Disburse loan, Receive repayment (both → `/loans`), Send money (reuses the dashboard's existing in-page STK dialog trigger), Add member, Record welfare.
- Existing 4 dashboard stat cards (Cash/M-Pesa, Welfare fund, External funding, Members) were **not removed** — only added to. Cutting an existing, currently-relied-on metric without being asked wasn't treated as in scope for a "safe" workstream.

### Workstream 3 — navigation regroup

- Corrected the original audit's own premise first: the "current nav is a flat 21-item list" claim in the source prompt was wrong — `components/layout/sidebar.tsx` was already grouped into 4-5 titled sections. What was actually missing was a collapsible "More"-style primitive, not basic grouping.
- Extended `components/shared/portal-sidebar.tsx` (shared by both the dashboard and admin sidebars) with an opt-in `children?: PortalNavItem[]` field on `PortalNavItem` — an item with children renders as a toggle button that expands an indented sub-list inline, instead of navigating directly. Auto-expands (never auto-collapses) any group containing the currently-active route, so landing on a page nested under "More" doesn't hide the link that got you there. Purely additive to the shared component — the admin sidebar, which uses no `children`, is unaffected (confirmed via typecheck/lint/build, not just assumed).
- `components/layout/sidebar.tsx`'s `NAV` re-slotted into the proposed 7-primary-item shape: **Dashboard, Members, Contributions, Loans, Finance* (M-Pesa/Treasury/Welfare/Shares/Dividends/Accounting), Reports, More*** (Meetings/SMS/WhatsApp/Email/Investments/Credit scores/Analytics/Data import/Billing/Settings) — replacing the old Money/Insights/Engage sections. The sidebar's separate footer "Settings" link was removed since Settings now lives inside More — avoids a duplicate entry rather than leaving both. The org-coordinator-only "Ecosystem" (Funding Portal) section is unchanged, appended after the primary nav exactly as before — it's role-conditional and not part of the generic simplification.

**Verification, run after each workstream independently, not just once at the end**: `tsc --noEmit` (0 errors throughout), `eslint` (0 warnings/errors throughout, down from the initial 67), full `next build` (clean, every route including the 2 new ones compiles), full Jest suite (357/357 throughout, no regressions). Dev server smoke-tested: boots cleanly, all public/pre-auth pages return 200 (`/`, `/login`, `/admin-login`, `/enterprise/login`, `/dashboard`'s server-rendered shell). **Not verified**: the actual authenticated dashboard/sidebar rendering with real data — this project's `DATABASE_URL` points at a live Supabase instance, not a disposable local database, and no test credentials were available; creating a throwaway account to screenshot would have written real rows to production-linked data without being asked first, so that step was stopped short and flagged rather than done silently.

### Not started: Workstream 4 (RBAC activation)

Per §6/§9, deliberately held out of this pass — activating the dead-but-seeded `permissions` column and migrating ~80 route-level `withRole`/`withOneOf` call sites is real, valuable work, but touches authorization on every route in the app on a platform moving real money. Needs its own `EnterPlanMode` + research pass, not to be bundled into a "safe stuff first" batch.
