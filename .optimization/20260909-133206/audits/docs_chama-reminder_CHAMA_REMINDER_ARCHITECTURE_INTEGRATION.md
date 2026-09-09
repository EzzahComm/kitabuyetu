# Chama Reminder — Architecture Integration Report

**2026-08-08.** Grounds a pasted 48-section implementation prompt for "Chama Reminder" (a lighter, SMS-only communication product positioned as a Kitabu Yetu acquisition channel) against the real codebase. Delivered via 3 parallel Explore agents (tenancy/billing/entitlements; auth/RBAC/member model/admin; jobs/dedup/templates/design system) plus direct knowledge of the SMS subsystem from this session's own work on it. Every claim below is source-cited; nothing is assumed from the pasted prompt's own descriptions of a generic SaaS.

No code has been written yet. This is the audit the prompt's own §44/§45 asks for — implementation should not start until the open decisions in §5 are resolved.

## Headline verdict

**Most of what the prompt asks to reuse genuinely exists and is reusable as described.** RBAC/permissions, the reminder-deduplication engine, the SMS provider/billing/opt-out stack, the tenant model, and the portal/design-system pattern are all real, production-proven, and match the prompt's assumptions closely. **The two things the prompt treats as "already there to build on" that are NOT there are the most consequential**: there is no multi-product entitlement concept, and subscription activation is not actually payment-gated today (for either product). Both are real gaps, not oversights in this analysis — and both need a decision before anything else in the prompt can be built faithfully.

| Area | Verdict |
|---|---|
| Tenant model (`groups`) | ✅ Reuse as-is |
| RBAC / permission strings | ✅ Reuse as-is — additive only |
| Reminder dedup (`reminder_dispatch_log`) | ✅ Reuse as-is — already load-bearing for 2 reminder types |
| SMS send/bill/opt-out/template pipeline | ✅ Reuse as-is (this session shipped several fixes to it) |
| Portal/design system | ✅ Reuse as-is — new portal is config, not new infra |
| API middleware conventions | ✅ Reuse as-is |
| Birthday automation | 🟡 Half-built, inert — real but scoped follow-up, not new territory |
| Bulk/scheduled template rendering | 🟡 Real gap, contained fix |
| Multi-product entitlement model | ❌ Does not exist — genuine new design |
| Payment-gated subscription activation | ❌ Does not exist for **any** product today — genuine new design |
| Lightweight/product-scoped registration | ❌ Does not exist — `register_group()` always seeds full Kitabu Yetu |

---

## 1. Tenancy — reuse as-is

`groups` is unambiguously the real tenant: "The top-level tenant entity. Every data row in the system belongs to a group" (`supabase/migrations/20260101000001_002_core_tables.sql:7-8`). It owns one `billing_accounts` row and one `subscriptions` row.

`organizations` (formerly `ngos`) is a **separate, thinner** oversight/funding layer — no `plan_type`, no `subscriptions` row, only an SMS credit balance with its own negotiated rate (`organization_billing_accounts`, `20260710010000_051_organization_billing.sql:16-29`). It is not a candidate tenant for Chama Reminder's own subscription.

**No change needed.** Chama Reminder groups are `groups` rows exactly like any other chama.

## 2. Product / entitlement model — does not exist, needs real design

