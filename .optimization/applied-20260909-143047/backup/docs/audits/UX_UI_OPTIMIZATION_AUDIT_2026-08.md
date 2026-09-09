# Kitabu Yetu — UI/UX Optimization Audit (2026-08-03)

**Trigger:** user request to "optimize UI and UX for the entire codebase." Scoped via `AskUserQuestion` to: audit-first (not blind fixing), full breadth (member app + enterprise portal, not just high-traffic pages), and 4 depth areas — visual consistency, loading/empty/error states, responsive/mobile layout, flow/navigation clarity.

**Method:** 4 parallel Explore research passes, one per depth area, each covering all 4 route groups (`(dashboard)`, `(enterprise)`, `(admin)`, `(member)`) plus `(auth)` and the public landing page where relevant. This builds directly on — and re-verifies rather than assumes — `UX_UI_AUDIT.md` (2026-07-15, 54/100) and `UX_SURFACE_AUDIT_2026-07.md` (last updated 2026-07-28, 72/100, all 9 roadmap items shipped). Every finding below is traced to a file path; nothing is carried over from a prior report without being re-checked against current code.

**Timing note:** this audit runs immediately after this session's own RBAC permission-activation work (commits `9ec8545`, `6a9615b`) went live — several of the most serious findings below are direct, previously-unflagged consequences of that change, not pre-existing debt.

---

## 1. Executive summary

The design-system adoption numbers from the July audit series are holding steady and slightly growing (`PageHeader` 98%, `PaginatedTable` 58%, `StatCard` 37%, `StatusPill` 63%, across a portal-page count that grew 54→60 as 6 new pages shipped this week) — no regression there, and the prior "quick wins" bucket (404/403 pages, footer, design-system sweeps) is holding.

But this pass surfaced a different, more consequential class of problem the July audits weren't looking for, because it didn't exist yet: **the frontend has zero awareness of the permission model this session just activated.** Money-adjacent action buttons (loan approve/disburse/write-off, investment create, dividend approve) render unconditionally for every role and rely entirely on the API to 403 a user who shouldn't see them — with no client-side gating, no explanatory copy, and (compounding it) list pages that can't tell a permission-denial apart from "this group genuinely has none," because `PaginatedTable` has no `isError` handling at all. This is the single biggest finding in the report: not a cosmetic gap, but a UX regression this session's own backend work quietly introduced.

The second-biggest finding is that **the newly-built `(member)` simplified portal — gated behind real auth just last week — is completely unreachable.** Login unconditionally routes every user to `/dashboard`; nothing in the app links to `/me`. A plain `member`-role user lands in the full officer dashboard, where nearly every nav destination is a permission dead-end, instead of the portal actually designed for their access level.

Third: the exact `catch { setError('generic string') }` anti-pattern found and fixed this session in `workspace-switcher.tsx` (the enterprise-portal group switcher) turns out to have a sibling on the tenant side — `group-switcher.tsx` — with the identical bug, mounted in every dashboard sidebar rather than one portal's header.

Fourth: two real Critical-severity mobile gaps — 46 of 48 dialogs have no scroll safeguard for tall forms on a phone viewport, and the registration form (the primary onboarding flow for a phone-first user base) is the one form in the app with zero responsive grid breakpoints.

None of these four require new architecture — they're wiring/consistency gaps against infrastructure that already exists (`getErrorMessage`, `EmptyState`, the new `permissions` JWT claim, `DialogContent`'s existing max-width convention). That's consistent with this project's whole audit history: the expensive primitives are usually already built, the gap is always adoption.

**Overall UX/product-completeness maturity: 68/100.** Down slightly from the July close-out score (72/100) — not because anything regressed in the design-system sense, but because this pass looked at a dimension (permission-aware UI) that didn't exist as a risk until this week, and found it completely unaddressed at the frontend layer the moment it went live on the backend.

---

## 2. Findings

### Critical

**C1. Client-side UI has zero permission-awareness — money-action buttons render for every role and rely entirely on a silent API 403.**
`app/(dashboard)/loans/[id]/page.tsx:126-169` shows Approve/Reject/Disburse/Mark-defaulted/Write-off unconditionally to any signed-in tenant user, even though the API gates all of them behind `loans.approve` — a permission the `member` role does not hold (`supabase/migrations/20260606140000_077_role_permissions.sql:8-10`). `GET /loans` itself has no permission gate, so a plain member can browse straight to `/loans/[id]` and see fully clickable buttons that will always fail. Identical unconditional rendering confirmed in `app/(dashboard)/investments/page.tsx:115` ("Record Investment") and `app/(dashboard)/dividends/[id]/page.tsx:162-166` ("Approve & snapshot"). A repo-wide grep for role-conditional rendering (`role ===`, `groupRole`, etc.) in `app/` returns only `app/unauthorized/page.tsx` — the entire `(dashboard)` portal was never touched to reflect the RBAC activation. When a 403 does surface, the toast shows the raw internal string from `lib/auth/permissions.ts:28` ("Missing permission 'loans.approve'"), not user-facing copy.

