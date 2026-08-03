# Organization Login / URL Architecture — Proposal vs. Current State Audit

**Date**: 2026-08-02
**Scope**: Gap analysis between a proposed multi-domain, role-separated URL architecture ("Organization Login" for Kitabu Yetu Enterprise) and what actually exists in the codebase today.
**Method**: Source-grounded — every claim below is backed by a file path, verified this session via 3 parallel research passes (route map, auth-flow capability check, `(enterprise)` portal reality check). No claim is carried over from memory without re-verification.

---

## 1. Executive summary

The proposal asks for three things: **(a)** a dedicated domain/subdomain split (`kitabuyetu.com` / `app.kitabuyetu.com` or `portal.kitabuyetu.com` / `admin.kitabuyetu.com`), **(b)** a fully separate `/enterprise/*` auth surface (login, register, forgot-password, reset-password, verify-email, two-factor, select-organization as distinct pages), and **(c)** a pre-auth "Continue as: Organization / Group Member / Staff" chooser screen.

**None of the three currently exist as proposed.** But the underlying capability gap is smaller than the proposal implies, because two of its seven auth pages are already solved — just architecturally differently (inline phases in one component, not separate routes). The two *genuinely missing* capabilities are real gaps worth fixing regardless of whether the domain-split proposal is adopted: **staff/org password reset does not exist at all**, and **organization self-registration does not exist at all** (every organization is created by a `super_admin` through the backoffice — there is no "Create Organization" flow for a prospect to sign up).

Also load-bearing: `/enterprise` is not a free namespace. It is already a real, live, authenticated URL prefix — the org-staff portal itself (`/enterprise`, `/enterprise/branches`, `/enterprise/api-keys`). Routing a *login* page to `/enterprise/login` would sit one level below the portal's own root (`/enterprise`), which today redirects unauthenticated visitors to `/admin-login` — i.e. the proposal's login URL would need to coexist with, not replace, that redirect target.

| Proposal ask | Current state | Verdict |
|---|---|---|
| `kitabuyetu.com` custom domain | Only `kitabuyetu.vercel.app` is live; `.env`'s `NEXT_PUBLIC_APP_URL` points to a discontinued `ezzahcomm.co.ke` subdomain | **Not provisioned** |
| Subdomain split (`app.`/`portal.`/`admin.`) | Zero hostname-based routing anywhere in the codebase; `proxy.ts` only inspects path prefixes | **Not implemented, non-trivial lift** |
| `/enterprise/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email` | None exist. `/enterprise/*` is the authenticated portal, not an auth area | **Missing** |
| `/enterprise/two-factor` | TOTP MFA exists, but as an inline phase of `/admin-login`, not a route | **Functionally present, architecturally different** |
| `/enterprise/select-organization` | Exists, but as an inline phase of `/admin-login` (`chooseOrg`), not a route | **Functionally present, architecturally different** |
| Organization self-registration ("Create Organization") | Does not exist anywhere. Only `super_admin` can create an organization (`POST /api/admin/organizations`) | **Missing — real gap** |
| Staff/org forgot-password | Does not exist. The only password-reset flow (`/forgot-password`, SMS-OTP) is member/group-only | **Missing — real gap** |
| Dedicated `admin.kitabuyetu.com` for super admin | Lives at `/admin/*` on the same domain, same login page as org staff | **Not implemented** |
| Pre-auth "Continue as: Org / Member / Staff" chooser | Doesn't exist. `/login` and `/admin-login` are two separate pages that cross-link each other; org-vs-staff resolution happens *after* password entry, not before | **Missing, and a real design fork — see §6** |

---

## 2. Domains and deployment model

**Proposal assumes**: `kitabuyetu.com` (marketing) + `app.kitabuyetu.com` or `portal.kitabuyetu.com` (org portal) + `admin.kitabuyetu.com` (super admin) — three-plus domains/subdomains.