- `subscriptions.plan_type` is a **closed enum**: `'starter' | 'growth' | 'enterprise'` (`20260101000000_001_init_enums.sql:7-11`), never altered since. There is no room in it for "Chama Reminder Basic/Standard/Plus/Pro/Enterprise" without either polluting the same enum with a second product's tiers or building something new.
- A group has **exactly one active subscription**, enforced by a partial unique index (`...005_billing.sql:57-59`). The prompt's §29 model ("one organization, multiple products, each with its own plan") is structurally impossible against the current schema as-is.
- `feature_flags` (`20260101000025_025_admin_backoffice_tables.sql:92-103` + service at `lib/services/feature-flags.service.ts`) is the closest existing thing to "entitlements," and it is **not sufficient**: `isFeatureEnabled()` returns a plain `boolean`. Its `applies_to='group'`/`conditions.group_ids` targeting mechanism is directly reusable for "which groups have Chama Reminder enabled," but there is no plumbing anywhere that reads a *numeric* value out of `conditions` (an included-SMS count, a member cap) — every consumer treats it as on/off. Of the 11 seeded flags, 8 gate features that were never built at all (`bulk_sms`, `advanced_analytics`, etc.) — this table has a track record of being aspirational, not load-bearing.
- `max_members` enforcement (the prompt's §24 requirement) **does technically exist**: `billingService.assertMemberCap()` (`lib/services/billing.service.ts:95-109`) is correctly wired into `members.service.ts:118`'s `create()`. But it is **dead in practice** — `PLAN_FEATURES` (`types/enums.ts:27-69`) sets `maxMembers: null` (unlimited) on all three existing plans, by explicit design ("ALL features unlocked on ALL plans... If feature gating is reintroduced later, this is the single place to edit"). Nothing today ever writes a non-null `max_members`. The enforcement code is correct and just needs real config to become live — not new infrastructure.
- `register_group()` (current body: `20260807000000_124_sms_bundled_allowance.sql:347-550`) has **no product parameter at all** — every new group gets the full Kitabu Yetu starter subscription, chart of accounts, and GL seeding unconditionally. There is no "sign up for just Chama Reminder" path today.

**This is real, necessary new design work — see Decision A in §5.**

## 3. Billing & payment activation — a bigger gap than expected, affects both products

The prompt is emphatic (§5, §6, §44) that a subscription must never activate before payment is *confirmed*. Checked what actually happens today:

- `billingService.upgradePlan()` (`lib/services/billing.service.ts:58-80`) **immediately** sets `status='active'` on a new plan — no payment check of any kind. The only gate is the `billing.manage` permission (granted solely to `chairperson`, `20260606140000_077_role_permissions.sql:38`). A chairperson can self-upgrade their group's plan with one API call and zero money changing hands.
- `recordPayment()` (`billing.service.ts:157-195`) is a fully separate, manual, admin-typed action (payment method + date + optional receipt number, inserted as `status='completed'`) with **no linkage back to `upgradePlan()`**.
- M-Pesa STK does accept `purpose: 'subscription'` (`lib/validators/mpesa.schema.ts:20`, bill-ref parsing in `lib/utils/mpesa-bill-ref.ts:30,56`), but **no code path anywhere consumes it to actually change `subscriptions`** — confirmed by the callback's own comment: *"Other purposes (registration, subscription, sms_topup) are handled by the existing billing pipeline via the payments/invoices update above — no domain action needed here"* (`lib/services/mpesa-stk.service.ts:398-400`). Only `sms_topup` has real domain-specific fulfillment logic in the callback (`app/api/v1/mpesa/callback/route.ts:88-113`).
- A dormant `platform_billing` table (`20260605121330_066b_platform_billing_table.sql:19-37`, looks like a periodic billing ledger) has **zero TypeScript references anywhere** — dead, not a hidden implementation of any of this.

**Kitabu Yetu itself does not have the payment-gated subscription activation the prompt assumes exists as a baseline.** This is the single most consequential finding in this report — see Decision B in §5.

## 4. RBAC / permissions — reuse as-is, additive only

Two role representations coexist (legacy `group_members.role` enum + newer `roles`/`role_id` table with a `permissions text[]` column), kept in sync by trigger, both live in production code — no migration needed to unify them for this work.

Adding new permission strings (`chama_reminder.sms.send`, `chama_reminder.templates.manage`, etc.) is **purely additive seeding**, proven by three real precedents (migrations 110, 112, 113) that all do the same `array_agg(DISTINCT permissions || ARRAY['new.string'])` pattern into existing roles. Route-level enforcement is `withPermission(req, 'chama_reminder.sms.send', handler)` — the exact same middleware every other route uses (`lib/auth/middleware.ts:96-105`).

`member_role` is a closed 4-value enum (`chairperson`, `treasurer`, `secretary`, `member` — confirmed current, no `auditor`). Chama Reminder's own permission strings should scope onto these same four roles, not invent a new role axis.

**Real gap, separate from permissions**: there is no "which product(s) does this session have" concept anywhere — not in the JWT (`TenantAccessTokenPayload`, `lib/auth/jwt.ts:15-37`), not in `AuthContext`. Permission strings alone can gate individual API routes, but gating an entire **UI surface** (e.g., "only show the Chama Reminder nav if this group has that product") needs something new — see Decision A.

## 5. Open decisions — DECIDED 2026-08-08 (via AskUserQuestion)

### Decision A — how is "product" modeled?

Given the prompt's own explicit instruction (§30: reuse `subscriptions`, don't duplicate) and its §29 multi-product-per-organization model, the grounded options were:

1. **Add a `product` column to `subscriptions`, loosen the one-active-subscription-per-group constraint to one-per-`(group, product)`.** `plan_type` keeps its existing 3 values *within* Kitabu Yetu; Chama Reminder gets its own small `plan_type`-equivalent (or reuses a differently-scoped enum). Closest to the prompt's own architecture, but touches a constraint every existing billing code path assumes is "one row."
2. A parallel `chama_reminder_subscriptions` table — fully isolated, but exactly the duplication §30 says not to do.
3. Extend `feature_flags` with numeric config — reuses the most infrastructure, but a weak foundation (8 of 11 seeded flags gate features never built).

> **DECIDED: option 1.** Requires a migration widening the partial unique index and threading a `product` value through `register_group()`, `upgradePlan()`, `feature-flags.service.ts`'s plan-rank check, and the admin `groups` list filter (which already has a `plan` filter to extend, per §8 below).

### Decision B — does subscription activation become genuinely payment-gated?

Since §3 found this doesn't exist for Kitabu Yetu either, two paths:

1. **Build it as shared platform work** — `upgradePlan()` moves behind a real payment-confirmation step, and the M-Pesa `purpose:'subscription'` callback finally does something. Changes live behavior for existing chairpersons (no more instant self-upgrade).
2. Chama-Reminder-only payment gate, leaving Kitabu Yetu's existing instant self-service upgrade untouched.

> **DECIDED: option 1 (platform-wide).** Fixing it once fixes it for both products, and avoids the platform ending up with two inconsistent activation philosophies.

### Decision C — how does a brand-new organization sign up for *just* Chama Reminder?

`register_group()` always seeds the full Kitabu Yetu stack today (16-account chart of accounts, GL, starter subscription).

1. **Extend `register_group()` with a `product` parameter** that conditionally skips GL/chart-of-accounts seeding for a Chama-Reminder-only signup.
2. Upsell-only — no standalone signup, every group is Kitabu Yetu first.

> **DECIDED: option 1 (standalone signup).** Matches the prompt's own "entry-level acquisition product" positioning — real new registration-path work, not just a portal add-on to existing groups.

## 6. What's already fully reusable — no new infrastructure

### Reminder deduplication — production-proven, directly reusable

`reminder_dispatch_log` (`20260730020000_106_reminder_dispatch_log.sql`) is **exactly** the mechanism the prompt's §20 asks for: `UNIQUE (reference_type, reference_id, reminder_stage)`, claimed atomically via `INSERT ... ON CONFLICT DO NOTHING RETURNING id` (not check-then-act), with an immutability trigger blocking mutation of sent/suppressed rows. It's already load-bearing for both existing automated reminder types (`handleLoanDueAlerts`, `handleContributionReminders`, both via `reminder.service.ts`'s `sendOnce()`), and its own migration comment explicitly anticipates future reuse for "any future recurring-obligation scanner." A "meeting reminder" or "contribution-due communication reminder" (the prompt's §14 — explicitly communication-only, no financial side effect) is a direct fork of this exact pattern: `referenceType: 'meeting', referenceId: meeting.id, reminderStage: '24h_before'`.