**C2. List/table pages can't distinguish a permission error from genuine emptiness.** `components/shared/paginated-table.tsx` only branches on `isLoading` — it has no `isError`/`error` prop at all, and this is now confirmed to compound C1 directly: a user denied `loans.view`/`members.view` sees "No data found," not an access-denied message. This same gap also produces false-empty states on real fetch failures unrelated to permissions — confirmed on `loans/page.tsx`, `contributions/page.tsx`, `treasury/page.tsx` (all 5 tabs), `dividends/page.tsx`, `shares/page.tsx`, `shares/classes/page.tsx`, `credit-scores/page.tsx`, `sms/page.tsx`, `whatsapp/page.tsx`, and the non-`PaginatedTable` `mpesa/unrouted/page.tsx:93-101` (which on a fetch error literally shows "All receipts are routed. Nothing to review." on an M-Pesa reconciliation screen — actively wrong copy). Zero files in `(admin)` or `(enterprise)` destructure `isError` anywhere — both backoffice portals have no query-error UI at all.

**C3. The `(member)` portal — gated behind real auth as of last week — is unreachable.** Login always does `router.push('/dashboard')` (`app/(auth)/login/page.tsx:84`) regardless of role; no layout does a role-tier redirect. `components/layout/sidebar.tsx`'s nav is identical for every tenant user regardless of permissions held. No file anywhere links to `/me`. Combined with C1/C2: a plain member logs into the full officer dashboard, where most destinations are permission dead-ends, while the simplified portal built for their access level sits completely orphaned.

**C4. `group-switcher.tsx` has the same error-swallowing bug this session already fixed once.** `components/layout/group-switcher.tsx:40-41,59-60` both do `catch { setError('...generic string...'); }` instead of `getErrorMessage(err)` — the exact anti-pattern fixed this session in `workspace-switcher.tsx` (commit `5cbb289`). This component is mounted in every tenant dashboard sidebar, so the real cause of any group-list-load or group-switch failure (401, RLS, network, rate-limit) is invisible to every dashboard user, not just enterprise-portal users.

**C5. The primary dashboard has no loading/error handling at all.** `app/(dashboard)/dashboard/page.tsx` has zero `isLoading`/`isError` handling across its 8 `useQuery`/hook calls — every value defaults via `?? []`/`?? 0`, so the initial fetch and a total fetch failure both render an identical confident "All clear," "No contributions yet," "No repayments due," and `KES 0` stat cards. This is the single highest-traffic screen in the product giving zero signal anything is wrong. `app/(enterprise)/enterprise/page.tsx:45-53,70-75` has the identical gap on the enterprise portfolio landing page. Separately, `analytics/page.tsx:141`, `analytics/risk/page.tsx:84`, and `accounting/page.tsx:722,820,901` use an `isLoading || !data` idiom that produces a **permanently frozen spinner/skeleton** on any query error (never resolves to an error state).

**C6. 46 of 48 dialogs have no scroll safeguard for tall forms on a phone viewport.** `components/ui/dialog.tsx:37`'s base `DialogContent` has no `max-h`/`overflow-y-auto` — only 2 call sites (`members/page.tsx:282`, `members/[id]/page.tsx:480`) add it themselves. Forms tall enough to exceed a ~650px phone viewport with no way to reach Submit: `shares/classes/page.tsx:144` (9-field form), `shares/page.tsx:394` (up to 8 conditional fields), `dividends/page.tsx:150`, `accounting/page.tsx:433` (journal entry with a dynamically-growing line-items table, no cap), `email/templates/page.tsx:96`, `email/campaigns/page.tsx:56`.

**C7. The registration form has zero responsive breakpoints — the one form in the app like this, on the primary onboarding flow.** `app/(auth)/register/page.tsx` uses fixed `grid-cols-2`/`grid-cols-3` (lines 168, 197, 226, 252, 289) with no `sm:`/`md:` collapse, inside a `max-w-md` card with `p-4` page padding — effective content width ~340-380px on a phone. Line 226's `grid-cols-3` (meeting frequency/day/time) leaves ~95px per column, too narrow for a labeled `<select>`. This is the new-user signup flow for a phone-first Kenyan user base.