**Actual**: single Vercel deployment, single domain. `vercel.json` contains only `{"buildCommand": "npm run build"}` — no domain or rewrite config. `.env` / `.env.local` set `NEXT_PUBLIC_APP_URL=https://kitabuyetu.ezzahcomm.co.ke`, which per the user is **discontinued**; the live app is reachable at `kitabuyetu.vercel.app`. `kitabuyetu.com` itself is not referenced anywhere in the repo's env config — it is not a domain this app is currently deployed to.

`proxy.ts`'s middleware `matcher` is `['/api/:path*']` — it runs on API routes only, not page routes, and decides `tenant` vs `backoffice` audience purely by path prefix (`/api/v1/*` vs `/api/admin/*`), verified via JWT `aud` claim. There is no hostname/subdomain inspection anywhere in the routing layer — a repo-wide grep for `hostname`/`subdomain` found exactly one hit, and it's for building the Upstash Redis REST URL, unrelated to request routing.

**Implication**: adopting the proposal's subdomain split is not a config change — it requires provisioning real DNS records, rewriting `proxy.ts` (or adding new middleware) to do host-based routing, and re-scoping cookies/session storage across domains (currently same-origin, so this has never had to be solved).

---

## 3. Public / marketing URLs

| Proposal URL | Current equivalent | Notes |
|---|---|---|
| `kitabuyetu.com` | `/` (`app/page.tsx`) | main landing page, live |
| `kitabuyetu.com/enterprise` | `/enterprise` | **but this is the authenticated portal root, not a marketing page** — `app/(enterprise)/layout.tsx` gates it behind `useAuth()` + role check (`organization_coordinator`/`super_admin`), redirecting unauthenticated visitors to `/admin-login` |
| `kitabuyetu.com/enterprise/pricing` | `/pricing` (top-level, unauthenticated) | exists, but **not nested under `/enterprise`** |
| `kitabuyetu.com/enterprise/contact` | `/contact` (top-level, unauthenticated) | exists, not nested |
| `kitabuyetu.com/enterprise/demo` | — | **does not exist**. No "request demo" or "contact sales" content anywhere in `app/` (confirmed via grep for both phrases) |

Other public pages that do exist and aren't in the proposal's list at all: `/about`, `/status`, `/support`, `/docs` — all built on a shared `components/landing/marketing-page-shell.tsx`.

---

## 4. Authentication URLs

Actual pages under `app/(auth)/` (route group is invisible in the URL):

| URL | File | Purpose |
|---|---|---|
| `/login` | `app/(auth)/login/page.tsx` | member/group login (phone or email + password), inline "choose group" step |
| `/admin-login` | `app/(auth)/admin-login/page.tsx` | **combined** super-admin + org-staff login, inline TOTP enroll/verify + "choose organization" steps |
| `/register` | `app/(auth)/register/page.tsx` | self-service **group** registration (`register_group()` RPC) — not organization registration |
| `/forgot-password` | `app/(auth)/forgot-password/page.tsx` | member-only, phone + SMS OTP (`ForgotPasswordStartSchema`/`ResetPasswordSchema`) |
| `/verify-group`, `/verify-group/confirm` | `app/(auth)/verify-group/*` | verifies a newly-registered **group**, not a generic "verify email" |
| `/accept-org-invite/[token]` | `app/(auth)/accept-org-invite/[token]/page.tsx` | invited org staff accept an invitation (email link or phone OTP) |

Proposal's 7-page list (`/enterprise/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/two-factor`, `/select-organization`) maps as:

