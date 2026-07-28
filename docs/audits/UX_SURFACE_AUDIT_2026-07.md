# Kitabu Yetu — UX Surface Audit (Follow-up to UX_UI_AUDIT.md)

**Original date:** 2026-07-27
**Updated:** 2026-07-28 — re-verified against everything shipped since, including two entirely new features (404/403 pages, footer fixes, three design-system adoption sweeps, login cosmetics) and one major piece of new architecture (multi-staff organizations, Phases 1 & 2) that wasn't on this audit's radar at all.
**Trigger (original):** The user supplied a large, generic "complete UI/UX refactor" prompt written for a hypothetical fintech SaaS, not derived from this codebase. This audit exists to separate what's real from what the prompt assumed.
**Method (this update):** Two parallel source-grounded research passes re-verifying every claim in the original report against current code (not trusting the original's numbers), plus a targeted pass on how multi-staff organizations interacts with the previously-flagged "Organization" naming collision and auth architecture. Every claim below is traced to a file path; items marked **unchanged** were re-confirmed, not assumed.

---

## 1. Executive summary

A great deal shipped in the 24 hours since the original audit — most of it directly off that audit's own roadmap:

- **All three "quick, high-leverage" items are done.** Global `404`/`unauthorized` pages exist and are correctly wired into every layout guard (this also fixed a real bug: authenticated-but-wrong-role users used to bounce back into a login dead-loop). The footer's two dead links are gone — in fact 10 of 16 links were dead, not 2, and all are now fixed. Login cosmetics (password-visibility toggle, remember-me) shipped too.
- **The design-system adoption sweep — the single most consequential number in the original report — moved hard.** `PageHeader` went from 22% to 98% (53/54 pages). `PaginatedTable` went from 22% to 56%. `StatCard` went from 4% to 35%. `StatusPill`, notably, did **not** move (still 13/54, 24%) — it wasn't part of any sweep and is now the least-adopted of the four.
- **A major new capability shipped that wasn't on this audit's roadmap at all: multi-staff organizations** (two phases, PRs #4 and #5). This retires the original audit's premise that "organizations are single-coordinator, no multi-user-per-org concept exists" — that's now false. But it validates the audit's *conclusion*: the team built the multi-user reality using the exact same "picker step on the existing login page" pattern the consumer `/login` already uses for multi-group members, not a separate branded "Organization Login" surface. The original recommendation not to build one was correct, and was followed.
- **The one gap this audit called "the single most serious auth gap the generic prompt didn't even ask about" is still completely untouched**: `(member)` has no auth guard and still runs on mock data. Zero of the last day's six commits touched it.
- **The newly-shipped invite feature introduces its own real UX gap**: once an admin sends a staff invitation, it vanishes — there's no way to see whether it's pending, expired, or to resend/cancel it. This is exactly the class of "missing state" this audit style exists to catch, just in code that didn't exist yesterday.
- A pre-existing component, `components/enterprise/workspace-switcher.tsx`, carries a doc comment claiming "a coordinator belongs to exactly one organization... no real multi-workspace switching to build" — multi-staff organizations makes that comment **factually wrong** as of migration 101, and nobody updated it. The component's behavior isn't broken (it correctly shows the one org chosen at login), but a future engineer reading that comment would be misled, and there is genuinely no way to switch orgs mid-session anymore despite the backend now supporting it.

**Overall UX/product-completeness maturity: 72/100** — up from 60/100. The jump reflects real, verified shipped work closing nearly the entire "quick wins" bucket and a large share of "medium," plus a substantial architecture upgrade (multi-staff orgs) that wasn't even asked for. The score isn't higher because the single worst gap in both this and the prior audit — `(member)`'s missing auth guard — remains completely unaddressed, and the new invite feature introduced a fresh gap of its own.

---

## 2. What's shipped since 2026-07-27

| Original roadmap item | Status | Evidence |
|---|---|---|
| #1 Fix 2 broken footer links | **Done — turned out to be 10 of 16 dead, not 2** | `components/landing/footer.tsx:5-10` (comment cites the audit directly), 11-33. All 13 remaining links resolve to real pages/anchors; Legal pages (Privacy/Terms/Cookies) deliberately omitted rather than stubbed with fake content for a product handling real money/PII |
| #2 Global `not-found.tsx` + 403 page | **Done, and fixed a real bug in the process** | `app/not-found.tsx`, `app/unauthorized/page.tsx` (comment at lines 14-17 documents the login-bounce dead-end it fixes). `app/(admin)/layout.tsx:45-58` and `app/(enterprise)/layout.tsx:65-77` both now route authenticated-but-wrong-role users to `/unauthorized`, not back to `/admin-login` |
| #3 Gate `(member)` behind real auth | **Not started** | `app/(member)/layout.tsx:16-19` — comment unchanged: *"in production this group should be wrapped with the same auth guard as (dashboard)... It's left ungated here so the UI is reviewable in isolation."* Line 6 still imports mock data from `./_data`. None of the last day's commits touched this file |
| #4 `PageHeader`/`PaginatedTable` sweep | **Done for PageHeader (98%), substantial for PaginatedTable (56%)** | See §6 below for full counts |
| #5 `StatCard` sweep | **Done (35%, up from 4%)** | See §6 |
| #6 Extend `EmptyState` to core lists | **Not started — net +1 file, and that file isn't a core list** | Still 0 matches in `members`, `loans`, `contributions`, `admin/organizations`, `admin/groups` list pages. The only two new `EmptyState` usages are the new `not-found.tsx`/`unauthorized/page.tsx` themselves |
| #7 Resolve "Organization" naming collision | **Partially — via wayfinding, per the user's own decision, not a rename** | See §3 below — one part of the collision was already independently fixed, one part got a wayfinding note, and multi-staff orgs left a stale doc comment behind |
| #8 Decide "Organization Login" / "Field Officer" | **Decided and acted on** | Field Officer: confirmed dropped, zero references anywhere including the two brand-new migrations (grep-verified). Organization Login: multi-staff orgs shipped as real architecture, but deliberately using the existing `/admin-login` + picker pattern, not a new branded surface — see §3 |
| #9 Self-service forgot-password | **Not started, but no longer blocked** | `app/(auth)/forgot-password/page.tsx:27-36` still just toasts "contact your group admin," never calls a reset endpoint. Its own comment (lines 28-30) says self-service can be wired "once the SMS OTP endpoint is live" — **that's no longer true**: this project now has *two* proven, production email/SMS-OTP implementations (`group-verification.service.ts`, and the org-invitations flow built this week) to reuse. This is now a wiring task, not new invention |
| #10 Password toggle / remember-me | **Done on `/login`; toggle-only on `/admin-login` (reasonable)** | `app/(auth)/login/page.tsx`: `showPassword` state + toggle (lines 47, 168, 173-181), `rememberMe` + `localStorage` (lines 36, 48, 64-70, 81-82, 186-194). `app/(auth)/admin-login/page.tsx`'s `PasswordForm`: toggle only (lines 255, 273, 277-285) — no remember-me, arguably correct for a 2FA-gated staff portal |
| #10 (cont.) Dark-mode on `(auth)` | **Unchanged, still missing — but now confirmed not an isolated gap** | `app/(auth)/layout.tsx:5` still hardcodes a light gradient with zero `dark:` classes. Repo-wide: **zero** `dark:` classes anywhere in `app/(auth)/**`, and no `ThemeProvider`/`next-themes` wiring anywhere in the app at all — this was never actually reachable, platform-wide, not an `(auth)`-specific oversight |
| #11 Payment-result screens | **Not re-verified this pass — no signal it was touched** | — |
| #12 Invitation-expired / subscription-expired states | **Invitation-expired: now effectively resolved for org invites. Subscription-expired: still open** | `app/(auth)/accept-org-invite/[token]/page.tsx`'s `error` step explicitly handles expired/invalid tokens with real copy, not a blank state. `billing/page.tsx`'s lapsed-subscription gap wasn't re-checked this pass |

---

## 3. Multi-staff organizations vs. the "Organization" naming collision

This wasn't on the original roadmap — it grew out of a separate conversation about the naming collision itself, where the user decided (a) keep "Enterprise" as its own brand rather than rename anything, fix wayfinding instead, and (b) multi-staff-per-organization accounts are a real, worth-building feature (unlike "Field Officer," which was dropped). Now that both phases have shipped, here's how it actually landed:

**Is "Organization Login via domain/code" real now?** The *premise* the original audit dismissed this on ("single-coordinator, no multi-user-per-org concept... would be new product architecture") is now false — `organization_members` (migration 101) genuinely allows many people to be staff at one org, and one person to staff several. But the *conclusion* still holds: `app/(auth)/admin-login/page.tsx`'s `Phase` union just gained a fourth variant, `chooseOrg` (lines 51-55), appended to the existing password/enroll/verify phases — same file, same `Card`, same route. `app/api/v1/auth/admin/login/verify/route.ts:95-123` only returns `NeedsOrgSelection` when a person actively staffs more than one org; otherwise login behaves exactly as before. This is structurally identical to the consumer `/login`'s existing multi-group picker (`isGroupSelectionNeeded` → `pendingGroups`), right down to having the same "← Back to sign in" escape hatch (`admin-login/page.tsx:225-231` vs. `login/page.tsx:126-132`). So: the data model changed, the recommendation not to build a separate branded login surface was followed anyway, and it was the right call.

**Is the three-way collision resolved?** Two-thirds of it, yes — independently of this audit:
- `(dashboard)/organization` is labeled "Funding Portal" in-app (`app/(dashboard)/organization/page.tsx:3-17`), specifically so it isn't confused with the admin registry or the B2B "Workspace" concept.
- `(enterprise)`'s sidebar identity card was already converted from a fictional multi-org federation picker to a single-org identity card in earlier work.
- `(admin)/admin/organizations/[id]` carries the wayfinding note the user asked for, now living under the new Staff card: *"Staff sign in and manage this organization... through the separate Kitabu Enterprise portal — same organization, a different sign-in"* (`page.tsx:347-352`).

**What multi-staff orgs left behind, unresolved:** `components/enterprise/workspace-switcher.tsx:14-23`'s doc comment — *"A coordinator belongs to exactly one organization... so there is no real multi-workspace switching to build"* — is now contradicted by the very login route it cites (`admin/login/verify/route.ts:97-99`: *"A member can be active staff at more than one organization... this can return 0, 1, or many rows"*). The component's actual behavior isn't broken (it shows the one org chosen at login, scoped server-side into the JWT), but:
1. The comment actively misleads anyone reading it about the current data model.
2. There is genuinely no in-app way to switch organizations mid-session anymore — a person who leads two orgs has to fully re-login and re-pick to switch, even though the backend now has everything needed for a real in-app switcher. Whether to build one is a product call, not a bug — see the roadmap.

---

## 4. IA / missing-surface table (re-verified)

| Surface | Status (2026-07-27) | Status (2026-07-28) |
|---|---|---|
| 404 page | Missing | **Fixed** — `app/not-found.tsx` |
| 403 / unauthorized page | Missing | **Fixed** — `app/unauthorized/page.tsx`, correctly wired |
| Maintenance-mode page | Missing | Not re-verified, no signal it was touched |
| Empty states (core lists) | Partial, 7 files, none of the core lists | **Unchanged in substance** — 8 files now, but the +1 is `not-found`/`unauthorized` themselves, not a core list |
| Offline-mode handling | Member-portal-only | Not re-verified |
| "Coming soon" pattern | Partial | Not re-verified |
| Invitation-expired state | Missing | **Resolved for org invites** — `accept-org-invite/[token]/page.tsx`'s `error` step |
| Subscription-expired state | Missing | Not re-verified |
| Payment-failed/successful state | Partial (status badges only) | Not re-verified |
| **New: pending-invitation visibility** | *(didn't exist yet)* | **Missing** — see §5 |

---

## 5. New gap introduced by this week's own shipped work

The admin Staff card (`app/(admin)/admin/organizations/[id]/page.tsx:307-354`) reads exclusively from `listOrgStaff()` (`lib/services/organization-members.service.ts:101-114`), which only ever queries `organization_members`. There is no equivalent function querying `organization_invitations`, no hook in `hooks/use-admin.ts`, and no API route for listing/resending/cancelling an invite. Concretely: an admin clicks "Send invite" (`page.tsx:442-478`), and from that moment the invitation is invisible — no way to tell whether it's still `invited`, `otp_sent`, `verified`, expired, or to resend it if the email never arrived or bounced. This is precisely the kind of missing-state gap this audit series exists to catch, just in code that shipped in the last 24 hours rather than months ago.

Two smaller gaps in the same feature:
- `accept-org-invite/[token]/page.tsx`'s password step has two password fields (new + confirm) and, unlike its siblings on `/login` and `/admin-login`, no visibility toggle — arguably matters more here, not less, given there are two fields to keep in sync.
- No "this isn't me" / decline path on the invite-acceptance page itself — only expiry or a hard server error routes to the `error` state. A wrong-email invite or a change of mind has no graceful exit today.

---

## 6. Design-system adoption (re-verified — 54 portal pages: 37 dashboard + 14 admin + 3 enterprise)

| Component | 2026-07-27 | 2026-07-28 (AM) | 2026-07-28 (PM) |
|---|---|---|---|
| `PageHeader` | 12/54 (22%) | 53/54 (98%) | 53/54 (98%) |
| `PaginatedTable` | 12/54 (22%) | 30/54 (56%) | **31/54 (57%)** |
| `StatCard` | 2/54 (4%) | 19/54 (35%) | **21/54 (39%)** |
| `StatusPill` | 13/54 (24%) | 13/54 (24%) — unchanged | **35/54 (65%) — first-ever sweep, now the best-adopted of the four** |

Roadmap item 7 (this session): converted 5 remaining raw-`<table>` pages to `PaginatedTable` (treasury's 3 tables, email logs, accounting's trial balance), 5 remaining hand-rolled stat-tile grids to `StatCard`, and ran `StatusPill`'s first-ever sweep across 27 files (39 individual badge call sites). Deliberately left hand-rolled, same discipline as before: tiles/badges whose color is a genuine conditional signal (`StatCard`'s `value` still can't carry per-instance color even via `iconClass`) — investments' ROI tile, credit-scores' policy-source indicator (not a lifecycle status at all), two import-page error-count tiles, and the small handful of `PaginatedTable` skips already documented above (heatmap, `tfoot` totals rows, sticky+animation widget, inline-editable settings tables keyed by non-`id` fields).

The one page still without `PageHeader` is `app/(dashboard)/members/[id]/page.tsx` — a detail page whose title lives inside a bundled card (line 154), a plausible legitimate exception rather than an oversight, matching the pattern already noted for a similar skip in the original sweep.

`StatusPill` is now the least-adopted of the four, having sat untouched through three separate sweeps of its siblings — worth its own pass (see roadmap).

The new `app/(auth)/accept-org-invite/[token]/page.tsx` is correctly *not* counted in this denominator — it's an unauthenticated single-`Card` flow, not a portal listing/dashboard page, same category as `verify-group/confirm`.

---

## 7. Auth cosmetics & forgot-password (re-verified)

Confirmed via direct file read, not assumed from commit messages:
- **Password visibility toggle**: present on both `/login` and `/admin-login`.
- **Remember me**: present on `/login` only (persists the identifier field in `localStorage`, not the session) — absent on `/admin-login`, which is defensible given it's a 2FA-gated staff surface.
- **`(auth)` dark mode**: still absent, but now confirmed to be a platform-wide non-feature (zero `dark:` classes or theme provider anywhere in the app), not an `(auth)`-specific gap — downgraded in priority accordingly.
- **Forgot-password**: still a dead-end "contact your admin" toast (`forgot-password/page.tsx:27-36`). The blocking reason cited in its own code comment — "once the SMS OTP endpoint is live" — is now stale: this project has shipped two working email+SMS-OTP flows since that comment was written (`group-verification.service.ts`, and this week's org-invitations flow). Wiring self-service reset is now genuinely low-risk, high-leverage.

---

## 8. Prioritized roadmap

Supersedes §8 of the original report. Ordered by leverage; nothing here has been implemented yet.

**Quick, high-leverage, low-risk:**
1. **Gate `(member)` behind real auth.** Flagged as the single most serious gap in both this and the prior audit, zero movement in 24 hours despite six other commits landing. Either wire the real auth guard (mirroring `(dashboard)`'s pattern) or explicitly confirm it's staying an intentional prototype for now — but a silent, unflagged decision either way is worse than a stated one.
2. **Add pending-invitation visibility to the admin Staff card** — list status (`invited`/`otp_sent`/`verified`/expired), with resend and cancel actions. The invite feature shipped without this and it's a real operational hole for admins the moment an email doesn't land.
3. **Add a password-visibility toggle to `accept-org-invite`'s two password fields** — matches the pattern already shipped on `/login` and `/admin-login`, small and mechanical.
4. **Fix `WorkspaceSwitcher`'s stale doc comment** and decide whether an in-app org switcher is now warranted (today, switching requires a full re-login through the `/admin-login` picker) — the comment fix is free; the switcher itself is a product call, see item 8 below.

**Medium — mechanical, high-value, matches work already done three times this project:**
5. ~~Extend `EmptyState` to the actual core lists~~ — **Correction (2026-07-28): already resolved, this item was a false positive.** Direct file reads of all 5 pages (`(dashboard)/members`, `(dashboard)/loans`, `(dashboard)/contributions`, `admin/organizations`, `admin/groups`) confirm every one already renders a real, styled empty state (icon + title + description) via `PaginatedTable`, which wraps `EmptyState` internally and exposes it through `emptyMessage`/`emptyDescription`/`emptyIcon` props. The prior grep-based finding ("zero matches for the literal string `EmptyState`") was factually correct but the conclusion drawn from it was wrong — these pages configure the empty state indirectly through the shared component's props rather than importing `<EmptyState>` directly, so a literal-string grep alone can't see it. **Lesson matching this project's own prior grep-audit correction** (07-remediation-backlog.md's `mpesa_b2c` RLS false positive): a missing direct usage of a component is not proof a feature is absent when a shared wrapper might already provide it — check the wrapper's own implementation before writing up an absence.
6. ~~Wire self-service forgot-password via SMS OTP~~ — **Done (2026-07-28).** Reused the proven `hashSecret`/`generateOtp`/`sendSingleSms` pattern; a dormant, unused `ResetPasswordSchema` already had the exact right shape. Migration 104 added the OTP columns.
7. ~~Continue the `PaginatedTable`/`StatCard` sweeps, start a first `StatusPill` sweep~~ — **Done (2026-07-28).** `PaginatedTable` 56%→57%, `StatCard` 35%→39%, `StatusPill` 24%→**65%** (first sweep, now the best-adopted of the four). See §6 for the full breakdown and what was deliberately left hand-rolled.

**Larger, needs a product decision first:**
8. **Decide whether `(enterprise)` needs a real in-app organization switcher** now that multi-org staff genuinely exists — today that data model exists but has no UI expression once a person is signed in.
9. **Add a decline / "not me" path to the accept-org-invite flow** — a real workflow (typo'd email, changed mind) with no graceful exit today.

**Deferred, lower urgency:**
10. Dark-mode on `(auth)` — confirmed platform-wide non-issue, not worth isolated `(auth)` work ahead of a real theme system.
11. Dedicated payment-result screens (success/failure) beyond existing status badges.
12. Subscription-expired state — narrower now that invitation-expiry is handled; only remaining piece of the original item 12.

---

## 9. What this update deliberately did not do

No code was changed as part of this update — it is a research-and-reprioritization pass only, per the same scope discipline as the original audit. Payment-result screens, maintenance-mode pages, and offline-mode handling beyond the member portal were not re-verified this round (no signal any of the last day's commits touched them) and should be re-checked before being treated as still-accurate.
