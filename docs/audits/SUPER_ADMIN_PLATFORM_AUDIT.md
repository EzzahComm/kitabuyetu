# Kitabu Yetu — Super Admin Platform Vision: Gap Analysis

**Date:** 2026-07-20
**Scope:** Source-grounded comparison of the current `(admin)` super-admin portal against the 14-section "Super Admin platform vision" (executive dashboard, organization/group/member drill-down, health scores, Risk Center, cross-level search, geographic intelligence, an analytics/summary-table layer).
**Method:** Every finding below cites a specific file and line, gathered via two parallel research passes across the admin service layer, every `(admin)` page, and the underlying schema. Labeled **CONFIRMED** (directly verified) or **SUSPECTED** (a strong signal not fully traced to runtime).

---

## 1. Executive Summary — the headline is good news

The vision reads like a request to build a platform from scratch. **It mostly isn't one.** The hard, unglamorous work — a real organization↔group access model, a genuinely sophisticated per-member credit/risk-scoring engine, a full three-level Kenya geographic hierarchy wired onto every relevant table, an immutable audit log with IP/user-agent columns, and — most strikingly — **a complete, six-table governance/health-scoring schema with 19 pre-seeded metrics and threshold bands** — already exists in this codebase. None of it is mock data. Most of it is simply **disconnected**: built, seeded, and never wired to a computation job, an API route, or a UI page.

This changes the shape of the roadmap substantially. The most expensive-looking items in the vision (health scores at every level, a Risk Center, geographic intelligence) are **integration projects on top of existing infrastructure**, not net-new architecture. The genuinely-missing pieces are narrower: a real cross-entity search, breadcrumb-based multi-level navigation (a component for this already exists and is just unused in `(admin)`), an organization comparison view, and a computation engine to actually populate the governance tables.

| Score | /100 | Basis |
|---|---|---|
| **Vision realized today** | **31** | Most of the 14 sections are absent or cosmetic in the UI |
| **Foundation readiness** | **65** | Schema, data model, and adjacent services for most of the vision already exist |

The gap between these two numbers is the story: this is an integration and activation problem, not a from-scratch build.

---

## 2. Section-by-Section: Vision vs. Reality

### 2.1 Overall hierarchy (Platform → Organization → Group → Member → Transaction)

**PARTIAL.** Organization↔Group is a real, explicit many-to-many grant (`organization_group_access`, unique on `(organization_id, group_id)`, `is_active` gated) — never automatic platform-wide visibility, confirmed correct. Org→Group drill-down already exists as a real page. Group→Member has **no dedicated admin view at all** (only a flat, ungrouped cross-tenant member list at `admin/users`). Member→Transaction exists only fragmented across tabs on a *different portal's* page (see §2.6).

### 2.2 Executive Platform Dashboard

**MOSTLY EXISTS.** `app/(admin)/admin/page.tsx` + `getPlatformStats()` (`lib/services/admin.service.ts:190-260`) already renders real, live KPIs: Groups, Organizations, Total Members, Monthly Revenue/MRR, Platform Revenue, Active Subscriptions, At-Risk Subscriptions, Open Tickets, Suspended Groups, a 6-month revenue trend chart, and a live Recent Activity feed from `audit_logs`. All computed by live SQL, polled every 60-120s.

**Missing from the vision's example card list**: total platform *savings* (member contributions), total *outstanding loans* (exists as a leaderboard on a different page, not summed platform-wide on the main dashboard), Cash Held, a single "Platform Portfolio" figure, Active Users Today, Transactions Today. **Vocabulary note**: "Platform Revenue" here is SaaS subscription billing revenue (from `payments`/`invoices`), not member fund flow — worth keeping that distinction explicit in any new copy, since the vision's phrasing ("Where is donor money concentrated?") implies fund-flow metrics, not billing metrics.

### 2.3 Organizations Page

**EXISTS, closely matches the vision.** `listOrganizations()` (`admin-organizations.service.ts:32-84`) already returns, per organization: group_count, member_reach (via a lateral join through `organization_group_access`), wallet_balance, total_disbursed — essentially the "48 Groups / 2,360 Members / KES 31.2M Savings" card the vision describes, minus a health percentage (see §2.10).

### 2.4 Organization Dashboard