- **`login`, `register`, `forgot-password`** as separate `/enterprise/*` pages → don't exist; closest real equivalents are `/admin-login` (login, no org-specific variant) and `/register` (group, not org). No `/enterprise/register` or org-specific `/forgot-password` exists at all.
- **`verify-email`** → no generic email-verification flow exists anywhere in the app, staff or member. `verify-group/*` verifies a group's own contact info at registration time, a different thing.
- **`two-factor`** → real capability, wrong shape: TOTP MFA is fully built (QR enrollment, recovery codes, verify) but lives as `phase.kind === 'enroll' | 'verify'` inside `admin-login/page.tsx`'s single-component state machine (`Phase` union, line 51), not a route.
- **`select-organization`** → same story: `phase.kind === 'chooseOrg'` (line 55, rendered at lines 184/211-233), driven by the `organization_members` table (migration 101) shipped in the multi-staff-organizations work. Fully functional, just not a URL.

**Two capabilities the proposal assumes exist and genuinely don't, independent of the domain question:**

1. **Staff/org password reset.** `app/api/v1/auth/forgot-password/{start,reset}/route.ts` only accepts a `phone` field — this is the member flow. There is no `app/api/v1/auth/admin/forgot-password` or equivalent, and `admin-login/page.tsx` has zero "forgot password" link or UI. Today, if an organization staff member or a super admin forgets their password, there is no self-service recovery path at all.
2. **Organization self-registration.** `POST /api/admin/organizations` is wrapped in `withPlatformRole(req, 'super_admin', ...)` — only platform staff can create an organization. There is no public `/api/v1/organizations` (or similar) endpoint, and no `/enterprise/register` or `/register-organization` page. The proposal's "Don't have an organization account? Create Organization" link has nothing to point to.

---

## 5. Organization portal (`/enterprise/*`)

Proposal lists 12 routes under the org portal: `/dashboard /groups /members /funding /loans /contributions /welfare /programs /field-officers /reports /settings /billing`.

**Actual state — only 3 real pages exist:**

| URL | File | Data |
|---|---|---|
| `/enterprise` | `app/(enterprise)/enterprise/page.tsx` | **real** — `api.get('/organization/dashboard')`, `organizationApi.groups()`; charts with no backend rendered as an explicit `ComingSoon` panel |
| `/enterprise/branches` | `app/(enterprise)/enterprise/branches/page.tsx` | **real** |
| `/enterprise/api-keys` | `app/(enterprise)/enterprise/api-keys/page.tsx` | **mock** — explicitly commented `// Intentionally still mock — no API key issuance / webhook delivery backend`, imports seed data from `_data.ts` |

Everything else in the proposal's list — `groups`, `members`, `funding`, `loans`, `contributions`, `welfare`, `programs`, `field-officers`, `reports`, `settings`, `billing` — **has no folder or page anywhere under `(enterprise)`**. The sidebar (`app/(enterprise)/layout.tsx`, lines 33-57) does list `reports`, `members`, `disbursements`, `branding`, `audit` as nav items, but marks them `soon: true` and renders them disabled with a "Soon" pill — they are IA placeholders, not routes. `field-officers` specifically doesn't exist anywhere in the app, matching an earlier audit's finding that `field_officer` isn't a real role in any DB enum or table — only ever named as a hypothetical future item in `B2B_ENTERPRISE_AUDIT.md`.

This is a materially bigger gap than the login-architecture question: even if the URL/domain proposal were implemented exactly as written, 9 of the 12 org-portal pages it lists would 404.

---

## 6. Super admin

Proposal wants a fully separate `admin.kitabuyetu.com` with `/login /dashboard /organizations /subscriptions /payments /support /audit /system`.

**Actual**: lives at `/admin/*` on the same domain, same `/admin-login` page as org staff (differentiated only after authentication, by whether the account is linked to any `organization_members` rows). Confirmed existing children under `app/(admin)/admin/`: `analytics`, `audit-logs`, `billing-admin`, `feature-flags`, `groups`, `groups/[id]`, `monitoring`, `organizations`, `organizations/[id]`, `risk`, `settings`, `support`, `users`. Roughly maps to the proposal's list (`audit-logs`≈`audit`, `billing-admin`≈`subscriptions`/`payments`, `settings`+`monitoring`+`feature-flags`≈`system`) but with different names and, notably, **more surface area than the proposal lists** (`risk`, `groups`, `analytics`, `monitoring`, `feature-flags` aren't in the proposal at all). A dedicated `/admin/login` or `/admin/dashboard` as distinct routes weren't independently confirmed this session and should be treated as unverified rather than assumed either way.