### SMS pipeline — reuse as-is (this session's own work)

Send/bill/reserve/settle, per-group opt-out (confirmed genuinely per-group, not global), the credit-reservation and bundled-allowance model, `clientSmsId`-based bulk-response alignment, and job-retry idempotency were all directly worked on and hardened in this session (`docs/audits/SMS_MESSAGING_AUDIT_2026-08.md`, `docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md`). Chama Reminder should call `smsService`/`notifyMember` exactly like every existing feature — there is no reason for it to touch `textsms.service.ts` or the provider layer directly.

**Two real, unrelated-to-Chama-Reminder gaps this session's work did not touch, worth fixing as shared platform work regardless of Chama Reminder**:
- **Birthday SMS is half-built, not absent.** `TEMPLATE_KEYS.BIRTHDAY` template exists, `sms_group_settings.auto_send_birthday BOOLEAN` exists, `sms_schedules.schedule_type` enum already includes `'birthday'`/`'loan_due'` — but `sms-scheduler.service.ts`'s own header comment says outright: *"The 'birthday' and 'loan_due' types are intentionally NOT processed here... left for a dedicated follow-up."* Its query filters to `schedule_type IN ('one_time','daily','weekly','monthly')` only. A birthday-SMS job is finishing a stubbed feature, not new territory — and `members.date_of_birth` already exists (present since the very first schema migration), masked to admin/chairperson-only PII by `applyMemberMask()`. Note: `sendBirthdayEmails()` (the *email* equivalent, `lib/services/member-email.service.ts:71-98`) is flagged elsewhere in this codebase's own audit trail (`docs/audits/PRODUCTION_SCHEMA_DRIFT_AUDIT.md:111`) as **"failing now"** — worth a real fix pass before treating it as a working reference implementation to copy.
- **Bulk/scheduled sends don't render `{{variable}}` templates.** `renderTemplate()` (`lib/sms/templates.ts:10-15`) is a fully generic `{{anything}}` substitution engine, correctly used by `sendTemplated()` for single/few-recipient sends — but `sms-scheduler.service.ts:84` passes the raw template body straight into the bulk-send job with no rendering call. A personalized birthday message (`{{first_name}}`) or meeting reminder (`{{meeting_date}}`) sent via the bulk/schedule path today would go out with the literal, unresolved placeholder text. Group-level constants (`group_name`) could be pre-rendered before enqueue with no difficulty since the scheduler already has `group_id` in scope; per-recipient variables (`first_name`) need rendering to move into the per-recipient loop inside `handleSmsBulkSend`.

### Admin/reporting pattern — reuse as-is

The established convention (`app/(admin)/admin/groups/page.tsx`) is: a filtered/paginated client page using `<PaginatedTable>`, a `list<Feature>()` function in `admin.service.ts` doing a dynamic-`WHERE` paired data+count query via `withAdminDb`, exposed through a `use-admin.ts` hook. A "Chama Reminder organizations" superadmin view (§40 of the prompt) is this same pattern with different columns — the admin `groups` list already has a `plan` filter (sourced from `subscriptions.plan_type`) that a `product` filter (per Decision A) would extend naturally, not replace.

### Portal / design system — reuse as-is, no new infra

