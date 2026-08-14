# Product Concordance Audit — Schema ↔ Code ↔ UI ↔ Landing Content

**2026-08-14.** Requested as a "thorough optimization audit to ensure concurrence between the schema, the code, and the UI including content on the landing pages" — prompted by two days of heavy shipping (Chama Reminder Phase 4, the full SMS credit monetization series, the no-free-tier cutover) that no audit has looked at yet, and by a landing-page content angle this audit series has never checked before.

Delivered via 3 parallel research passes, each re-verifying rather than re-deriving prior audit ground — see §0. The two highest-stakes claims (the pricing page's actual numbers, and the `ComposeTab` bug) were independently re-read against source before being written up here, per this series' own repeated "verify before writing up" lesson.

**No fixes applied.** Findings only, with a phased roadmap at the end, per this project's established audit pattern.

---

## Executive summary

**Headline finding: the public pricing page is not merely stale, it is actively false, on every plan, in a way a paying visitor would notice immediately.** `app/pricing/page.tsx` hardcodes a `PLANS` array that predates the 2026-08-13 no-free-tier cutover and the `premium` tier — it still advertises a free Starter plan, prices Growth at KES 2,500 (real: 300) and Enterprise at a flat KES 8,000 (real: negotiated, not self-serve), invents member caps and SMS quotas that don't exist anywhere in the entitlement model, and has no concept of the `premium` tier or the Chama Reminder product at all. This is the exact "hardcoded price that can drift from the server" anti-pattern this project's own `CLIENT_SERVER_CONTRACT_AUDIT_2026-08.md` already found and fixed once — on the in-app billing page. It was never applied to the public-facing copy that actually sells the product.

**Second finding: Chama Reminder — a second, separately-priced product that shipped two days ago — has no public acquisition surface at all.** The standalone-signup entry point (`/register?product=chama_reminder`) works if a visitor already knows the URL; nothing on the homepage, navbar, footer, or persona cards links to it, mentions it, or acknowledges SMS credit monetization exists.

**Third, smaller but real: two genuine code↔UI bugs**, one of which is newly live in a portal it was never tested against. `ComposeTab`'s "Send to All Members" silently caps at 20 recipients over 100+ member groups (a Zod schema mismatch predating this week, now also reachable from the Chama Reminder portal since PR #62 made the component shared); the new SMS pricing admin screen calls the API with untyped `unknown` bodies, reproducing a bug class this project already fixed everywhere else once.

**Fourth: schema↔code concordance on the last 13 migrations is mostly clean** — the settlement/vendor-payment layer that a prior audit (Pass 2, 2026-08-09) found reverse-engineered but code-orphaned is now genuinely, fully wired end-to-end. The gaps that exist are narrow: a handful of new columns nothing writes yet (`sms_credits.package_id`/`.currency`, `settlement_requests.source_account`), three grants provisioned for access patterns nothing performs yet, and one real signal-loss bug — bulk SMS sends hardcode `notification_type = 'campaign'`, discarding the per-feature attribution the new usage-analytics screen exists to show, for the highest-volume send path in the product.

| Dimension | Verdict |
|---|---|
| Landing/marketing content vs. real product state | **Actively false on pricing; absent on Chama Reminder** |
| Schema ↔ code (migrations 134–146) | Mostly wired; a few narrow orphans, one real analytics-signal bug |
| Code ↔ UI contracts (last 36h of work) | Two real bugs, one newly widened; rest confirmed clean |

**Score: 51/100.** Scoring rationale in §5 — pulled down almost entirely by the pricing-page finding, which by itself is the kind of thing that costs real signed-up customers and real support tickets the moment someone reads the page and then hits the real billing flow.

---

## §0. Scope and method

Three parallel research passes, each told explicitly to build on prior audits rather than re-derive them:

1. **Landing/marketing content reality-check** — every public page and shared marketing component, cross-referenced against `types/enums.ts` (the real pricing/feature source of truth) and the actual entitlement model.
2. **Schema↔code concordance, migrations 134–146 only** — re-verified `PRODUCTION_SCHEMA_DRIFT_AUDIT.md` (2026-07-30), `DB_PERFORMANCE_ADVISOR_AUDIT_2026-08.md` (2026-08-06), and Pass 2's orphan-table findings (2026-08-09) as *context*, not re-checked; fresh ground truth gathered only for what shipped in the last ~36 hours.
3. **Code↔UI contract concordance on the newest surfaces** — re-ran `CLIENT_SERVER_CONTRACT_AUDIT_2026-08.md`'s own method (client payload vs. server Zod schema, side by side) against everything built in PRs #62–#68: the Chama Reminder portal, the SMS pricing admin screen, the credits panel, and every component now shared across two products.

Two of the most consequential claims (the pricing page's literal content; the `ComposeTab` schema mismatch) were independently re-read against source directly before writing this report, rather than trusted from agent output alone.

---

## §1. Landing/marketing content — the most severe findings

### 1.1 The public pricing page is wrong on every plan

`app/pricing/page.tsx:5-33` hardcodes a `PLANS` array with **no fetch, no API call, no `useQuery`** — a static top-level const, structurally identical to the exact anti-pattern `components/billing/plan-purchase.tsx`'s own header comment says was already fixed once, on the in-app billing page:

> *"This array used to carry its own prices (growth 2500, enterprise 8000) that disagreed with the server's ... a second copy here would mean customers paying an amount that fails verification."*

That fix was never applied to the public page. It still reads, verbatim, today:

| Plan | Public pricing page says | Real value (`types/enums.ts` `PLAN_MONTHLY_FEES.kitabu_yetu`) |
|---|---|---|
| Starter | **Free**, forever, "Up to 10 members" | **KES 150/month** — no free tier exists (migration 139) |
| Growth | **KES 2,500/month** | **KES 300/month** — 8.3× too high |
| Enterprise | **KES 8,000/month**, flat | **Negotiated**, never a flat self-serve price — `enterprise: 0` in the fee table means "not self-serve," not "cheap" |
| *(none)* | — | **Premium, KES 500/month** — exists, self-serve, entirely absent from the page |

Every supporting claim compounds the problem:

- **"Get started free" / "Start free and grow" / "Start free trial"** (`page.tsx:52,61,106`) — no plan is free, and there is no trial concept anywhere in `billing.service.ts`: self-serve activation happens by paying via M-Pesa STK immediately (`activateSubscriptionForPayment`, gated on a confirmed payment).
- **Member caps** ("Up to 10 members" / "Up to 100 members" / "Unlimited members") — fictional. `PLAN_FEATURES` applies `ALL_FEATURES` (`maxMembers: null`) to *every* plan of *every* product, and `billing.service.ts:314`'s own comment states the cap-enforcement code is *"Inert today: PLAN_FEATURES sets maxMembers null on every plan."* There is no tier where member count is actually limited.
- **SMS quotas** ("50 SMS per month" / "500 SMS per month" / "Unlimited SMS") — also fictional as a tier differentiator. Every subscription gets the same `sms_allowance_included` default (50) regardless of plan; nothing in `billing.service.ts` sets it per-tier, and "unlimited" doesn't exist anywhere in the credit-based model that shipped this week.
- **FAQ**: "Growth and Enterprise plans support bulk CSV import" implies Starter can't — `historicalImport: true` is part of `ALL_FEATURES`, applied identically to every plan. "What happens when I hit the member limit?" answers a question about a mechanism that doesn't exist.

`components/landing/pricing-preview.tsx` — the homepage's pricing cards — **explicitly documents itself as mirroring this file** ("Mirrors `app/pricing/page.tsx`'s PLANS exactly") and carries the identical wrong numbers, plus its own additional false claim: *"No card required to start. Every plan includes full M-Pesa integration"* (line 72) — every self-serve plan requires a confirmed M-Pesa payment before activation.

`components/landing/cta.tsx:9` and `components/landing/how-it-works.tsx:96` each carry their own **independent, mutually-inconsistent** free-tier taglines — "Free for groups up to 20 members" and "Free for small groups · No card required" — neither matching each other, the pricing page's "10 members," or reality.

**One place in the app already fixed the same false claim** — `app/(auth)/register/page.tsx:200-202` carries a code comment explaining that "Free for up to 10 members" was deliberately removed from the registration card when migration 139 shipped, because it was no longer true. That correction was never propagated to any of the five marketing surfaces above.

### 1.2 Chama Reminder has no public acquisition surface

A second product, with its own portal (`/reminder`) and its own price list (100/250/400/negotiated), shipped 2026-08-13. Grepped `chama_reminder`/`Chama Reminder` across every `.tsx` file in the repo: **10 hits, every one behind authentication or a query param nobody links to.**

- `app/(auth)/register/page.tsx` already understands `?product=chama_reminder` and renders product-specific copy — but nothing on the homepage, in `navbar.tsx`'s "Solutions" dropdown, `footer.tsx`'s link columns, or `personas.tsx`'s four audience cards points at it, mentions it exists, or explains what it costs.
- `personas.tsx`, `ecosystem.tsx`, and `comparison.tsx` all describe only Kitabu Yetu's full-ledger capability set — none acknowledge a second, lighter, SMS-only product exists.
- No sitemap or route surfaces `/register?product=chama_reminder` for discovery.

**A visitor cannot currently learn Chama Reminder exists, what it costs, or how to sign up for it, without already knowing the exact query-string URL.**

### 1.3 SMS credit monetization is entirely unmentioned publicly

Real system (live since 2026-08-13): 1 credit = 1 message, a bundled monthly allowance, then pay-as-you-go credits purchasable via packages or volume tiers. No public page mentions "credits," packages, or that SMS beyond the allowance costs extra — the pricing page's fictional per-tier SMS quotas (§1.1) are the *only* SMS-cost information a visitor can find, and they describe a model that was never built.

### 1.4 What's fine

`hero.tsx`, `problem-solution.tsx`, `features.tsx`, `showcase.tsx`, `comparison.tsx`, and the five simple pages (`about`/`contact`/`docs`/`status`/`support`) don't make pricing or free-tier claims and weren't found stale on this axis. `security.tsx` is the one component in the set built with real sourcing discipline — its own header comment maps every claim to a specific shipped audit/feature, and it holds up. `status.tsx` self-discloses that it's manually maintained rather than live-monitored — an honest caveat, not a false claim, though it carries the same silent-staleness risk class as the pricing page.

---

## §2. Schema ↔ code concordance (migrations 134–146)

### 2.1 The good news: the settlement/vendor-payment layer is now genuinely fixed

Pass 2 (2026-08-09) found `group_bank_accounts`/`settlement_requests`/`settlement_approvals`/`vendor_payments`/`platform_revenue` had **zero `CREATE TABLE` anywhere in migration history** — live in production, excised from git, migration numbers silently reused. Migration 129 recovered their schema, deliberately SELECT-only, explicitly scoped to *not* rebuild the application layer.

**Migrations 134–135 close that gap for real.** The INSERT/UPDATE RLS policies migration 129 deliberately withheld are now present, and the accompanying service layer (`settlements.service.ts`, `vendor-payments.service.ts`, `group-bank-accounts.service.ts`) is fully wired end-to-end through `app/api/v1/treasury/*` into the `(dashboard)/treasury` page. This is a genuine, verified repair of one of the two most severe findings in the prior audit batch.

**`platform_revenue` — the fifth table in that same group, holding 2 real production rows — remains untouched and exactly as orphaned as Pass 2 found it.** No migration in 134–146 or any application code references it.

### 2.2 New objects: wired vs. orphaned

| Object | Migration | Status |
|---|---|---|
| `sms_credit_ledger` + `sms_ledger_append()` | 141 | Written correctly (purchase + consume paths). **Never read by any application code** — no route or service selects from it. Matches the migration's own stated intent ("nothing reads the ledger to authorise a send"), but there is currently no in-app way to *view* it; SQL only. |
| `vw_sms_credit_reconciliation` | 141/142/146 | Grants correct and locked down. **Zero application-code references at all.** No admin route, no dashboard reads it. |
| `sms_pricing_tiers` | 143 | `getUnitPrice()` is real and load-bearing (called from the billing hot path). `listActiveTiers()` has **zero non-test callers**. |
| `sms_packages` | 143 | Admin CRUD is real; margin reporting reads it. **`listActivePackages()` has zero non-test callers** — no customer-facing route ever surfaces the catalog, and nothing ever links a real purchase to a package row (see §2.4). |
| `sms_provider_costs` | 143 | Fully wired, correctly access-controlled (§2.3). |
| `sms_credits.package_id` | 146 | **Never written anywhere.** Only ever read (`sms-margin.service.ts`'s `LEFT JOIN`), so `getRevenueByPackage()`'s per-package breakdown will permanently group 100% of real revenue under "custom quantity" until something sets it. |
| `sms_credits.currency` | 146 | **Never referenced by any application code at all** — not even a read. Pure orphan, `DEFAULT 'KES'` only. |
| `sms_credits.expires_at` | 146 | Unused, exactly as its own migration comment says ("no expiry policy yet"). Acknowledged-orphan-by-design. |
| `draw_sms_credit_lots()` | 146 | Only ever called from inside `settle_sms_credit_reservation` (SQL-to-SQL, as the SECURITY DEFINER owner). **Zero direct TypeScript callers** — its `service_role`/`app_tenant` EXECUTE grants are never actually the ones checked. |
| `settlement_requests.source_account` | 134 | The sharpest orphan in the batch: the migration's own header describes it as load-bearing (tags a settlement with `MPESA_SETTLEMENT_SHORTCODE` for reconciliation), but `settlements.service.ts`'s INSERT never includes it, and `MPESA_SETTLEMENT_SHORTCODE` has exactly one reference in the whole repo — the migration comment itself. **Column exists, is documented as necessary, has zero writers and zero readers.** |
| `settlement_requests.reconciled_at` / `vendor_payments.reconciled_at` | 135 | Read (gates `findStuck*` paging), never written. Migration 135's own header names `disbursement-watchdog.service.ts` as "the first writer" — checked directly: it never touches this column. The header claim is inaccurate. |

### 2.3 RLS/grant drift on the new SMS objects

Checked all 7 new SMS objects' migration-defined policies/grants against what the service layer actually uses. **No case found where the service layer assumes access the grants don't provide** (no hard-outage risk). The drift runs the other way: **`sms_packages`, `vw_sms_credit_reconciliation`, and `draw_sms_credit_lots()` all carry `app_tenant`/`service_role` grants for access patterns nothing in the app currently performs.** Not a security hole — everything is still correctly locked away from `anon`/`authenticated` — but it's the same shape of "an unused grant is one policy change away from mattering" that migration 142's own postmortem (this week) named as the root cause of the cross-tenant view exposure it fixed. Provisioning a grant ahead of the feature that will use it is reasonable; leaving three of them un-flagged is what this section is for.

### 2.4 A duplicate pricing concept nothing connects

`app/(dashboard)/billing/page.tsx:17` still hardcodes `SMS_TOPUP_PRESETS = [500, 1000, 2500, 5000]` — plain KES amounts, converted to a message count at send-time via `amount / rate`. This is the **only** SMS-credit-purchase UI in the app today. Meanwhile `sms_packages` (migration 143) defines a fixed-quantity/fixed-price catalog (Starter 5,000 credits @ KES 4,500, etc.) that is fully built — schema, admin CRUD, margin reporting — but has no purchase route and is never referenced by the billing page. Not in conflict today (packages are seeded inactive), but two different models of "buy SMS credit" exist with no code path connecting them.

### 2.5 One real analytics-signal bug: bulk sends lose feature attribution

`sms.service.ts:568` (`sendBulkCampaign`, the path every scheduled/recurring reminder — including Chama Reminder's core mechanism — funnels through) hardcodes:

```sql
VALUES ($1,$2,$3,0,$4,$5,'reserved',NOW(),'campaign',$6,$7,$8,$9,'textsms',$10,$11)
```

`notification_type` is always the literal string `'campaign'`, regardless of the caller's real `referenceType` — even though the *next* column, `reference_type`, correctly carries the real category. This line was directly touched by migration 144's commit (only the `rate`→`CREDITS_PER_MESSAGE` change) and the hardcoding was carried forward unfixed.

By contrast, single/transactional sends (birthday reminders, one-off notifications) correctly set `notification_type` via `notifications.service.ts:391`. **Consequence**: `sms-analytics.service.ts`'s `byFeature` breakdown — the exact metric the SMS monetization audit's "~5% populated" finding is about — will keep every scheduled/bulk send bucketed under the single uninformative label `'campaign'` forever, rather than the real feature. The population *percentage* will likely improve (rows stop being NULL), but the *useful signal* — which feature actually consumed the credits — stays lost for the highest-volume path in the product.

### 2.6 Type drift and dead code

- `types/db.types.ts`'s `Subscription` interface is missing `payment_id` (migration 138 added it with a UNIQUE constraint). No current call site dereferences it off a typed `Subscription`, so this hasn't caused a bug yet — but it's the exact "hand-maintained interface silently falls behind a real column" pattern `PRODUCTION_SCHEMA_DRIFT_AUDIT.md` already found once (`members.full_name`).
- Local row interfaces in `settlements.service.ts` and `vendor-payments.service.ts` similarly omit `idempotency_key`/`source_account`/`reconciled_at` even though `RETURNING *` queries are typed against them.
- `billing.service.ts`'s `createStarterSubscription()` — an unconditional `INSERT ... status='active', monthly_fee: 0` — has **zero callers anywhere in the repo**. `register_group()`'s SQL equivalent was removed in migrations 139/140, but this TypeScript function was never deleted. It sits one stray call away from silently reintroducing the exact free-tier bug this week's work exists to close.
- `mpesa_stk_requests` still has no central TypeScript interface (predates this batch, not a new regression — `plan_type`/`product` from migration 138 simply have nowhere typed to live).

`types/enums.ts` itself is clean: `PlanType`, `PLAN_MONTHLY_FEES`, `SELF_SERVE_PLANS` all correctly include `premium`; `SMS_RATES` was properly deleted rather than left to drift, with a comment explaining why.

---

## §3. Code ↔ UI contract concordance (last 36 hours of work)

### 3.1 Genuine bug: `ComposeTab`'s recipient cap, now live in a second portal

`components/sms/tabs.tsx:77` — `useMembers({ pageSize: 500 })`. `MemberQuerySchema` (`lib/validators/member.schema.ts:63`) has no `pageSize` field, only `limit` (default 20, max 100). Zod strips the unrecognized key silently rather than rejecting it, so "Send to All Members" / "Active Only" quietly caps at **20 recipients** for any group larger than that — no error, no toast, just a partial send.

This bug predates the last 36 hours. What's new: PR #62 moved `ComposeTab` out of a private, Kitabu-Yetu-only function into the shared, exported `components/sms/tabs.tsx` — so it is now reachable, unmodified, from inside the Chama Reminder portal too, a product whose entire value proposition is broadcast SMS at volume. A Chama Reminder group with 150 members clicking "Send to All Members" today silently reaches 20 of them.

> **Correction, 2026-08-14.** The roadmap below called this a "one-line fix (`pageSize`→`limit`)". It is not one, and the one-line version is worse than the bug: `limit` is capped at `.max(100)`, so `limit: 500` fails validation outright and the members query 422s — the compose screen would then send to *nobody*. `limit: 100` merely moves the silent cap from 20 to 100. Any client-side fix is bounded by a page size, because the client can only ask for a page.
>
> What shipped instead: `/sms/bulk` accepts `recipientType: 'all_members' | 'active_members'` and resolves the audience server-side through `resolveSmsRecipients()` — the same helper campaigns and the scheduler already use, so the three paths cannot disagree about who a group's members are. The client sends phone numbers only when a human typed them.

### 3.2 The SMS pricing admin screen reproduces a fixed bug class

`app/(admin)/admin/sms-pricing/page.tsx:51,58,65` calls `api.get`/`api.post` directly with bodies typed `unknown` (`lib/api/client.ts:183-188`), instead of adding typed helpers to `lib/api/endpoints.ts`. The two payloads sent today (`activate_tiers`, `provider_cost`) happen to match `lib/validators/sms-pricing.schema.ts` exactly, so nothing is broken *right now* — but there is zero compiler protection against the next change drifting it, reproducing verbatim the pattern `CLIENT_SERVER_CONTRACT_AUDIT_2026-08.md` already closed out everywhere else (its own §4 follow-up specifically fixed `organizationApi.deposit`'s equivalent raw call).

> **Correction, 2026-08-14 (found while fixing this in Phase 3).** "Nothing is broken right now" was wrong, and the reason is the raw call itself. `api` prefixes every path with `/api/v1` (`lib/api/client.ts:5`), so `api.get('/admin/sms-pricing')` requests `/api/v1/admin/sms-pricing` — a path that does not exist (there is no `admin` tree under `app/api/v1/`; the route is at `/api/admin/sms-pricing`). It never gets as far as a 404: `proxy.ts:260` sees a tenant-audience URL carrying the backoffice token a super_admin actually holds and returns **403 "This route requires a tenant session. Sign in at /login."**
>
> So all three calls fail, always. The SMS Pricing screen has not loaded once since it shipped in PR #68 — a correctly signed-in super admin is told to sign in. This is what the typed-helper convention is *for*: `adminFetch` is the only client that speaks to `/api/admin/*`, and going through it makes the URL right by construction rather than by memory. The payload-drift risk described above was real but was the smaller half.

### 3.3 Dead code: tier/package creation has no UI

`POST /api/admin/sms-pricing` with `kind: 'tier'` or `kind: 'package'`, and `PATCH /api/admin/sms-pricing`, are reachable only from the route/service files themselves — no UI anywhere constructs those payloads. A super-admin can activate or deactivate the pre-seeded tiers today, but cannot create a new tier, edit an existing one, or create a new package from the product. Consistent with this project's recurring "built but zero callers" pattern (`group_constitutions`, the governance tables, `sendPasswordResetEmail` before it was wired) — flagged, not fixed.

### 3.4 Minor: no loading guard on tier activation

The "Use the flat rate" / "Switch to volume pricing" buttons derive `tierIds` from `data?.tiers ?? []` with no loading check. A click that lands before the initial fetch resolves sends `tierIds: []` — schema-legal, and would deactivate every band, leaving nothing priced. Low-probability (the buttons aren't rendered disabled during load, but a very fast double-click could still race it) but cheap to guard.

> **Fixed in Phase 3, ahead of its Phase 5 slot.** It was inert while §3.2 kept the screen from loading at all; fixing that armed it. Shipping a newly-reachable "deactivate every band" click and scheduling the guard for later was not a real option, so both landed together: the buttons are disabled until the config resolves, and an empty `tierIds` is refused with a message rather than sent.

### 3.5 Confirmed clean

The birthday-toggle PUT payload, the registration form's new `product` field against `RegisterSchema`, `SmsCreditsPanel`/`useSmsAnalytics`'s field reads against the real `getUsageAnalytics()` response shape, all six new `lib/api/endpoints.ts` entries (`smsApi.analytics`, `.settings`, `.updateSettings`, `.birthdays`, `billingApi.entitlements`, `billingApi.plans(product?)` — properly typed, none `unknown`), and the `PlanPurchase` STK payload for both products' distinct `accountReference` values (`'SUBSCRIPT'` vs `'REMINDER'`) against `StkPushSchema`'s length constraints. The register page's local Zod schema remains a manually-mirrored duplicate of `RegisterSchema` (currently in sync, no compiler backstop) — a pre-existing, already-documented risk, not a new one.

---

## §4. Cross-cutting observation

Every genuinely severe finding in this report sits on the *outward-facing* edge of the system — the pricing page a prospect reads before ever touching the app, the acquisition path for a whole product, the recipient list a treasurer trusts to be complete. Every finding on the *inward* edge (schema, RLS, grants, internal admin tooling) is narrow, already access-controlled correctly, or cosmetic. This project's audit series has repeatedly found the backend/RLS/schema layer well-engineered under scrutiny; this pass is no exception. The gap this time is that the last two days of real, correct backend work never got a corresponding pass over the pages that sell it.

---

## §5. Scoring

| Category | Score | Why |
|---|---|---|
| Landing/marketing content accuracy | 15/100 | The pricing page is wrong on every number a visitor would check, plus a whole product invisible |
| Schema ↔ code concordance | 74/100 | Mostly wired, one real signal-loss bug, narrow orphans, no security exposure |
| Code ↔ UI contract concordance | 68/100 | Two real bugs (one newly widened), rest confirmed clean, established fix pattern already exists |
| **Overall** | **51/100** | Weighted toward the landing-content finding given its direct revenue/trust exposure |

---

## §6. Roadmap

Ordered by leverage and blast radius, matching this project's established phasing style.

**Phase 0 — decisions needed before building** (flag via AskUserQuestion, don't build silently):
- Should the public pricing page **fetch live** from `/api/v1/billing/plans` (matching how `/billing` and `/reminder/subscription` already work), or stay a manually-maintained static page that just gets corrected numbers? Fetching closes the drift risk permanently; a static page is simpler but will drift again the next time a price changes.
- Is Chama Reminder ready for a real public marketing presence now, or is the standalone-signup path deliberately soft-launched/unlinked for now? This determines whether Phase 1 includes new landing content or just a fix to what already exists.
- Should `sms_packages` go live on a real purchase screen in this pass, or stay dormant (as `sms_pricing_tiers`' volume bands currently do, deliberately)?

**Phase 1 — stop the false claims** (no schema change, highest leverage, lowest risk): **✅ done — PR #70.**
- Fix `app/pricing/page.tsx` and `components/landing/pricing-preview.tsx`'s numbers and remove every free-tier claim (`cta.tsx`, `how-it-works.tsx` included) — whether via live fetch or corrected static values per the Phase 0 decision.
- Remove or correct the fictional member-cap and SMS-quota feature bullets.
- Add the `premium` tier to both pricing surfaces.

*Resolution of the Phase 0 fetch-vs-static question: neither. `PLAN_COPY` moved into `types/enums.ts` beside `PLAN_MONTHLY_FEES`, and the public pages — which are server components — import them directly. That gets a live fetch's drift-proofing (one table, read by the pricing page, the billing page and the M-Pesa callback alike) at a static page's cost: no new public API surface, no client bundle, still prerendered.*

**Phase 2 — Chama Reminder acquisition surface** (per the Phase 0 decision): **✅ done — PR #71.**
- If greenlit: a real link/section on the homepage or navbar to `/register?product=chama_reminder`, and pricing content for its own (100/250/400/negotiated) tiers.

*Shipped: a `#chama-reminder` section on `/pricing` rendering its real tiers through the same `PlanGrid` component as Kitabu Yetu, entries in both the navbar Solutions menu and the footer Solutions column, and a pointer from the homepage pricing section. Every buy link carries `?product=chama_reminder` — without it `register_group()` seeds an unused chart of accounts and quotes the wrong price.*

**Phase 3 — the two code bugs**: **✅ done — PR #72.**
- Fix `ComposeTab`'s `pageSize`→`limit` mismatch (one-line fix, closes a real silent-partial-send bug now live in two portals).
- Type `app/(admin)/admin/sms-pricing/page.tsx`'s two raw `api.get`/`api.post` calls through `lib/api/endpoints.ts`, matching the established pattern.

*Both items turned out to be worse than written up, and neither fix is the one described above — see the corrections in §3.1 and §3.2. The recipient cap could not be fixed client-side at all (`limit` maxes at 100), so the audience moved server-side; the "typing nicety" on the admin screen was in fact a 403 on every call, meaning that screen had never once loaded. §3.4's guard came along with it, because fixing §3.2 is what made it reachable.*

**Phase 4 — the analytics signal-loss bug**:
- Thread the real `referenceType`/feature category into `sendBulkCampaign`'s `notification_type` column instead of the hardcoded `'campaign'` literal — restores per-feature attribution for the highest-volume send path, which is what the new usage-analytics screen exists to show.

**Phase 5 — low-risk cleanup**:
- Delete `billing.service.ts`'s dead `createStarterSubscription()` (removes a live footgun for the free-tier bug's return).
- Add `payment_id` to the `Subscription` TS interface; add the missing columns to `settlements.service.ts`/`vendor-payments.service.ts`'s local row types.
- Either wire `settlement_requests.source_account` (per its own migration's stated intent) or remove it if it's no longer needed.
- ~~Add a loading guard to the tier-activation buttons.~~ Done in Phase 3 (PR #72) — see §3.4.

**Deliberately not recommended**: rushing `sms_packages`/`vw_sms_credit_reconciliation`'s unused grants to be revoked — they're correctly locked down today and provisioning ahead of a feature is normal; only worth tightening if Phase 0 decides those features stay dormant long-term.