---

## 7. The real design fork: pre-auth identification vs. post-auth resolution

The proposal's "Continue as: 🏢 Organization / 👥 Group Member / ⚙️ Staff" screen asks the visitor to self-identify **before** entering credentials. The current app does the opposite: `/login` and `/admin-login` are two separately-linked pages (each cross-links the other — "Back to member login" / "Member accounts log in at /login"), and *within* `/admin-login`, staff-vs-organization resolution happens **after** password + MFA, driven by real backend data (`organization_members` membership count), not user self-report.

This is worth flagging as a genuine architectural choice, not just a missing feature, because the proposal's model and the current model have different failure modes:

- **Proposal's pre-auth chooser**: a user who doesn't know which bucket they're in (a coordinator who's also a member of a savings group, which the platform's data model explicitly allows) has to guess correctly before they can even try to log in. Guessing wrong likely means a dead-end or a redirect, not a graceful recovery.
- **Current post-auth resolution**: the account itself carries the truth (an `admin-login` credential resolves to whichever organizations the `organization_members` table actually says it belongs to), so there's no possibility of a user picking the wrong bucket — at the cost of two visually near-identical login pages that a first-time visitor has to already know to distinguish between (the earlier `UX_SURFACE_AUDIT_2026-07.md` audit flagged this exact ambiguity as a wayfinding gap, addressed only partially with an info-note, not a unified chooser).

Neither is strictly better; the proposal's version front-loads friction to avoid ambiguity, the current version back-loads correctness to avoid guesswork. Worth a product decision, not a silent pick.

---

## 8. What would actually change if this were built as-proposed

Ranked by what's structurally required, not by the proposal's own ordering:

1. **Domain/subdomain provisioning** (`kitabuyetu.com`, plus 1-2 subdomains) — infrastructure work outside the codebase; nothing here can be "coded" until domains exist and DNS points at Vercel.
2. **Host-based routing** — `proxy.ts` would need real hostname-awareness (currently zero), and cookies/session storage would need cross-subdomain scoping (currently implicitly same-origin).
3. **Staff/org password reset** — missing regardless of the domain question; the highest-value fix that's genuinely just backend+frontend work with no infra dependency, mirroring the pattern the member-side SMS-OTP reset already established.
4. **Organization self-registration** — missing regardless of the domain question. Currently a deliberate gate (only `super_admin` creates orgs) — before building a public "Create Organization" flow, this needs a product decision: is self-service org signup actually wanted (implies unverified/unvetted organizations entering a financial platform), or should it stay staff-gated with better internal tooling instead? The proposal assumes the former without discussing the trust/vetting implication.
5. **9 missing `(enterprise)` portal pages** — a much larger build than the auth/URL question; several (funding, loans, contributions, welfare) likely already have working equivalents in the `(dashboard)` group's group-level pages that would need an org-scoped variant, not a from-scratch build.
6. **Splitting `/admin-login` into a separate org-staff login and a separate super-admin login** — currently one shared component; splitting it is mechanical (the `Phase` state machine already cleanly separates enrollment/verify/org-selection) but removes the current "one hardened MFA flow, two audiences" simplicity in exchange for the proposal's clearer separation-of-concerns.

---

## 9. Recommendation

Treat this as three independent decisions, not one bundled proposal:

- **Domain split**: defer. No infra exists for it today, it's the most expensive item, and nothing else in the proposal actually depends on it — a separate `/org-login`-style path split can be shipped on the current single domain first, and migrated to subdomains later if there's a concrete driver (e.g. a WAF/security requirement to isolate super-admin traffic).
- **Staff/org password reset**: build now. Real, unambiguous gap, low risk, existing SMS-OTP pattern to mirror.
- **Organization self-registration**: needs a product decision first (trust/vetting model), not a build — flag to the user rather than implementing silently, consistent with how prior auth-architecture forks on this project have been handled.