Every portal (`(dashboard)`, `(enterprise)`, `(admin)`, `(member)`) is a thin `layout.tsx` (auth guard + redirect rules) wrapping a per-portal `NAV` config array fed into the shared `components/shared/portal-sidebar.tsx`, which is explicitly designed as the reuse point for exactly this (its own doc comment states this intent). A new, deliberately-simplified Chama Reminder portal (the prompt's §36 nav: Dashboard/Members/Messages/Reminders/Campaigns/Templates/Birthdays/SMS Usage/Subscription) is a new route group + a new `NAV` array + a new thin layout file — not new sidebar/shell infrastructure.

### API conventions — reuse as-is

Every `/api/v1/*` route follows `withPermission(req, 'x.y', handler)` → Zod `.parse()` → `withDb`/`withAdminDb` → `ok()`/`handleError` from `lib/utils/response.ts`. New `/api/v1/chama-reminder/*` routes (the prompt's §31 list) are this exact shape with new permission strings.

### Audit logging — pattern exists, no shared helper to import

There is no shared `lib/audit.ts`. Nine services (`loans.service.ts`, `dividends.service.ts`, etc.) each hand-roll their own local, unexported `writeAuditLog()` helper doing `INSERT INTO audit_logs`. A Chama Reminder feature area follows the same convention (copy the pattern, e.g. from `loans.service.ts:368-380`) rather than importing something that doesn't exist.

## 7. Recommended phasing

Ordered so early phases are pure shared-platform fixes that pay off regardless of how Decisions A–C land, and the Chama-Reminder-specific/product-model work comes after those decisions are made.

**Phase 0 — Decisions.** Resolve A, B, C above before any schema work.

**Phase 1 — Shared-platform fixes (product-agnostic, safe to ship regardless of Phase 0's outcome).**
- Finish birthday SMS: wire `sms_schedules.schedule_type = 'birthday'` processing into the scheduler, using `reminder_dispatch_log` for dedup (stage = the birthday year, so it can't re-fire twice in one year even across job retries) rather than the currently-inert `auto_send_birthday` boolean alone. **Shipped, PR #44.**
- Fix `sendBirthdayEmails()` — it's currently broken; don't let a new SMS variant inherit the same bug blind.
- Render templates in the bulk/scheduled send path (group-level vars pre-rendered before enqueue; per-recipient vars rendered inside `handleSmsBulkSend`'s loop). **Shipped, PR #44.**

> **Additional Phase 1 shared-platform fix, shipped 2026-08-11 (pulled forward ahead of Phase 2):** chunked QStash bulk-SMS dispatch, closing `SMS_MESSAGING_AUDIT_2026-08.md` H3 (re-billing/re-sending a whole campaign on a single job timeout) — see `docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md` Phase 3 item 10 for the full design. Brought forward out of that doc's own sequence specifically for Chama Reminder: the product's core value is broadcast SMS at volumes existing Kitabu Yetu chamas don't reach, so the Phase 4 portal below should not ship against a bulk-send path with a known re-billing failure mode at scale.

**Phase 2 — Product/entitlement model (per Decision A).** Migration widening the subscription uniqueness constraint to `(group, product)`, `product` enum/column, threading it through `register_group()`, `upgradePlan()`, `feature-flags.service.ts`'s plan-rank logic, and the admin groups-list filter.

**Phase 3 — Payment-gated activation (per Decision B).** Real STK-push-or-invoice-then-confirm flow behind `upgradePlan()`; wire the M-Pesa callback's already-accepted `purpose:'subscription'` to actually do something.

**Phase 4 — Chama Reminder portal.** New route group, `NAV` config, dashboard (§12), SMS composer (§13), campaigns (§16), segmentation (§17) — all calling the existing `smsService`/`sms_campaigns`/`sms_schedules` machinery directly, no new SMS stack.

**Phase 5 — Reminder types.** Meeting/event/custom reminders as new `reminder_dispatch_log`-backed reference types (direct fork of the existing loan/contribution pattern); birthday automation surfaced in the new portal (backend from Phase 1).

**Phase 6 — Admin/reporting + upgrade path.** Superadmin Chama-Reminder view (extends the existing `groups` admin list pattern); the "upgrade to full Kitabu Yetu" flow (per Decision C's registration answer — either a product-add to an existing subscription row, or the full onboarding flow for a Chama-Reminder-only org that never had one).

## 8. Explicitly not duplicating (per the prompt's own §43, confirmed already true)

No new auth, no new organizations/groups table, no new member identity table, no new billing ledger primitive, no new payment processor integration, no new SMS provider integration, no new RBAC engine, no new tenant-isolation mechanism. Every one of these already exists and this report found no reason to fork any of them for Chama Reminder.