### High

**H1. Same-page component fork on the admin dashboard.** `app/(admin)/admin/page.tsx` renders "Primary KPIs" with `MetricCard` (`components/admin/metric-card.tsx`) and "Secondary KPIs" with `StatCard` (`components/shared/stat-card.tsx`) on the same screen — two visually different stat-tile components, one screen. `MetricCard` also has 2 other real call sites (`admin/monitoring`, `admin/risk` — not dead code), hardcodes `bg-white`/`text-gray-*` instead of semantic tokens, and its accent palette doesn't map to the app's brand green. Recommend merging `MetricCard`'s `trend`/`accent`/`onClick` capability into `StatCard` rather than maintaining both.

**H2. `(dashboard)`-only root-wrapper double-padding.** The layout's `<main>` already applies `p-4 lg:p-6` (`app/(dashboard)/layout.tsx:56`), but 15 of 37 dashboard pages *also* add `p-6` on their own root div — `analytics`, `analytics/risk`, `credit-scores` (both pages), `data-import`, `dividends` (both pages), `email` (4 pages), `members/import`, `shares` (both pages), `whatsapp`. Neither `(enterprise)` nor `(admin)` ever double this — isolated, unintentional drift specific to `(dashboard)`.

**H3. Raw-blue buttons bypass the brand token.** `sms/page.tsx` builds primary actions as hand-rolled `<button>`s with hardcoded `bg-blue-600` (6 locations) instead of `<Button>`, rendering blue where every other page's primary action is brand green. Same hardcoded-blue override (on the real `<Button>` component) in `admin/page.tsx:81,319` and `admin/support/page.tsx:120`.

**H4. `(enterprise)`'s mobile sidebar is a second, independent implementation.** `app/(enterprise)/layout.tsx:104-164` hardcodes its own drawer/backdrop instead of using `components/shared/portal-sidebar.tsx`, which already centralizes this for `(dashboard)`/`(admin)`. Works today, but won't inherit any future a11y/focus-trap fix applied to the shared component — and Enterprise is the portal most likely opened on a partner's phone.

**H5. Systemic: only 2 places in the whole app check `isError` correctly** (the pattern to replicate, not a new component to build) — `app/(member)/me/goals/page.tsx`, `me/passbook/page.tsx`, `me/page.tsx`, and `contributions/page.tsx`'s members-dropdown sub-query. Everywhere else in H-severity finding C2's list needs the same 3-way branch (`isLoading` → skeleton, `isError` → `EmptyState` + `getErrorMessage(error)`, zero-rows → distinct empty message).

**H6. Inconsistent back-navigation on the Loans detail page.** `loans/[id]/page.tsx:97` uses `router.back()` — every sibling detail page (`dividends/[id]`, `credit-scores/[memberId]`, `analytics/risk`, `mpesa/*`, `members/[id]`) uses a `Link href="/<parent-list>"` instead. A loan link opened from outside the app (an SMS/email repayment reminder) has no history to fall back on and dead-ends.

**H7. ~15 more in-page forms/grids repeat the unresponsive `grid-cols-2`/`grid-cols-3` pattern** without the `sm:` prefix the 2026-07-16 responsive retrofit used elsewhere: `sms/page.tsx` (3 locations), `meetings/page.tsx`, `welfare/page.tsx` (2), `members/[id]/page.tsx` (2), `organization/page.tsx` (2), `admin/organizations/[id]/page.tsx` (4), `admin/groups/[id]/page.tsx` (3), `admin/groups/[id]/members/[memberId]/page.tsx` (4). The July retrofit fixed 11 files but wasn't exhaustive — these are the remainder.

### Medium

**M1. `credit-scores/[memberId]/page.tsx:112`** conflates a real query error with a legitimate business state (`noScoreYet = latestQ.isError`) — an actual API failure renders identically to "not scored yet."

**M2. Color-token drift is broad**: raw `text-gray-*`/`bg-white`/`bg-gray-*` (bypassing `text-muted-foreground`/`bg-card`) spans all of `email/*`, `sms`, `mpesa/reconciliations`, `welfare`, and all 15 admin pages. Longstanding, not new, but still the dominant visual-consistency gap by file count.