---

## 10. Implementation roadmap

Phased by dependency and risk, not by the proposal's own ordering. Each phase lists what ships, what it depends on, and — where a real product/security fork exists — the decision that needs an explicit answer before building (flagged, not silently picked).

### ~~Phase 0~~ — Decisions before any code — **decided (2026-08-02)**

Both forks resolved via `AskUserQuestion`, both landing on "keep the current state":

1. **Organization self-registration trust model** → **stay staff-gated.** No public signup. Organizations continue to be created only by `super_admin` through the backoffice, as today. **This closes Phase 3 as declined, not deferred** — it isn't "later work," it's a decision not to build it, matching this project's stance elsewhere against opening unvetted entities onto a platform that moves real money.
2. **Domain strategy** → **stay single-domain.** No subdomain split. Revisit only if a concrete driver appears later (e.g. a security/WAF requirement to isolate super-admin traffic) — not scheduled work. **This closes Phase 5 as declined, not deferred**, for the same reason: it's the most infrastructure-heavy item in this roadmap with no current justification, not a queued task.

### ~~Phase 1~~ — Staff/org password reset — **shipped (2026-08-02)**

Implemented as designed below with zero migration: `members.reset_otp_hash/reset_otp_expires_at/reset_otp_attempts` (migration 104) turned out to be generic per-member reset-attempt columns, not phone-specific, so the staff/email flow reuses them directly instead of adding new schema. Also found `sendPasswordResetEmail()` (`lib/services/member-email.service.ts`) and its `password_reset` default template already existed, fully built, with **zero callers anywhere** — the same "shipped but never wired up" pattern this audit series has repeatedly found elsewhere (`group_constitutions`, the governance-scoring tables) — so the email-sending half of this feature required no new code at all, just a caller.

