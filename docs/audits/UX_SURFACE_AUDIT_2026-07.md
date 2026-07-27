# Kitabu Yetu — UX Surface Audit (Follow-up to UX_UI_AUDIT.md)

**Date:** 2026-07-27
**Trigger:** The user supplied a large, generic "complete UI/UX refactor" prompt (12 phases: surface audit, IA rebuild, five dedicated role-based login pages, a from-scratch landing page redesign, a footer rebuild, missing-surface implementation, a full design-system consolidation, a bug hunt, mobile-first pass, performance audit). The prompt was written for a hypothetical fintech SaaS, not derived from this codebase — several of its premises turned out not to match this platform's actual architecture. This audit exists to separate what's real from what the prompt assumed, before any implementation starts.
**Method:** Three parallel source-grounded research passes (route inventory, auth architecture, design-system/landing-page adoption), every claim traced to a file path. Builds on and re-verifies `docs/audits/UX_UI_AUDIT.md` (2026-07-15, scored 54/100) rather than re-deriving it — a great deal shipped in the 12 days between that audit and this one.

---

## 1. Executive summary

The platform has moved measurably since the last audit — a shared `PortalSidebar`, `error.tsx` boundaries on all four portals, a command palette in two of them, and a `PageHeader`/`PaginatedTable`/`StatusPill` component set that's genuinely adopted on a growing (if still minority) share of pages. But the generic refactor prompt's headline asks don't line up with reality in three important ways:

- **"Five dedicated login pages" is solving a problem that mostly doesn't exist.** There are two real login surfaces today (`/login`, `/admin-login`), and role-based post-auth routing already exists structurally. The one real gap is that `(member)` — the mobile self-service portal — has **no auth guard at all** and still runs on mock data; a logged-in member never actually lands there today.
- **"Field Officer" is not a role in this system.** It doesn't exist in any enum, any table, any UI. It's explicitly listed as a *future* gap in `B2B_ENTERPRISE_AUDIT.md`. Building a login page for it means inventing a role from scratch — a product/RBAC decision, not a UX task.
- **The landing page the prompt wants redesigned already has most of the requested sections** (hero, stats, solutions, features, testimonials, CTA) — but has two live broken links today: the footer's "Pricing" anchor (`#pricing`) points at nothing, and "Security" links to a page that 404s.

Where the prompt's instinct is correct: design-system **adoption** is still the weak point exactly as the prior audit found, and it hasn't closed as much as the shipped fixes suggest — `PageHeader` and `PaginatedTable` are each used on only 12 of 54 portal pages (22%), and a `StatCard` component already exists but is used on just 2 of 54 (4%). The missing-surface list is also real: there is no 404 page, no 403 page, and no maintenance-mode page anywhere in the app.

**Overall UX/product-completeness maturity: 60/100** — up modestly from the prior audit's 54, driven by real shared-shell and boundary work, offset by adoption still being the dominant unsolved problem and by newly-surfaced gaps (broken landing-page links, an unauthenticated member portal, zero error/empty-state pages).

---

## 2. What the generic prompt got wrong, and why it matters

| Prompt's ask | Reality | Source |
|---|---|---|
| 5 separate branded login pages (Super Admin, Organization, Group, Member, Field Officer) | 2 real login pages. `/login` (phone/email + password) serves members, group officers, *and* organization coordinators/super_admins if they land there; `/admin-login` (email + password + TOTP) serves `super_admin`/`support`/`organization_coordinator`. Post-login routing is handled by **layout guards**, not separate login forms. | `app/(auth)/login/page.tsx`, `app/(auth)/admin-login/page.tsx`, `app/api/v1/auth/login/route.ts`, `app/api/v1/auth/admin/login/route.ts` |
| "Field Officer Login" | `field_officer` does not exist in `member_role` or `platform_role` enums, or anywhere in the schema. It's named once, as a roadmap gap, in `B2B_ENTERPRISE_AUDIT.md`. | `supabase/migrations/20260101000000_001_init_enums.sql`, `types/enums.ts:7`, `docs/audits/B2B_ENTERPRISE_AUDIT.md:31,62,150` |
| "Organization Login" via Organization Code or Organization Domain | Zero matches anywhere in the repo for `organization_code`/`org_code`/`organization_domain`. Organizations are single-coordinator (`organizations.coordinator_member_id`); there's no multi-user-per-org concept to differentiate by domain/code. This would be new product architecture, not a UI gap. | grep-verified repo-wide; `docs/audits/B2B_ENTERPRISE_AUDIT.md:29-31` |
| Landing page needs a full rebuild | 8 of 9 requested sections already exist (hero, stats, solutions/personas, features, how-it-works, testimonials, CTA, footer) with real (if unpolished — CSS/SVG mockups, no product screenshots) content. Only pricing-on-landing and a security page are genuinely absent. | `app/page.tsx` + `components/landing/*` |
| `StatCard`/stat-tile standardization needs to be built | Already exists (`components/shared/stat-card.tsx`) — the gap is adoption (4%), not the component's absence. | grep-verified |