**M3. Welfare approve/reject has no confirm step and no amount input.** `welfare/page.tsx:298-320`'s "Quick review" dialog fires `onApprove(reviewId, 0)` directly on click — no `ConfirmDialog`/`MoneyActionDialog`, and approval always records `amountApproved = 0` (likely a functional bug beyond the UX gap). Contrast: this week's new `enterprise/disbursements/page.tsx` approve flow correctly uses `MoneyActionDialog` and requires a typed reason to reject — the new work got this right, the pre-existing welfare flow didn't.

**M4. Fake identity/notification affordances in the enterprise portal.** `app/(enterprise)/layout.tsx:177` hardcodes an "EA" avatar for every user; the notification bell has no handler and permanently shows an unread dot.

**M5. Inconsistent confirmation UX.** `data-import/page.tsx:145` uses native `window.confirm()` for rollback while the rest of the app uses the styled `ConfirmDialog`.

**M6. `PaginatedTable` has a horizontal-scroll wrapper but no column-hiding/card-view fallback** — every wide table (`members/page.tsx` 7 columns, `admin/users/page.tsx` 9 columns, `treasury/page.tsx` multiple 6-column tables) inherits the same "scroll sideways" experience with no responsive reflow. Not breakage (every hand-rolled `<table>` elsewhere does correctly wrap in `overflow-x-auto`) — a UX-quality gap, not a bug.

**M7. Touch-target issue on financial tables**: truncated cells (`treasury/page.tsx`, `sms/page.tsx`) hide content behind a `title=` tooltip, which doesn't work on touch — no tap-to-expand affordance for a failure reason or remarks field.

### Low

**L1.** The one `PageHeader`-less page (`members/[id]/page.tsx`) uses `text-xl` for its title vs. every `PageHeader` page's `text-2xl` — the only heading-scale deviation found.

**L2.** Several detail pages (`dividends/[id]`, `credit-scores/[memberId]`) show a bare centered spinner with no skeleton shape, visually inconsistent with the `Skeleton`/`ListSkeleton` pattern used elsewhere.

**L3.** Search/filter `min-w-[200px]` boxes are all correctly inside `flex flex-wrap` rows (no overflow). One `min-w-[150px]` absolute-positioned dropdown (`mpesa/reconciliations/page.tsx:81`) could clip against a very narrow viewport edge — minor, isolated.

### Positive notes (confirmed, not assumed)

- `PageHeader` adoption held at 98% (59/60) as the portal-page count grew from 54 to 60 this week; all 6 pages shipped this week correctly use it from day one.
- The 3-way "Organization" naming collision flagged across two prior audits is now genuinely resolved: admin's "Organizations" registry, dashboard's "Funding Portal," and "Kitabu Enterprise" branding read as distinct concepts.
- This week's own new enterprise-disbursements approve/reject flow got confirmation UX right on the first try (`MoneyActionDialog`, typed-reason-required reject) — the newest code in the app is not where the gaps are concentrated.
- `Skeleton`, `EmptyState`, `getErrorMessage`, and per-route `error.tsx` all exist, are well-built, and cover all 4 route groups at the boundary level — every finding above is an adoption gap at the `useQuery` call site, not a missing primitive.
- Dashboard/Admin sidebars (shared `PortalSidebar`) handle mobile correctly — real off-canvas drawer, backdrop, focus handling. This is the good baseline `(enterprise)` (H4) should migrate onto.
- Admin's group→member drill-down has proper full breadcrumb trails; the data-import wizard's phase machine (idle→preview→commit→result with discard/rollback) is well built.

---

## 3. Roadmap

Ordered by leverage, not by finding number — permission-UI and the two mobile Criticals come first since they're either actively regressive (permission UI, shipped this week with no frontend counterpart) or affect the highest-traffic/highest-stakes flows (dashboard home, registration).

**Phase 1 — Close the RBAC/UX gap this session's own backend work opened (C1, C2, C3, H6)**
Add client-side permission awareness: gate action buttons on `auth.permissions` (already carried in the JWT/`x-permissions` header — no new plumbing needed, just reading it in components), give `PaginatedTable` an `isError` prop with a distinct "you don't have access" vs. "fetch failed" vs. "genuinely empty" 3-way render, and route login by role-tier so `member`-only users land in `(member)` instead of the full officer dashboard. This is the single highest-leverage fix in the report: it closes a real, currently-live confusing-dead-end experience for the `member` role, which per the RBAC audit is the most numerous role in the system.