**PARTIAL.** `app/(admin)/admin/organizations/[id]/page.tsx` (313 lines) has real KPI cards (Groups Overseen, Member Reach, Wallet, Total Disbursed) and a real per-group table (member_count, total_contributions, access_level) with assign/revoke controls. **Missing**: loan/cash/welfare/shares cards, any trend chart (savings/loan/membership/cash-flow), and a health/growth score.

### 2.5 Group Dashboard

**FRAGMENTED across two different, non-overlapping partial views** — a real but unfinished gap, not a missing one:
- `app/(admin)/admin/groups/[id]/page.tsx`: Active Members / Total Contributions / Active Loans / Open Tickets KPIs, a Financial Summary panel, a Recent Activity feed — but **no member table anywhere on the page**, and the "Risk Score"/"Engagement Score" bars it displays read from `groups.risk_score`/`groups.engagement_score`, which are **CONFIRMED dead columns**: `DEFAULT 0`, and a repo-wide search found zero `UPDATE`/write path anywhere in the codebase. These bars are decorative today.
- `app/(dashboard)/dashboard/page.tsx` (the *group officer's own* landing page, a different portal entirely): cash/M-Pesa balance, welfare fund, external funding, member count, recent contributions — no shares, no loan portfolio total, no attendance.

Neither page has the vision's full card set, and the two disagree on which cards matter.

### 2.6 Member Dashboard

**The weakest area, and the cheapest to fix.** There is **no member detail page anywhere in `(admin)`** — `admin/users` is a flat list with a role-assignment dialog and zero click-through to a profile. The only member-profile page in the entire app is `app/(dashboard)/members/[id]/page.tsx` (group-officer portal), which shows contributions, loans, next-of-kin, and status — but **no shares, no welfare, no attendance, and critically, no credit/risk score.**

That last gap is the real find: **`lib/services/credit-scores.service.ts` (829 lines) already computes exactly the composite score the vision asks for** — a weighted `financial_score` (contribution consistency, loan repayment, savings growth, share ownership, dividend participation) blended with a `social_score` (meeting attendance, welfare participation, leadership role) into an `overall_score` and a `reliability_tier` (excellent/good/fair/poor/high_risk). It's fully built, tested, and exposed at `/credit-scores/[memberId]` — **it's simply never linked from the member profile page**, and never used anywhere in `(admin)`.

### 2.7 Universal Drill Down

**NOT BUILT, but the component to build it already exists.** `components/shared/page-header.tsx` defines a working, reusable `PageHeader` with a `breadcrumbs` prop — used in the `(enterprise)` portal and nowhere in `(admin)`. Every `(admin)` detail page instead hand-rolls a single "back to list" arrow button. Route nesting is flat/2-level throughout (`organizations/page.tsx` → `organizations/[id]/page.tsx`, same for `groups`) — no 3-level nesting exists anywhere (e.g. org → group → member).

### 2.8 Cross-Level Search

**NOT BUILT in any form.** The ⌘K command palette (`components/admin/command-palette.tsx`) is a static list of ~15 hardcoded navigation shortcuts with client-side fuzzy-matching against their own labels — it never queries a table. The topbar's search box is a non-functional placeholder `<span>` that just opens the same static palette. Three *separate*, page-scoped searches exist today (organization name, group name, member name/email/phone) with no unified cross-entity endpoint behind any of them.

### 2.9 Platform Portfolio

**PARTIAL.** `getPlatformAnalytics()` (`admin.service.ts:886-939`) computes a genuine top-10-groups-by-contributions leaderboard and platform-wide loan/welfare aggregates — but there is no full, sortable, exportable table across *all* organizations with growth/health/risk columns, and no organization-vs-organization comparison exists anywhere (see §2.11).

**Naming bug found in passing**: `admin/analytics/page.tsx` labels its 12-month trend chart "Organization Growth," but the underlying query (`admin.service.ts:895`) counts `groups`, not `organizations`. Same mislabeling on "Top Organizations by Contributions," which is actually top *groups*.

### 2.10 Health Monitoring

**This is the single biggest finding of this audit.** A complete governance/health-scoring system already exists **in the database only**:

| Table | Purpose |
|---|---|
| `governance_metrics` | 19 pre-seeded metric definitions — liquidity ratio, loan-to-deposit ratio, PAR30, NPL, recovery rate, concentration, operational self-sufficiency, cost-to-income, ROA, ROE, savings/membership/loan growth, total assets, capital adequacy ratio, provision coverage, savings protection |
| `governance_thresholds` | Green/amber/red bands per metric, platform-default and per-group override |
| `governance_snapshots` | The computation target: per-group, per-metric, per-period value + RAG status + trend |
| `governance_health_scores` | A composite 0-100 score per group per period, with a component breakdown |
| `governance_alerts` | Amber/red alerts with a real acknowledge/resolve workflow already built into the schema |
| `governance_risk_weights` | Basel-style risk weights and provision rates by asset class |

**Confirmed: zero application code references any of these six tables.** No service file, no `lib/jobs` handler, no API route, no UI page. No trigger or function populates them. This is more thoroughly orphaned than the `group_constitutions` table an earlier audit found — that one at least had some code reaching toward it. This is pure, unreferenced schema plus seed data. **Activating this — writing the computation job that populates `governance_snapshots`/`governance_health_scores`/`governance_alerts` on a schedule, and a UI that reads them — is the single highest-leverage piece of this entire roadmap**, because the hardest design work (which metrics, what bands, what a health score means) is already done.

### 2.11 Risk Center

**PARTIAL / COSMETIC.** `admin/risk/page.tsx` has some real signals — a "fraud feed" that's actually failed/pending M-Pesa transactions, a KYC queue from real `groups.onboarding_status`, and a loan-arrears ratio (the one real echo of the vision's "loans overdue" example). But the risk heatmap's "AML" and "Liquidity" dimensions are both driven by `AVG(groups.risk_score)` — the same dead, never-written column from §2.5, so those cells are always effectively zero. **The action buttons (Escalate/Dismiss/Approve/Reject) don't persist anything** — confirmed no mutation/API call exists behind any of them; clicking them just closes the dialog. None of the vision's specific example alerts (60-day-inactive groups, 90-day-overdue loans, declining-savings organizations, negative cash balances, groups with no active officers) exist as computed signals anywhere — and building them is exactly what §2.10's governance engine would produce as a side effect.