Shipped: `lib/services/admin-password-reset.service.ts` (email-token variant of the existing SMS-OTP service, reusing `generateEmailToken`/`hashSecret` from `group-verification.service.ts`), `POST /api/v1/auth/admin/forgot-password/{start,reset}` (added to `proxy.ts`'s `PUBLIC_AUTH_PATHS`), `authApi.adminForgotPasswordStart/Reset`, a "Forgot password?" link on `/admin-login`, and two new dark-themed pages matching `/admin-login`'s visual identity: `/admin-login/forgot-password` (email request) and `/admin-login/reset-password` (token-from-URL, new password). 30-minute token TTL, enumeration-safe (generic responses whether or not the email/token is valid), bumps `session_version` on reset to invalidate existing sessions — same guarantees as the member-side flow. Verified: `tsc --noEmit`, `eslint`, full `next build` (all 3 new pages + 2 new routes compiled), and the full Jest suite (357/357 passing) all clean.

### Phase 1 (original design, for reference)

The clearest real gap, zero infra dependency, existing pattern to mirror (`/forgot-password`'s member SMS-OTP flow).

- New `app/api/v1/auth/admin/forgot-password/{start,reset}/route.ts`, email-based (staff accounts are email/password, unlike member phone accounts) — likely a token-link-to-email pattern rather than OTP, matching how staff already authenticate.
- "Forgot password?" link added to `admin-login/page.tsx`'s password phase.
- Reuses the existing `session_version` bump-on-reset pattern from the member flow to invalidate active sessions.
- **No schema decision needed** if it reuses the member reset table shape (person-scoped, not phone-scoped) — worth a quick check of `ResetPasswordSchema`'s current shape before assuming zero migration.

Effort: small. Risk: low (isolated new routes + one page addition, no change to existing auth paths).

### ~~Phase 2~~ — Auth wayfinding cleanup — **shipped, scope corrected (2026-08-02)**

**Correction before building**: the plan below assumed no pre-auth chooser existed. It does — `components/landing/personas.tsx` (the landing page's "One platform, every role" section) and `navbar.tsx`'s "Solutions" dropdown already route 4 personas (member/group-leader/organization/backoffice) to `/me`, `/register`, `/enterprise`, and `/admin-login` respectively. The "Organization" persona card already lands an org coordinator at `/enterprise`, which (per §5) redirects unauthenticated visitors to `/admin-login` — so organization staff already have a discoverable path in from the landing page. Building a second, redundant `/get-started` chooser page was dropped rather than shipped, matching this audit series' repeated "verify before building" pattern (the `EmptyState`/`mpesa_b2c` false positives elsewhere in this project's audit history).

The one genuinely real, narrower gap: `/admin-login` links back to `/login` ("Back to member login"), but **`/login` had no reverse link at all** — a staff member who lands directly on `/login` (bookmark, direct nav, no landing-page context) had no way to discover `/admin-login` exists. Fixed: added "Organization staff or Kitabu Yetu team? Sign in here" below `/login`'s existing "Register your group" link, matching the page's own established link style.

Effort: small (1 line). Risk: none (additive text link, no route changes).

### ~~Phase 3~~ — Organization self-registration — **declined (2026-08-02)**

Phase 0 decision #1 came back "stay staff-gated." This phase does not proceed — organizations continue to be created only by `super_admin` through the backoffice. The design sketched below is kept for reference only, in case the decision is revisited later with a concrete driver (e.g. a real prospect asking for self-service onboarding):

- Public `POST /api/v1/organizations` (new — no such endpoint exists today), creating an org in a `pending_verification`-style status mirroring `register_group()`'s existing pattern for groups.
- An approval queue surfaced in `/admin/organizations` for `super_admin` to approve/reject before the org's coordinator can log in — reuses existing admin-organizations UI, adds a status filter.
- Registration form + confirmation page.
- Explicitly out of scope even if revisited: KYC/document verification, billing/plan selection at signup.

### Phase 4 — Missing `(enterprise)` portal pages — **scope corrected (2026-08-02)**

**Correction before building**: this section originally used the pasted proposal's 9-page list (groups/members/funding/loans/contributions/welfare/programs/reports/settings/billing). That list was never grounded in this codebase. The portal's own `app/(enterprise)/layout.tsx` `NAV` config already defines the real planned IA — only **5** pages marked `soon: true`: `reports`, `members`, `disbursements` (Operations), `branding`, `audit` (Developer & Brand). That's the authoritative scope, not the proposal's list.

Backend readiness checked per page before committing to any build order:

| Page | Readiness |
|---|---|
| `disbursements` | **Ready** — `organization_ledger` + `settleOrgDisbursement()` already live (powers `/enterprise`'s dashboard). Mostly a list/table view over existing data. |
| `reports` | **Partial, and a false lead corrected mid-check**: `/api/v1/organization/reports` (already live) is not the donor/program report assumed — it's `getGroupDetail`, a per-group lookup, unrelated. The real donor-spend/program-budget reports (`organization-finance.service.ts`, built during the earlier accounting-audit series) live under `/organization/programs?report=donor` and aren't wired to any `(enterprise)` page yet. |
| `members` | **Partial** — org-scoped *staff* members already exist (`organization-members.service.ts`, from the multi-staff-organizations work), but this nav item means *customer* members across the org's branches — a new cross-group query, not built. |
| `audit` | **Partial** — `audit_logs` exists platform-wide but is indexed by `group_id`, not `organization_id` — no direct org-scoped query exists; needs a new aggregation joining through the org's linked groups. |
| `branding` (white-label) | **Not started** — zero schema on `organizations` (the only `logo_url`/color columns anywhere are on `groups`, for per-group email branding — a different, already-solved problem). Also a genuine product-scope question, not just an engineering gap. |

Decisions (AskUserQuestion, 2026-08-02): **branding scope = logo + brand color only** (mirrors the existing per-group email-branding pattern, scoped to organizations; explicitly deferred: custom domain, which ties into the Phase 5 domain question). **Sequencing = ready-first**: disbursements → reports → members → audit → branding, each shipped as its own PR-sized unit rather than one large batch, since unlike the earlier design-system sweeps (mechanical, parallelizable across files with no shared state) these 5 pages have genuinely different backend shapes and risk profiles.

`field-officers` (from the original proposal's list) is **out of scope entirely** — confirmed in §5 this isn't a real role anywhere in the data model, and it isn't in the portal's own nav config either.

**All 5 pages shipped (2026-08-02)**, ready-first as decided:

1. **Disbursements** — frontend-only (`organizationApi.disbursements/disburse/disbursementAction/wallet/programs` + the page). Backend was already fully live; this was the first client wiring for it. Maker-checker approve/reject mirrors `app/(dashboard)/mpesa/reallocations`'s established `MoneyActionDialog` pattern.
2. **Reports** — frontend-only, tabbed (Budget variance / Donor spend), wired to the two existing report functions. Corrected a wrong assumption mid-build: `/api/v1/organization/reports` (already live) turned out to be an unrelated per-group lookup, not the donor report — the real reports are under `/organization/programs?report=budget|donor`.
3. **Members** — new backend: `organization.service.ts`'s `listMembers()` (migration-free — joins existing `group_members`/`groups`/`organization_group_access`/`members` tables), new `GET /api/v1/organization/members`, server-side search by name/phone.
4. **Audit Trail** — new backend: `organization.service.ts`'s `listAuditLogs()`, joining the platform-wide `audit_logs` table (which has no `organization_id` column) through `organization_group_access` to scope it to one org's branches. Migration-free.
5. **Branding** — new schema: migration 109 adds `logo_url`/`primary_color` to `organizations` (previously zero columns existed there for this). Scope per the AskUserQuestion decision: logo URL + hex color only, no upload pipeline (mirrors `group_email_branding`'s existing plain-URL pattern), no custom domain.

All 5 un-marked from `soon: true` in `app/(enterprise)/layout.tsx`'s nav config. Verified: `tsc --noEmit`, `eslint`, full `next build` (all 8 `/enterprise/*` routes compiled, the 5 new plus the 3 pre-existing), full Jest suite (357/357). One new migration (109) — handed to the user to run by hand per [[feedback_migrations_not_auto_deployed]], the other 4 pages needed no schema changes at all.

### ~~Phase 5~~ — Domain/subdomain split — **declined (2026-08-02)**

Phase 0 decision #2 came back "stay single-domain." This phase does not proceed — the app stays on its current single Vercel domain, no `kitabuyetu.com`/subdomain provisioning. Revisit only if a concrete driver appears (e.g. a security/WAF requirement to isolate super-admin traffic), not as scheduled work. The design sketched below is kept for reference only:

- DNS/Vercel domain provisioning (outside the codebase — needs direct user action, not something to execute autonomously).
- `proxy.ts` gains hostname-aware routing alongside its existing path-based audience check.
- Cookie/session scoping updated for cross-subdomain use (currently implicitly same-origin — first time this has had to be solved).
- `NEXT_PUBLIC_APP_URL` and every absolute-URL usage (email links, callback URLs) audited for the new domain(s) — same class of staleness already flagged in this audit for the discontinued `ezzahcomm.co.ke` value.

---

## 11. Roadmap outcome (2026-08-02)

All 5 phases closed out in one session:

| Phase | Outcome |
|---|---|
| 0 — Decisions | Decided: stay staff-gated, stay single-domain |
| 1 — Staff/org password reset | **Shipped** |
| 2 — Auth wayfinding | **Shipped** (scope corrected: one link, not a new page) |
| 3 — Organization self-registration | **Declined** |
| 4 — Missing `(enterprise)` portal pages | **Shipped**, all 5 (scope corrected: 5 real nav items, not the proposal's 9) |
| 5 — Domain/subdomain split | **Declined** |

Net effect versus the original pasted proposal: the two-factor and organization-selection steps it asked for already existed (inline in `/admin-login`, not separate routes); the domain split and organization self-registration it assumed were both explicitly declined after review; the two real gaps it surfaced (staff password reset, missing portal pages) are now closed. Two build-time corrections (Phase 2's redundant chooser, Phase 4's proposal-vs-actual-IA mismatch) were caught and fixed before shipping rather than after.

---

## 12. Post-roadmap addition: split organization login from platform-staff login (2026-08-02)

§7 flagged a genuine, unresolved design fork — one shared `/admin-login` page for both super admin and organization staff (post-auth resolution) vs. the proposal's separate-surfaces model (pre-auth identification) — and deliberately left it undecided rather than picking silently. Asked directly after the roadmap closed; answer was to build the split.

**What changed:**

- **`/enterprise/login`** — new page, organization staff (+ `super_admin`, which needs access to both surfaces as the platform god-role). Light "enterprise" brand variant (green/navy) matching the rest of the `(enterprise)` portal, instead of `/admin-login`'s dark staff-console theme — the actual point of splitting them.
- **`/admin-login`** — narrowed to `super_admin`/`support` only. `organization_coordinator` accounts are now turned away here, redirected to try `/enterprise/login` instead.
- **Server-side enforcement, not just two UIs**: `AdminLoginSchema` gained a `surface: 'platform' | 'organization'` field; `app/api/v1/auth/admin/login/route.ts` checks the caller's `platform_role` against a `SURFACE_ALLOWED_ROLES` map per surface. A right-password-wrong-surface attempt gets a distinct, actionable error (not the generic "invalid credentials") — deliberately not folded into the existing enumeration-safe collapse, since the password already proved account ownership by that point, so a clearer message here creates no new pre-auth enumeration primitive.
- **Shared, not duplicated**: the two pages share one state machine (`hooks/use-backoffice-login.ts`) and one set of themed sub-forms (`components/auth/backoffice-login-forms.tsx`, `variant: 'dark' | 'light'`) — mirrors this project's established `PortalSidebar` precedent (variant-keyed light/dark, thin page wrappers) rather than forking ~250 lines of near-identical MFA/enrollment logic across two files.
- **Routing note**: `/enterprise/login` lives under `app/(auth)/enterprise/login/`, not nested inside `app/(enterprise)/enterprise/*` — that tree is wrapped by `(enterprise)/layout.tsx`'s auth guard, which would otherwise redirect an unauthenticated visitor away from the very page meant to authenticate them.
- **Downstream redirects updated** to the correct surface: `(enterprise)/layout.tsx`'s unauthenticated bounce now targets `/enterprise/login`; `/unauthorized`'s "sign in with a different account" link is now role-aware (`organization_coordinator` → `/enterprise/login`, else `/admin-login`); `accept-org-invite/[token]`'s three post-flow login links (success/declined/invalid) now point to `/enterprise/login`, since that page is exclusively an organization-staff flow; `/login`'s reverse cross-link split into two ("Organization staff? … · Kitabu Yetu team? …").
- **Not changed**: `/enterprise`, `personas.tsx`, `navbar.tsx`'s marketing links — they still point at `/enterprise` itself (not `/enterprise/login` directly), since that URL already self-resolves correctly (dashboard if authenticated, bounces to the login page if not) — hardcoding the login URL there would have broken the experience for already-authenticated visitors clicking through from the landing page.

Verified: `tsc --noEmit`, `eslint`, full `next build` (both `/admin-login` and `/enterprise/login` compile with no route collision despite both resolving under different route groups), full Jest suite (357/357). No migration — pure routing/auth-logic change, no schema touched.