**Phase 2 — Loading/error state rollout (C5, H5, M1)**
Replicate the already-correct `(member)`/`contributions` 3-way branch pattern onto the dashboard home page and enterprise portfolio page first (highest traffic), then the `isLoading || !data` frozen-spinner sites (`analytics`, `analytics/risk`, `accounting`), then the remaining `PaginatedTable`-consumer list pages from C2.

**Phase 3 — Mobile Criticals (C6, C7)**
Add a `max-h-[85vh] overflow-y-auto` default to the base `DialogContent` (fixes all 46 unprotected dialogs in one change, only the 2 already-overridden call sites need review for double-application) and add `sm:`/`md:` responsive collapse to the registration form's grids.

**Phase 4 — Same-session error-swallowing fix (C4)**
Fix `group-switcher.tsx`'s two `catch` blocks exactly like `workspace-switcher.tsx` was fixed this session — mechanical, ~10-line change, same file shape.

**Phase 5 — High-severity consistency cleanup (H1-H4, H7)**
Merge `MetricCard` into `StatCard`; strip the 15 files' double `p-6`; convert `sms`/`admin` hardcoded-blue buttons to the `<Button>` primary variant; migrate `(enterprise)`'s sidebar drawer onto `PortalSidebar`; sweep the remaining ~15 unresponsive grids.

**Phase 6 — Medium/Low polish (M1-M7, L1-L3)**
Welfare approve/reject confirm-dialog + amount input (flag as a possible functional bug, not just UX, given `amountApproved` always records 0 — needs a decision on whether this is a regression or an as-designed placeholder before touching it); enterprise fake avatar/notification-bell cleanup; `window.confirm()` → `ConfirmDialog` in data-import; broad `text-gray-*` → semantic-token sweep (largest file count, lowest urgency); `PaginatedTable` responsive column/card-view story (bigger lift, worth scoping separately given it touches 30+ consumers); remaining Low items.

Phases 1-4 are all wiring against infrastructure that already exists and are independently shippable/verifiable in the same batched, risk-ordered style this project's audit series has used throughout (see `[[project-kitabu-yetu-audits]]`) — recommend sequencing them in that order and getting a green CI + user sign-off after each phase before starting the next, exactly like the RBAC activation work just completed.

---

## 4. Implementation status (2026-08-04)

**All six phases are implemented; every finding in §2 is now closed.** M3 turned out not to need the product decision it was flagged for — the server code answers it, and the finding as written understated the bug (see Phase 6). Verified green locally after each phase: `eslint .` clean (0 errors, 0 warnings), `tsc --noEmit` clean, `jest --ci` 361/361 passing across 44 suites, `next build` succeeds.

### Phase 1 — RBAC/UX gap (C1, C2, C3, H6) — done

- **C1** — new `lib/auth/use-permission.ts` exposes `useHasPermission(permission)` / `useHasOrganizationPermission()`, wrapping the *same* `lib/auth/permissions.ts` helper the API enforces with, so the client can never drift from the server's permission strings. It re-derives `effectiveRole` the way login/refresh do (`platformRole === 'super_admin'` wins over `groupRole`), because `TenantUser.groupRole` is not overridden for super admins client-side. The `permissions` claim — already signed into the access token — is now also returned on the login/switch-group member payload (`types/api.types.ts`, `app/api/v1/auth/login/route.ts`, `app/api/v1/auth/switch-group/route.ts`) and carried on `TenantUser` (`lib/auth/context.tsx`), so no JWT decoding is needed in components. It is declared optional so pre-rollout `localStorage` payloads still parse. Action buttons are now gated in `loans/[id]`, `investments`, `dividends` + `dividends/[id]`, `shares` + `shares/classes`, `welfare`, `meetings`, `members/import`, and all four `accounting` policy panels. **Gating is a UX affordance only — the API remains authoritative; a stale client value can at worst show a button that still 403s, never grant access.**
- **C2** — `PaginatedTable` gained `isError` / `error` props rendering an `EmptyState variant="error"` with `getErrorMessage(error)`, and `EmptyState` gained an `error` variant (red icon tint) so a failure never looks like "nothing here yet." Rolled out to **every** query-backed consumer across all four route groups: 7 admin pages, 4 enterprise pages, and `accounting`, `contributions`, `credit-scores`, `dividends` + `[id]` (both preview and allocations tables), `email/logs`, `investments`, `loans`, `meetings`, `members`, `mpesa`, `mpesa/reconciliations`, `organization`, `shares` (all 3 tabs), `shares/classes`, `sms`, `treasury`, `welfare`, `whatsapp`. Deliberately skipped: `data-import`, `members/import` and `enterprise/api-keys` (local state, no query), `analytics/risk` and `loans/[id]` (already branch on error at page level above the table).
- **C3** — new `lib/auth/post-login-path.ts` routes a plain `member` to `/me` and everyone else to `/dashboard`, applied at fresh login, at the already-authenticated redirect, and at group-switch time (switching groups can change which role applies). `(member)/layout.tsx` gained a "Full dashboard" link so the reverse path stays reachable — an officer who holds plain `member` status in one group must not be trapped in the simplified portal.
- **H6** — `loans/[id]`'s `router.back()` replaced with a `Link` to `/loans`, matching every sibling detail page, so a loan opened from an SMS/email reminder no longer dead-ends.