### 2.12 Organization Comparison

**NOT BUILT.** No side-by-side comparison view exists anywhere in the codebase.

### 2.13 Geographic Intelligence

**Schema fully ready, zero aggregation built.** A complete three-level Kenya jurisdiction hierarchy already exists — `counties`/`sub_counties`/`wards` reference tables, seeded with all 47 counties plus full IEBC sub-county/ward data. `groups` carries `county_id`/`sub_county_id`/`ward_id` FKs, `members` carries its own `county_id`, `organizations` carries a free-text `county`. The only current consumer of any of this is a registration-form dropdown (`app/api/v1/jurisdictions/counties/route.ts`) — **confirmed zero `GROUP BY county` or regional rollup query exists anywhere.** Building county-level aggregation here is mostly a query-writing exercise, not a data-modeling one — the reference data and FK columns are the expensive part, and they're done.

### 2.14 Platform Audit Center

**Mostly built on the backend, under-exposed in the UI.** `audit_logs` already has `ip_address` (INET) and `user_agent` columns, is trigger-enforced immutable, and its service function (`listAuditLogs`, `admin.service.ts:824-861`) already accepts `groupId`, `action`, `table`, `search`, `from`, `to` filters. But `admin/audit-logs/page.tsx` only wires up **search, action-type, and date range** — group filtering exists on the backend with no UI control, and organization/user/IP-address filtering exist in neither layer. This is a cheap win: most of the filter plumbing the vision asks for is one dropdown away from already working.

### 2.15 Recommended Data Architecture (Analytics Engine / summary tables)

**Not built — and, per `OPTIMIZATION_CLEANUP_AUDIT.md`, this connects directly to that report's "zero caching layer" finding.** Zero materialized views exist anywhere in the migration history; every admin dashboard, without exception, runs live aggregate SQL against transactional tables on every request. This works today at current scale but is the architectural opposite of what the vision describes.

---

## 3. Summary Table