None of this means the underlying instincts (consistency, missing states, a real bug hunt) are wrong — it means five of the prompt's most specific, most expensive asks (5 login pages, a from-scratch landing rebuild, inventing a Field Officer role) would be solving problems that are either already solved or not real, at the expense of the ones that are.

---

## 3. Information architecture — what changed since 2026-07-15, what didn't

**Route counts today:** `(dashboard)` 33 pages (up from 24), `(admin)` 13, `(enterprise)` 3 real + 5 `soon: true` stubs (unchanged), `(member)` 4 (unchanged).

**Fixed since the last audit:**
- The "four separate nav implementations" finding is now half-true: `components/shared/portal-sidebar.tsx` unifies `(dashboard)` and `(admin)` (`components/layout/sidebar.tsx`, `components/admin/sidebar.tsx`).
- `error.tsx` now exists for **all four** portals (was 1 of 4). `loading.tsx` exists for 3 of 4 (still missing for `(admin)`).
- A command palette (`components/shared/command-palette.tsx` + `search-trigger.tsx`) is now in both `(dashboard)` and `(admin)` topbars — was admin-only.
- `PageHeader` adoption grew from the shipped "first batch" of 7 to 12 pages.

**Still true, unresolved:**
- `(enterprise)` still has its own inline nav shell (`app/(enterprise)/layout.tsx:33-57`), not `PortalSidebar` — same 5 `soon: true` stubs (`reports`, `members`, `disbursements`, `branding`, `audit`) as the prior audit, verbatim.
- `(member)` still runs its own `bottom-nav.tsx`, separate shell — and per the auth research, is still not actually gated by real auth.
- **The three-way "Organization" naming collision is still live**, not resolved: `(admin)/admin/organizations` (federating bodies), `(dashboard)/organization` (a single dense page covering disbursements/accounting/budget reports/policy thresholds), and `(enterprise)` (a separate "Kitabu Enterprise" partner workspace with its own `WorkspaceSwitcher`) are three unrelated concepts sharing one name across three portals.
- No `not-found.tsx` exists anywhere in the app (glob-verified, zero matches).

**Org-level surfaces the prompt assumes exist somewhere:** they mostly don't. "Wallet," "officers," and "roles" return zero matches anywhere in `app/`. "Branding" and "audit" exist only as disabled nav stubs in `(enterprise)`, with no backing page.

---

## 4. Missing-surface / error-state audit

| Surface | Status | Evidence |
|---|---|---|
| 404 page | **Missing** | Zero `not-found.tsx` files anywhere |
| 403 / unauthorized page | **Missing** | Access control is silent `router.replace()` redirects in layouts (e.g. `app/(enterprise)/layout.tsx:68,72`) — no dedicated screen |
| Maintenance-mode page | **Missing** | Zero UI-layer matches for "maintenance" |
| Empty states (no orgs/groups/members/transactions) | **Partial** | `EmptyState` used in only 7 files, none of them the core lists (members, loans, contributions, admin org/group lists) |
| Offline-mode handling | **Partial, member-portal-only** | `components/member/offline-indicator.tsx` exists and works, wired only into `(member)` — absent from the other 3 portals |
| "Coming soon" pattern | **Partial** | Just a disabled nav badge (`(enterprise)/layout.tsx:128-139`), no actual placeholder page |
| Invitation-expired state | **Missing** | No invitation-flow page found anywhere |
| Subscription-expired state | **Missing** | `billing/page.tsx` shows current plan only — no expired/lapsed/past-due state |
| Payment-failed / payment-successful state | **Partial** | `mpesa/page.tsx` has status *badges* (`failed`/`timeout`/`cancelled`/`completed`) in a transaction list — no dedicated result screen or STK-push outcome modal |

---

## 5. Auth: real gaps (distinct from the prompt's imagined ones)

- **`(member)` has no auth guard** — `app/(member)/layout.tsx:16-18` is explicitly left ungated, still on mock `_data.ts`. This is the one genuinely serious auth-architecture gap, and it's not on the prompt's radar at all.
- **Forgot-password isn't self-service** — `forgot-password/page.tsx` just toasts "contact your group admin," no OTP/reset flow.
- No password-visibility toggle on either login form.
- No "remember me."
- No dark-mode styling on `(auth)` — hardcoded light gradient (`app/(auth)/layout.tsx:5`) despite dark-mode tokens existing platform-wide.
- Loading/validation states on the forms themselves are actually solid — not a gap.

