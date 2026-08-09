---
title: Pass 1 Hypothesis Verification — Production Readiness Audit
status: draft
owner: audit
last_reviewed: 2026-08-09
---

# Pass 1 — Hypothesis Verification

**Mode: AUDIT.** Every claim below is either a live tool-call result (direct Postgres connection to production, project `qztcgryhoanennsizcll`, via the same connection string the application itself uses — `DATABASE_URL` in `.env.local`, confirmed elsewhere in this project to be the real production string, not a local DB) or a source citation with file:line. Findings are labelled **[PROVEN-PROD]** (verified against live data), **[VERIFIED]** (verified by reading the actual source), or **[REPORTED]** (relayed from a sub-agent's research pass, re-checked at a summary level but not independently re-derived line-by-line by the author of this document) — same convention `SMS_MESSAGING_AUDIT_2026-08.md` established, so severity claims stay re-checkable. Delivered via 3 parallel Explore research agents (H7, H3, H5) plus direct live-database queries (H8), run in the same session.

## Scope note: the original audit contract is lost

Pass 0 (`docs/audit/00-INVENTORY.md`) was produced in a prior session against an "audit contract" that defined Passes 0–5+ and hypotheses H1–H8. That contract was never saved to a file — only Pass 0's own cross-references to individual hypotheses survive. The user confirmed they do not have the original either. Rather than block on it or invent replacement content, Pass 1 proceeds on the hypotheses that ARE recoverable from Pass 0's own text (H3, H5, H7, H8), with the gap recorded plainly:

- **H1, H2, H6 — no surviving definition anywhere.** Not investigated in this pass; not renumbered or silently reassigned. If the original phrasing resurfaces later, slot the findings in here.
- **H4 (orphan-table tracing)** — Pass 0 already explicitly deferred this to "Pass 2 territory (source-of-truth table) or Pass 1 territory (H4/H8 sampling)." No dedicated H4 sampling was done in this pass beyond what naturally fell out of the H8 grants sweep (below); full orphan-table tracing remains Pass 2's job.

## A note on repository state during this pass

Three unrelated production fixes (SMS credit top-up, a dashboard reminder button, and a retry-storm fix — none touching anything examined below) were shipped to `main` via PRs #48/#49/#50 in the same session, in response to live incidents the user reported mid-audit. `audit/production-readiness-2026-08` was deliberately **not** rebased onto them, so this pass's findings describe the codebase at the original Pass 0 fork point, consistent with Pass 0's own "commit HEAD on branch audit/production-readiness-2026-08" framing. None of the three PRs touch RLS, auth wrappers, organization scoping, or the reminder *engine* (one of them touches `lib/sms/trigger-engine.ts`'s error-handling, which H5 read the pre-fix version of — irrelevant to H5's architectural question).

---

## H7 — Does server-side enforcement actually match each route group's client-side guard claim?

**[VERIFIED]**, `lib/auth/middleware.ts` read in full. All 9 auth wrappers (`withAuth`, `withRole`, `withOneOf`, `withPermission`, `withAnyPermission`, `withOrganizationPermission`, `withBackofficeAuth`, `withPlatformRole`, plus `getAuthContext`/`getBackofficeContext`) **fail closed** — every one throws `UnauthorizedError`(401)/`ForbiddenError`(403) on a missing or wrong claim; none silently passes a request through on an absent header.

### `(admin)` — confirmed functional mismatch, not a privilege-escalation gap

`app/(admin)/layout.tsx:27` allows `ADMIN_ROLES = ['super_admin','support','organization_coordinator']` client-side, with a comment (`:19-21`) claiming the proxy "already validates this on `/api/admin/*`." **All 48 HTTP handlers across all 37 files under `app/api/admin/**/route.ts` call `withPlatformRole(req, 'super_admin', ...)` — a single hard-coded role, never the 3-role set** (exhaustive grep, spot-read of `users/[id]`, `members/[id]/role`, `groups/[id]`, `governance/*`, `organizations/**`, `policies/**`, `roles`). The 2 exceptions (`auth/my-organizations`, `auth/switch-org`) correctly use `withBackofficeAuth` (any backoffice role) since they're org-switcher utilities.

**Practical effect**: a `support` or `organization_coordinator` staff member can log into `/admin-login`, pass the proxy's audience check, and land on the `(admin)` shell — then get a 403 on every single data call the shell makes. This is over-restrictive (locks out roles the UI implies should work), not under-restrictive — no exploit path, but a real, confirmed discrepancy between the guard's own comment and actual enforcement.

### `(enterprise)` — no gap found

`requireOrganizationPermission` (`lib/auth/organization-permissions.ts:55-64`) and `organizationService.assertOrganizationCoordinator` (`lib/services/organization.service.ts:38-45`) both check role membership + `organizationId` presence only — neither compares a resource's organization to the caller's, by design (no resource argument). All 14 routes under `app/api/v1/organization/**` were read; every one derives its acting `organizationId` from `auth.organizationId` (the JWT claim), never from client input — see H3 below for the full trace. Not exploitable given current call sites, but the safety property lives in "every service query happens to add `AND organization_id = $n`," not in the wrapper itself — a future route that forgets that predicate would reopen this. Flag for future route-review discipline, not a fix needed now.

### `(dashboard)` / `(member)` — no gap found

12 sampled sensitive routes (loan approve/disburse/write-off, welfare review, dividends approve/submit/bulk-pay, member status transition, mpesa reallocation approve/reject, contribution-splits, journal post) **all** use `withPermission`/explicit `requirePermission` — never bare `withAuth` for a state-changing action. 3 of them (loans, member-status, mpesa-reallocations) additionally re-verify the caller's permission against **live** `roles.permissions` via `assertAuthFresh`, closing the up-to-15-minute JWT-staleness window the Workstream-4 RBAC work (`[[project-kitabu-yetu-audits]]`, 2026-08-03) built for exactly this class of route. 15 `withAuth`-only mutating routes were found with no role dimension to gate on at all (own password, own STK push, own notifications) — correctly ungated, not a finding.

### Client-side hide without server re-check

One instance of client-side permission gating exists at all (`useHasPermission`, `lib/auth/use-permission.ts`, used by the loan-approve button) — its own doc comment states the pattern is UX-only, and the route it targets independently re-checks server-side (confirmed above). No instance found where a hidden button's route trusts the client.

---

## H3 — Does the `/api/v1/organization/*` cross-audience carve-out create a real cross-organization scoping gap?

**[VERIFIED]** — no. `proxy.ts:299-318`'s reshaping sets `x-group-id` to the **empty string unconditionally** (never a real or client-influenced group id) and `x-organization-id` to `payload.organizationId` — a value read straight off the **verified JWT**, after `sanitizedHeaders()` (`proxy.ts:93-108`) has already stripped any client-sent copy of that header. So the reshaped token does not carry a spoofable `groupId`-equivalent at all; the only scope-bearing value is a claim the client cannot set.

All 13 files under `app/api/v1/organization/**` were read. Every one scopes its SQL by `organization_id = <value derived from auth.organizationId>`. The 3 routes that DO accept a client-suppliable resource id (`reports?groupId=`, `programs/[id]`, `disbursements/[id]`) all use it only as a second, ANDed predicate:
- `getGroupDetail` — `WHERE organization_id = ctx.organizationId AND group_id = $2` (org.service.ts:294-299) → `NotFoundError`, not another org's data, if the group isn't linked to this org.
- `updateProgramStatus`/`getProgramForUpdate` — `WHERE id = $x AND organization_id = $y` (finance.service.ts:190-194, 914-920).
- `approveDisbursement`/`rejectDisbursement` — `WHERE id = $x AND organization_id = $y ... FOR UPDATE` (finance.service.ts:1083-1116).

An Org-A coordinator supplying Org B's group/program/disbursement id gets a 0-row match → `NotFoundError`, never Org B's row. Postgres RLS (`app_current_organization_id()`, migration 055) independently enforces the same boundary as a second layer, reading the identical `app.current_organization_id` GUC that `withDb`/`withTransaction` sets from the same `ctx.organizationId` (`lib/db/index.ts:111-121`) — no separate trust path to go wrong.

`organization_members` binding was traced through admin-login (`app/api/v1/auth/admin/login/verify/route.ts:100-124`) and org-switch (`app/api/admin/auth/switch-org/route.ts:43-57`): a coordinator cannot obtain a token claiming an `organizationId` they don't have an active `organization_members` row for — checked server-side against the DB at both mint points, not client-trusted.

`super_admin`'s cross-org visibility is an explicit named entry in `ORG_AXIS_ROLES = ['organization_coordinator','super_admin']` (`organization-permissions.ts:48`), not an accidental fallthrough — `support` clears the proxy's coarser audience check but is correctly rejected by this narrower allowlist.

**One functional (not exploitable) rough edge**: `organization.service.ts`'s `orgId = ctx.organizationId ?? ctx.groupId` fallback would, for a hypothetical `super_admin` token minted with no `organizationId` claim, substitute `ctx.groupId` — which on this carve-out is always the empty string the proxy stamps, never client-influenced — so it degrades to "zero rows match `organization_id = ''`," not a cross-tenant leak. Worth tightening for clarity, not urgent.

**Verdict**: no cross-organization scoping gap.

---

## H5 — Did Chama Reminder introduce a second dispatch/scheduling engine outside `lib/jobs`?

**[VERIFIED]** — no, and the code that would test this isn't merged yet.

The `Finish birthday SMS and render templates per recipient (Chama Reminder Phase 1)` commit (`8a8a9cd`) exists only on the open branch `sms-birthday-and-per-recipient-rendering` — confirmed via `git merge-base --is-ancestor` against both `main` and this audit branch: **not an ancestor of either**. The codebase actually under audit (and current production `main`) has zero Chama-Reminder-specific code — `grep -r "chama"` across all `.ts`/`.tsx` returns only documentation files.

Reading the unmerged commit anyway (since it's the only concrete evidence of how the feature would be wired): it adds exactly one new `JobType` value (`sms_birthday_reminders`) into the same 34→35-member enum, enqueued by the same `enqueueTimeBasedJobs()`, processed by the same `processJobBatch()` switch, deduplicated through the same `reminder_dispatch_log` table (`reference_type`/`reminder_stage` are free-text by design — migration `106_reminder_dispatch_log.sql:40-42` — specifically so new reminder types don't need new schema). `docs/chama-reminder/CHAMA_REMINDER_ARCHITECTURE_INTEGRATION.md` §6/§8 explicitly design it this way ("reuse `smsService`/`notifyMember` exactly like every existing feature," "no new... tenant-isolation mechanism").

No second `pg_cron` entry (only the one row confirmed in Pass 0), no `vercel.json` `crons` array, no scheduled GitHub Actions workflow, no server-side `setInterval`, no second idempotency table anywhere in the repo.

`sms_schedules` (the user-configurable schedule table `sms_process_schedules` drains) explicitly excludes `birthday`/`loan_due` schedule types today (`lib/services/sms-scheduler.service.ts:10-13,73`) — left for the still-unmerged dedicated handler, consistent with the "genuinely unimplemented on this tree" finding above.

**Verdict**: one dispatch engine exists, confirmed both in the design doc and in the one commit that touches it; merging that commit as-is would not change this.

---

## H8 — Tenant-isolation / RLS bucket

Live production queried directly (`pg_class`/`pg_policy`/`information_schema.role_table_grants`/`pg_roles`), same project as Pass 0.

### Critical, [PROVEN-PROD]: `invoice_sequences` is TRUNCATE-able by fully unauthenticated callers

Pass 0 flagged `invoice_sequences` as the one table with `rls_enabled: false` (Supabase's advisory tool marks this `critical`) but explicitly deferred exploitability to Pass 1, on the stated assumption that "this app doesn't appear to route through PostgREST/anon key for tenant data." **That assumption should not be relied on** — this project's own audit log records a closed, confirmed incident (2026-08-08, "PostgREST exposure incident") where self-registered Supabase Auth accounts (the `authenticated` role) reached SECURITY DEFINER RPCs and two other tables directly via PostgREST, independent of anything the Next.js app itself calls. Supabase's REST endpoint is live for this project regardless of whether the app's own code uses it.

Grants confirmed via live query:
```sql
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='invoice_sequences' AND grantee IN ('anon','authenticated');
```
→ both `anon` and `authenticated` hold exactly `REFERENCES, TRIGGER, TRUNCATE` — **no** `SELECT`/`INSERT`/`UPDATE`/`DELETE` (unlike every other table — `payments`, for contrast, grants the full `DELETE,INSERT,SELECT,UPDATE,REFERENCES,TRIGGER,TRUNCATE` set to both roles). So this table cannot be read or written via PostgREST, but **`anon` — no authentication at all — can `TRUNCATE` it**, and combined with zero RLS, nothing stops that from actually executing. `invoice_sequences` almost certainly backs per-group invoice-number generation; a `TRUNCATE` from an anonymous caller would silently wipe that counter state platform-wide (not customer data disclosure — an availability/integrity hit on invoice numbering). This is immediately actionable: a `REVOKE TRUNCATE ON invoice_sequences FROM anon, authenticated` (plus enabling RLS, matching every other table) closes it with zero behavior change for the app itself, which never connects as `anon`/`authenticated`.

### Blanket default-privilege grant across all 135 tables — severity depends on per-table RLS predicates, not verified here

Every one of the 135 `public` tables (not a subset) grants the full `DELETE,INSERT,SELECT,UPDATE,TRIGGER,TRUNCATE,REFERENCES` set to both `anon` and `authenticated` — a platform-level default-privilege grant, not per-table hardening choices. This is **not** the same finding as `invoice_sequences` above: for the other 134 tables, RLS is enabled, and a PostgREST caller (who never gets `app.current_group_id`/`app.current_organization_id` set — those GUCs are set only inside this app's own `withDb`/`withTransaction` calls) would have policies like `group_id = app_current_group_id()` evaluate against a NULL setting, which should default-deny. **This pass did not read the actual `USING`/`WITH CHECK` predicate text for all 134 tables** (Pass 0 explicitly scoped that out too) — so "the GRANT is broad but RLS should catch it" is the working assumption, not a verified fact for every table. Recommend a dedicated predicate-correctness pass (Pass 2 candidate) rather than treating this as closed.

### Resolved: is "RLS enabled but not forced" a meaningful bypass for either role the app actually uses?

Pass 0 flagged 45 tables (now 57, of 135 — see table-count note below) as RLS-enabled-but-not-forced and explicitly left open "whether the table owner... is a meaningful bypass path." **Now resolved: no.**
```sql
SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner), count(*)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' GROUP BY 1,2,3;
```
→ **all 135 tables, with no exception, are owned by `postgres`.** `FORCE ROW LEVEL SECURITY` only restricts the table *owner* — every non-owner role's policies apply regardless of the forced flag. `postgres` (the role `withAdminDb` connects as) carries `rolbypassrls = true`, so RLS — forced or not — never applies to it anyway, for a completely separate reason. `app_tenant` (the role `withDb` connects as, live in production since 2026-08-05) is confirmed **not** the table owner and **not** `rolbypassrls`, so ordinary (non-forced) RLS enforcement already applies to it in full. Neither role the application actually uses is affected by whether `FORCE` is set on any of these 57 tables. The forced/not-forced distinction only matters for a role that (a) owns the tables and (b) lacks `BYPASSRLS` — no such role exists in this schema today.

### Table count drifted 130 → 135 since Pass 0; migration file count unchanged at 146

Pass 0 (a few days prior) reported 130 tables from live introspection; this pass's identical query returns 135, while `supabase/migrations/*.sql` is still 146 files (same as Pass 0 recorded). Consistent with this project's established, previously-documented pattern of applying some schema changes to production via direct `execute_sql` rather than a checked-in migration file — not re-derived to a specific cause in this pass; flagged as drift to be aware of, not investigated further here.

### The 3 single-policy financial tables — predicates read

Pass 0 flagged `payments`, `invoices`, `bill_manager_invoices` as carrying exactly one RLS policy each, "worth a closer read in Pass 1." Read via `pg_policies`:
- `payments_all` / `invoices_all`: `(SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()))`, `cmd: ALL`.
- `rls_bill_manager_invoices_group`: `(group_id)::text = (SELECT current_setting('app.current_group_id', true))`, `cmd: ALL` — **no explicit `is_super_admin()` carve-out**, unlike the other two. Under the current role setup this is inert (super_admin's own queries still run through `postgres`, which bypasses RLS outright) — but if the `app_tenant`-only cutover is ever completed for `super_admin`-initiated requests too, a super_admin session on this one table specifically would be scoped by group like anyone else rather than seeing across groups, an inconsistency worth a one-line fix whenever that table is next touched, not urgent today.

### `mpesa_b2c_transactions`/`mpesa_b2b_transactions`/`mpesa_b2c_charge_tiers` — re-verified, no regression

The `07-remediation-backlog.md` retraction (these tables' RLS being live via a `DO $$ ... EXECUTE format(...) $$` dynamic-policy migration, invisible to a naive `CREATE POLICY` grep) still holds: `rls_mpesa_b2c_transactions_group`, `rls_mpesa_b2b_transactions_group`, and 4 command-specific `rls_charge_tiers_*` policies are all present today via direct `pg_policies` query. All three tables are among the 57 not-forced tables, which per the resolution above is not a meaningful gap for either role currently in use.

### `TENANT_DATABASE_URL` — confirmed set in Production; **not set in Preview**

Pass 0 could not verify this from source alone. `vercel env ls production` confirms `TENANT_DATABASE_URL` exists, `Production` only, created 4 days ago — matching the 2026-08-05 `app_tenant` cutover date already on record. **It does not appear scoped to `Preview`** (unlike most other DB-related vars, which list `Production, Preview` together). Given this project has no separate staging database — Preview deployments point at the same Supabase project — a PR preview build would fall back to the admin pool per `lib/db/index.ts`'s own documented behavior ("a no-op until that role exists"), meaning **Preview traffic runs against real production data with RLS effectively bypassed** (same `postgres`/`BYPASSRLS` role as `withAdminDb`). Not exploitable by an external party (Preview URLs still require the same app-level auth), but worth a deliberate decision rather than an unnoticed gap: either add `TENANT_DATABASE_URL` to Preview too, or explicitly accept that preview builds never get RLS-enforcement testing.

### `withAdminDb` call-site count: 314/94 today vs. 309/91 in Pass 0

```
grep -c withAdminDb\( across *.ts, files_with_matches
```
→ 314 occurrences across 94 files, up from Pass 0's 309/91 — the +5/+3 delta is fully explained by this session's own 3 out-of-band SMS fixes (2 new route files each with a use, `lib/sms/trigger-engine.ts` unchanged in count). ADR-001's own Phase-3 estimate ("~130 of these call sites don't structurally need admin privilege") is a subset estimate, not a total-count claim — this delta doesn't contradict it. Phase 3 itself (migrating that subset to `withDb`) remains not started, unchanged from Pass 0.

---

## Checkpoint 1 summary

| Hypothesis | Verdict |
|---|---|
| H7 | One confirmed functional mismatch — `(admin)`'s 3-role client guard vs. every route's `super_admin`-only gate. Over-restrictive, not exploitable. No gap found elsewhere. |
| H3 | No cross-organization scoping gap. One functional (non-exploitable) rough edge in a fallback expression, noted for future cleanup. |
| H5 | Confirmed single dispatch engine. Chama Reminder's only implemented piece is unmerged and, when merged, joins the same engine. |
| H8 | **Critical, actionable now**: `invoice_sequences` — no RLS + TRUNCATE granted to `anon`/unauthenticated. Everything else in this bucket resolved as either closed (not-forced/ownership question), unchanged/re-verified (mpesa_b2c/b2b), newly confirmed (TENANT_DATABASE_URL in prod, missing in Preview), or explicitly scoped out to a future pass (per-table RLS predicate correctness across all 135 tables). |

### What Pass 1 did not do
- Did not read `USING`/`WITH CHECK` predicate text for all 135 tables — only the 3 single-policy financial tables plus the previously-flagged mpesa set. The blanket `anon`/`authenticated` GRANT finding above means this is no longer optional groundwork for a future pass; it's the thing standing between "GRANT is broad" and "GRANT is exploitable," table by table.
- Did not complete H4 (orphan-table tracing) — still Pass 2 territory, per Pass 0's own scoping.
- Did not resolve H1/H2/H6 — no surviving definition to investigate against.
- Did not fix anything (per this document's own AUDIT-mode scope) except where the user separately requested and approved specific fixes mid-session (the 3 SMS PRs noted above, and see [[project-kitabu-yetu-sms-messaging]] for that work) — none of which overlap this document's findings.