| Vision section | Realized | Foundation readiness | Note |
|---|---|---|---|
| Executive dashboard | 6/10 | — | Real KPIs; missing total savings/cash/portfolio figures |
| Organizations page | 8/10 | — | Closely matches vision already |
| Organization dashboard | 5/10 | — | Cards exist; no charts, no health |
| Group dashboard | 4/10 | — | Fragmented across 2 portals; dead risk/engagement columns |
| Member dashboard | 2/10 | High | Credit-scoring engine already built, just not linked |
| Universal drill-down | 1/10 | High | Breadcrumb component exists, unused in `(admin)` |
| Cross-level search | 0/10 | Medium | 3 separate scoped searches exist; no unified endpoint |
| Platform portfolio | 2/10 | Medium | Leaderboard exists; no full comparison table |
| Health monitoring | 1/10 | **Very high** | 6-table schema + 19 seeded metrics, zero computation |
| Risk Center | 3/10 | High | Real signals exist but mixed with dead ones; actions don't persist |
| Organization comparison | 0/10 | Medium | Not built |
| Geographic intelligence | 1/10 | **Very high** | Full 3-level hierarchy + FKs on every table, zero aggregation |
| Audit center | 6/10 | High | Backend filters exist, UI exposes half of them |
| Analytics/summary architecture | 2/10 | Low-Medium | No materialized views; connects to the caching gap in the optimization audit |

---

## 4. Phased Roadmap