### Phase 2 — Loading/error states (C5, H5, M1) — done

`dashboard/page.tsx` and `enterprise/page.tsx` now branch 3-way instead of rendering a confident "All clear" / `KES 0` over a failed fetch. The `isLoading || !data` frozen-spinner idiom is gone from `analytics`, `analytics/risk`, and `accounting` — an error now resolves to an error state rather than spinning forever. **M1** is fixed narrowly and correctly: `credit-scores/[memberId]` now treats *only* a 404 (the service's `NotFoundError`) as "never scored" and renders a real retryable error for anything else, so a 403/500/network failure no longer offers a "Recompute now" CTA that will fail identically. `mpesa/unrouted` no longer tells a treasurer "All receipts are routed. Nothing to review." when the fetch simply failed.

### Phase 3 — Mobile Criticals (C6, C7) — done

- **C6** — `max-h-[85dvh] overflow-y-auto` added to the base `DialogContent`, fixing all 46 unprotected dialogs in one change. `dvh` rather than `vh` so a mobile browser's collapsing address bar can't push the submit footer off-screen. The 2 call sites that already set their own `max-h-[90vh]` are unaffected — `cn()` is `twMerge`, so a call-site value still wins.
  *Known trade-off:* the close ✕ is `absolute`-positioned inside what is now the scroll container, so on a dialog scrolled far down it scrolls out of view. Esc and overlay-click still dismiss, and the dialog opens at scroll-top. Pinning it needs a layout change to `DialogContent`'s grid and was left out of this batch — it is strictly better than the current state, where tall forms have no reachable Submit at all.
- **C7** — the registration form's five grids now collapse to a single column below `sm:` (`grid-cols-1 sm:grid-cols-2` / `sm:grid-cols-3`). The five `col-span-2` children were changed to `sm:col-span-2` — an unscoped `col-span-2` inside a 1-column grid creates an *implicit* second column and would have silently defeated the fix. The `max-w-md` container was intentionally left alone: it lives in the shared `(auth)/layout.tsx` and widening it would change login and password-reset too.

### Phase 4 — Error-swallowing (C4) — done

`group-switcher.tsx`'s two `catch { setError('generic string') }` blocks now use `getErrorMessage(err)`, matching the `workspace-switcher.tsx` fix. It also routes through `postLoginPath` after a switch (see C3).

### Phase 5 — High-severity consistency cleanup (H1-H4, H7) — done

- **H1** — `MetricCard` is deleted. `StatCard` absorbed its three distinguishing capabilities: `accent` (icon-bubble tint, defaulting to brand green), `loading` (renders a `Skeleton` in place of the value), and `onClick`. All 12 call sites across `admin`, `admin/monitoring` and `admin/risk` moved over, with MetricCard's `sub` mapping to StatCard's existing `description`. Two things improved rather than being ported as-is: MetricCard hardcoded `bg-white`/`text-gray-*` and an uppercase title, which are gone in favour of `Card` + semantic tokens; and its `onClick` lived on a plain `<div>`, which was not keyboard-focusable — `StatCard` renders a real `<button>` carrying the card classes, so drill-down tiles are now reachable by Tab and activate on Enter/Space. The admin dashboard's hand-rolled "Organizations" tile — the third stat-tile shape on that one screen — was folded into `StatCard` too, so "Primary KPIs" and "Secondary KPIs" are now one component.
  *Deliberately out of scope:* ~25 existing `iconClass="bg-*-50"` call sites still tint only the bubble background while the icon stays brand green. That is unchanged pre-existing behaviour, not a regression from this merge; converting them to `accent` is a follow-up sweep on pages this audit did not flag.
- **H2** — the redundant `p-6` is gone from all 15 dashboard pages that were doubling `(dashboard)/layout.tsx`'s `p-4 lg:p-6`. Neither `(enterprise)` nor `(admin)` was affected, as the audit found.
- **H3** — zero `bg-blue-600` remain outside deliberate non-button uses. `sms/page.tsx`'s six hand-rolled `<button>`s are now `<Button>`, which also means they pick up the shared `loading` spinner and `disabled` handling instead of open-coding `disabled:opacity-50`; its recipient segmented control now uses `bg-primary`/`text-primary-foreground` rather than raw blue. The three `<Button className="bg-blue-600 hover:bg-blue-700">` overrides in `admin/page.tsx` (×2) and `admin/support/page.tsx` were simply dropped so the brand default applies. Left alone as intentional non-button colour: the `UPDATE` activity-dot maps, avatar circles, the `Switch` checked state, `admin/monitoring`'s live-toggle, and the credit-score tone ramp.
- **H4** — `(enterprise)/layout.tsx` no longer hand-rolls a drawer. `PortalSidebar` gained a third `brand` variant (brand green on semantic tokens, versus the two staff-facing grey variants) and a `soon` nav-item flag ported from the enterprise sidebar's disabled-with-"Soon"-pill row, and the enterprise portal now renders through it. **Side effect worth calling out: the shared footer gives the enterprise portal a Sign out control, which it previously had nowhere at all** — not in the sidebar, not in the header, not in the workspace switcher.
- **H7** — the 13 remaining fixed-column **form-field** grids (labelled `Input`/`select` pairs) now collapse below `sm:`, in `sms` (×3), `meetings`, `welfare` (×2), `members/[id]`, `organization` (×2), `investments`, and `admin/organizations/[id]` (×2). As with the registration form, the four `col-span-2` children inside `members/[id]`'s next-of-kin grid had to become `sm:col-span-2` — unscoped, a span-2 child of a 1-column grid creates an implicit second column and silently defeats the collapse.
  *Deliberately left at two columns:* the read-only label/value data grids in `members/[id]` (the `dl` block), `admin/groups/[id]`, `admin/groups/[id]/members/[memberId]`, and `admin/organizations/[id]`. These are short `text-xs`/`text-sm` value pairs that stay legible at ~160px and stacking them would double the height of those detail panels for no readability gain. Also untouched: 3-column compact stat rows, `TabsList` grids, the recovery-code grid, and `quick-actions`' icon grid — all deliberately fixed-column.

### Phase 6 — Medium/Low polish (M2-M7, L1-L3) — done

- **M2 (colour tokens)** — swept the tenant-facing surfaces the finding named: `sms`, all of `email/*`, `mpesa/reconciliations`, `welfare`, and `components/dashboard/sms/shared.tsx`. 88 replacements (`text-gray-400/500/600` → `text-muted-foreground`, `700/800/900` → `text-foreground`, `bg-white` → `bg-card`, `bg-gray-*` → `bg-muted`, `border-gray-*` → `border-border`, `focus:ring-blue-500` → `focus:ring-ring`). **`app/(dashboard)` now contains zero raw greys.** One case needed a hand fix the mechanical map got wrong: `text-gray-400 hover:text-gray-600` collapsed into `text-muted-foreground hover:text-muted-foreground`, a no-op hover, corrected to `hover:text-foreground`.
  *Deliberately excluded, and this is a judgement call worth revisiting rather than an oversight:* the 15 admin pages and `portal-sidebar.tsx`'s `V.light`/`V.dark` maps. The audit counted them in M2's footprint, but the backoffice is a deliberately distinct "grey/red staff console" (`(enterprise)/layout.tsx` documents that contrast explicitly), and `portal-sidebar.tsx`'s variant classes are documented as keyed verbatim from the originals so the merge stays invisible. Converting those greys would restyle the admin console rather than fix drift — it needs a design decision first, not a regex.
- **M4** — the enterprise notification bell is gone rather than wired up: it had no handler, a permanently-lit unread dot, and there is no `/enterprise/notifications` route to point it at. A control that always looks like it has news and never does is worse than no control. The hardcoded "EA" avatar now renders the signed-in user's own initials, with their name and email beside it above `sm:`.
- **M5** — the audit flagged `data-import`'s `window.confirm()`; a repo grep found **three more** (`members/import` rollback, `credit-scores` recompute-all, next-of-kin removal). All four now use `ConfirmDialog`, the destructive ones with `variant="danger"`. Beyond styling, this matters because some mobile browsers let the user suppress native dialogs entirely — which would silently skip the guard on a destructive action rather than blocking it.
- **M6** — `PaginatedTable` columns gained `hideBelow?: 'sm' | 'md' | 'lg'`, dropping secondary columns at narrow widths instead of forcing the whole table sideways. Applied to the two widest tables: `members` (7 columns — keeps select/name/phone/status at every width) and `admin/users` (9 columns — keeps user/platform-role/status/actions). The breakpoint classes are written as whole static strings because Tailwind's scanner reads source literally; a built-up `hidden ${bp}:table-cell` would never reach the stylesheet. Opt-in per column, so the other ~30 consumers are unchanged.
- **M7** — new `components/shared/expandable-text.tsx` replaces `truncate` + `title=` on the five affected cells (`treasury` failure reason and remarks, `sms` template body and log message, `whatsapp` body). A `title` tooltip needs hover, so on a phone the hidden half of a failure reason was simply unreachable. It clamps to N lines and becomes a tap target **only when the content actually overflows** — measured, not assumed, because a control that looks interactive but does nothing is a smaller version of the same problem.
- **L1** — `members/[id]`'s `text-xl` title is now `text-2xl`, matching every `PageHeader` page.
- **L2** — the bare centred spinners on `dividends/[id]` and `credit-scores/[memberId]` are now `Skeleton` blocks shaped like the content that follows.
- **L3** — `mpesa/reconciliations`' absolutely-positioned dropdown gained `max-w-[calc(100vw-2rem)]` so it cannot clip past a narrow viewport edge, and moved off `bg-white` onto `bg-popover`.

### M3 — resolved, and the original finding was wrong about the severity

**Correction to §2's M3.** The finding said approval "always records `amountApproved = 0`" and flagged it as needing a product decision on whether `0` was a regression or a placeholder. Reading the server side settles it, and it is worse than recorded:

- `ReviewWelfareRequestSchema` (`lib/services/welfare.service.ts:20`) declares `amountApproved: z.coerce.number().positive().optional()`. `0` is **not** positive, so `ReviewWelfareRequestSchema.parse(body)` in `app/api/v1/welfare/[id]/route.ts:29` throws and the request 400s.
- Nothing was ever recorded as `0`. **The Quick Review approve button could not approve anything at all** — it failed on every click, for every user, and surfaced only as a generic error toast.
- The service already documents the intended default: `data.amountApproved ?? req.amount_requested` (line 155) — omitting the field approves the full requested amount.

So there was no product question to answer: `0` was never a designed placeholder, it was a value the API cannot accept. Fixed without needing a decision:

- The review dialog now holds the whole `WelfareRequestRow` rather than just an id, and shows what is being decided (title, type, member, requested amount).
- **Approve** takes an explicit amount, pre-filled with the full request and editable down for a partial award, guarded client-side on `> 0`. This matches the service's own fallback semantics instead of fighting the validator.
- **Reject** required a typed reason of at least 5 characters. It previously hardcoded `rejectionReason: 'Declined by officer'`, so the audit trail recorded *that no matter why the request was actually declined* — a second, unflagged bug in the same handler. This now matches the enterprise-disbursements flow §2 praised.
- Both actions moved into a `DialogFooter` with a Cancel, share a `reviewBusy` lock, and the dialog can't be dismissed mid-flight.

*Worth noting for the audit series:* this is the second finding in this report whose stated behaviour didn't survive contact with the server code (the first being M1, where "any error" turned out to need narrowing to a 404). Both were originally written from the client side only. A `.positive()` on a Zod schema is not visible from the call site, and neither was.

### Verification not yet done

None of this has been exercised against a running app or a real `member`-role session — the evidence for every phase above is static: `eslint .` clean, `tsc --noEmit` clean, `jest --ci` 361/361 across 44 suites, `next build` succeeds. **The vast majority of this work is visual, and nothing in the test suite renders any of it.** Worth a manual pass before this is considered closed, roughly in risk order:

1. **C1/C3** with an actual plain-`member` login — the only change here that alters where a user lands and what they can see.
2. **The Phase 6 colour sweep** (`sms` especially, 66 of the 88 replacements) — a mechanical map applied across whole files; one no-op hover was caught by grep afterwards, and only eyes on the page will catch a flattened hierarchy the grep can't see.
3. **The enterprise portal** — it changed shell (H4), lost its bell, and gained a Sign out in one pass.
4. **H1's interactive `StatCard`** — the admin KPI tiles are now `<button>`s; worth confirming they still look like cards rather than form controls.
5. **M6's `hideBelow` breakpoints and C6's dialog scroll cap** on a real phone viewport, not just a resized desktop window.