---

## 6. Design-system adoption (real counts, 54 portal pages: 37 dashboard + 14 admin + 3 enterprise)

| Component | Adoption | Note |
|---|---|---|
| `PageHeader` | 12 / 54 (22%) | 42 pages still hand-roll an `<h1>` block |
| `PaginatedTable` | 12 / 54 (22%) | 21 table-bearing pages still use a raw `<table>` — all 6 admin list pages with tables, plus `shares`, `sms`, all 3 enterprise pages, others |
| `StatCard` | 2 / 54 (4%) | Component already exists (`components/shared/stat-card.tsx`); 35 pages hand-roll stat tiles instead |
| `StatusPill` | 13 / 54 (24%) | Best-adopted of the four |

This is the single most consequential number in this report: three purpose-built components sit at 4–24% adoption while doing exactly the job the generic prompt's "Phase 8 Design System Consolidation" wants. The fix is a mechanical conversion sweep, not new component design — this project has done exactly this kind of sweep before (the `PaginatedTable` migration on journals/dividends/credit-scores/whatsapp, and the first `PageHeader` batch).

---

## 7. Landing page, pricing, footer

**Landing (`app/page.tsx`, Server Component, 9 client sub-sections):** Hero, Stats, Personas/Solutions, Features, Ecosystem, How-it-Works, Testimonials, and CTA all exist with real content — quality gap is that hero/feature visuals are hand-built CSS/SVG, not real product screenshots. **Pricing is not on the landing page at all** — the footer links to `#pricing`, which resolves to nothing on that page. **No security page exists** — footer links to `/security`, which 404s. FAQ exists only on the standalone `/pricing` page, not on the landing page.

**Pricing page:** self-contained, doesn't share the landing page's `Navbar`/`Footer`, 3 hardcoded plans, its own inline 4-item FAQ.

**Footer (`components/landing/footer.tsx`):** a real 5-group structure (Solutions, Product, Company, Legal, Resources) already exists — it is not the flat, thin footer the prompt assumes it's building from scratch. It has **two live broken links** (`#pricing`, `/security`) and **no dedicated "Login" group** — sign-in is only reachable via the navbar button, and the closest thing to role-differentiated entry points (the Solutions group's Member/Group/Enterprise/Backoffice links) isn't framed as login options.

Fraunces display typography, called out as a deliberate choice in the prior audit, is confirmed genuinely wired and visibly used across every landing section — not dead capability.

---

## 8. Prioritized roadmap

Ordered by leverage (fixes real, evidenced gaps) rather than the generic prompt's phase order. Nothing here has been implemented yet — this is for your prioritization.

**Quick, high-leverage, low-risk:**
1. Fix the two broken footer links (`#pricing` → real anchor or `/pricing`; `/security` → build or remove the link).
2. Add a global `not-found.tsx` and a 403/unauthorized page — currently zero of either exist anywhere.
3. Gate `(member)` behind real auth (currently the one genuine "silent" security/product gap the prompt didn't even ask about) — or explicitly confirm it's intentionally still a prototype.

**Medium — mechanical, high-value, matches work already done twice this project:**
4. Continue the `PageHeader`/`PaginatedTable` conversion sweep (22% → higher), same recipe as the prior batches.
5. `StatCard` conversion sweep (4% → higher) — the component exists, this is pure adoption.
6. Extend `EmptyState` to the core lists (members, loans, contributions, admin org/group lists) — currently only 7 files use it.

**Larger, needs a product decision first (not a pure UX task):**
7. Resolve the three-way "Organization" naming collision across `(admin)`, `(dashboard)`, `(enterprise)` — this needs a naming/IA decision, not just a rename.
8. Decide whether "Organization Login" or "Field Officer" are real product directions before building any UI for them — both would be new architecture, not refactors.
9. Self-service forgot-password (OTP/reset flow) — currently just a "contact your admin" toast.

**Deferred, lower urgency:**
10. Password-visibility toggle, remember-me, dark-mode on `(auth)` — real gaps, but cosmetic relative to the above.
11. Dedicated payment-result screens (success/failure) beyond the existing status badges.
12. Subscription-expired / invitation-expired states — only worth building once those flows exist to need them.

---

## 9. What this audit deliberately did not do

Per the scope agreed before this research started: no code was changed, no landing-page redesign was attempted, no login pages were built, and no bug hunt / performance audit / mobile-responsiveness pass was run (phases 7, 10, 11 of the original prompt). Those remain open, and — per §2's finding that several of the prompt's most expensive asks aren't real gaps — probably shouldn't be scoped 1:1 to the original prompt going forward.