### Phase 0 — Quick wins (mostly wiring, little new backend)
**Status (2026-07-28): done.** Re-verified against current code before starting Phase 1 — 4 of these 5 landed in earlier, untracked work (not this audit's own follow-through); only the credit-score link and the audit-log filter were confirmed by directly reading the file, not assumed from a report.
- ~~Link the existing `credit-scores.service.ts` score onto the member profile page~~ — done. `app/(dashboard)/members/[id]/page.tsx:29-46,93-98` fetches and renders it (tier-toned `StatusPill`, linked to the full score page), with a comment citing this section directly.
- ~~fix the "Organization Growth"/"Top Organizations" mislabeling~~ — done. `app/(admin)/admin/analytics/page.tsx:49,158` now read "Group Growth (12 months)" / "Top Groups by Contributions", matching the `groups`-scoped queries.
- ~~Wire the audit-log page's already-supported `groupId` filter, and add organization/IP-address display~~ — done. `app/(admin)/admin/audit-logs/page.tsx` has a `groupId` filter (line 34) and renders `ip_address` as its own column (line 121). Organization-level filtering is still absent (only group), not required by the item as originally scoped.
- **Risk Center action buttons — partially resolved, judgment call, not re-opened.** `app/(admin)/admin/risk/page.tsx:192-199,243-253` are now `disabled` with an explanatory tooltip and banner, rather than the original silently-no-op-on-click behavior — the misleading half of the complaint is fixed. Literal "wire to real mutations" would require new alert/KYC action tables + routes that don't exist yet — bigger than a quick win, deferred to a real phase if ever prioritized, not attempted here.
- ~~Add breadcrumbs to `(admin)` pages using the already-built `PageHeader` component~~ — done. Both existing `(admin)` detail pages (`admin/organizations/[id]`, `admin/groups/[id]`) use `breadcrumbs=`; zero hand-rolled back-arrow buttons remain anywhere under `(admin)` (grep-verified).

### Phase 1 — Member & group drill-down completion
**Status (2026-07-28): shipped, with an honest scope note.**
- ~~Build a real admin-side member detail page~~ — done. New `app/(admin)/admin/groups/[id]/members/[memberId]/page.tsx`: profile, savings/shares/loan-balance/this-month (reusing `member-balances.service.ts`'s `computeMemberFinancialSnapshot`, built for the (member) portal — avoids a third copy of that SQL), a 10-row recent contribution/repayment feed, and the existing credit score (financial/social breakdown, tier, loan eligibility limit) — read directly cross-tenant rather than through `credit-scores.service.ts`'s tenant-scoped `getLatestForMember`, since that function is deliberately group-scoped for its own use case. **Welfare and attendance are not included** — no readily-reusable cross-tenant query existed for either within this pass's scope; flagged here rather than silently dropped, worth a follow-up if this page proves useful.
- ~~a new member table on `admin/groups/[id]`~~ — done, was completely absent before (`listGroupMembers`, paginated).
- ~~reachable from both `admin/users`~~ — done, row click-through added (existing per-row action dropdown wrapped in `stopPropagation` to avoid double-firing, matching the same pattern already used on `admin/groups`/`admin/organizations`'s own list pages).
- **Route nesting**: shipped as `Groups → {group} → Members → {member}` (3 levels), not the full `Organizations → {org} → Groups → {group} → Members → {member}` (4 levels) — `admin/groups/[id]` isn't itself nested under `admin/organizations/[id]` today (a group can be linked to zero, one, or more organizations via `organization_group_access`, so there's no single canonical parent org to nest it under). Treated as a deliberate scope boundary, not an oversight.

### Phase 2 — Activate the governance engine (highest leverage in this report)
**Status (2026-07-28): shipped, in 3 PRs, with honest scope notes.**
- ~~Build the computation job that populates `governance_snapshots`, evaluates threshold bands, writes `governance_health_scores`, and raises `governance_alerts`~~ — done (#15). New `lib/services/governance.service.ts` computes all 19 seeded metrics per group per month (sourced from the same account-ledger/P&L conventions `accounting.service.ts` already uses, not a second disagreeing calculation), resolves each against `governance_thresholds`, and upserts snapshots/alerts/health scores. Wired into `lib/jobs` as `governance_compute_metrics` (1st of month, 11:00 UTC), plus a manual `/api/admin/governance/compute` trigger for on-demand recompute. **`group_health`** is a composite of the 8 metrics with a real, verified data source (liquidity, par30, npl, recovery_rate, oss, roa, savings_growth, membership_growth) — the seed data's "repayment, savings, attendance, governance & more" description also names attendance/governance sub-scores, for which no clean group-level aggregate exists yet; documented gap, not silently dropped.
- ~~Replace the dead `groups.risk_score`/`engagement_score` display with the real computed health score~~ — done (#17). Both `admin/groups` (list badge) and `admin/groups/[id]` (detail card) now read `governance_health_scores`, falling back to "Not yet scored"/"Not yet computed" rather than a fake zero until a group's first monthly run.
- ~~Rebuild the Risk Center's heatmap and alert feed on top of real `governance_alerts` rows~~ — done (#16), with one scope correction from the original plan. The heatmap's Liquidity/Credit columns now read real per-category RAG averages from `governance_snapshots`, replacing the duplicated dead `risk_score` reads and the stale `loans.days_in_arrears` column; the AML column is redesigned to **Capital** (real CAR-based signal) since this schema has no AML/sanctions data source anywhere — inventing one would have been worse than the placeholder it replaced. A new "Governance alerts" card was added with working Acknowledge/Resolve actions on real `governance_alerts` rows. The existing fraud feed and KYC queue action buttons were **not** wired up as originally scoped — on inspection neither is backed by a `governance_alerts`-style row (fraud feed derives from raw `mpesa_transactions`, KYC queue from `groups.onboarding_status`), so there was nothing for those specific buttons to acknowledge/resolve; they remain disabled, unchanged from Phase 0's fix. A real mutation path for those two feeds is a separate, unscoped piece of future work.

### Phase 3 — Search, comparison, geography
- One unified cross-entity search endpoint (organization/group/member by name, phone, membership number), wired into the ⌘K palette and topbar search box that already have the UI shell built and waiting.
- An Organization Comparison view — feasible cheaply once Phase 2's health scores exist, since the financial rollups are already there.
- County/ward-level aggregation using the geographic hierarchy that already exists — start with a sortable table before an interactive map.

### Phase 4 — Analytics/summary architecture (only once real load justifies it)
- Per the optimization audit's own recommendation: don't build a speculative materialized-view layer ahead of demonstrated load. Add a lightweight Redis-backed cache (30-120s TTL) to the heaviest admin aggregate queries first — cheap, reversible, and consistent with this session's general engineering posture of not over-building ahead of measured need. Graduate to real summary tables only if query load actually becomes a problem at higher tenant counts.

---

## 5. What This Audit Did Not Cover

This gap analysis compares the vision to committed source code; it did not measure actual query latency/load against the existing live-aggregation dashboards, did not verify whether any of the `governance_*` seed data has ever been manually populated outside application code, and did not design the specific UI layout for any recommended new page — those are implementation-phase decisions, not audit findings.
