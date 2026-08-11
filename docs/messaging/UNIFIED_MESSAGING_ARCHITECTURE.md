# Unified Messaging Architecture — Implementation Plan

**Date:** 2026-08-06
**Status:** Phase 1 shipped (PRs #33/#34). **Phase 2a shipped** (migration 123 — reservation, attribution, five paths unified). Decisions A and B resolved 2026-08-06 (§7); Decision C still open. Phase 2b (bundled allowance, then billing on) is next. **Phase 3 item 10 shipped out of sequence, 2026-08-11** (§5, chunked QStash bulk-SMS dispatch) — pulled forward ahead of Phase 2b/4/5 because the Chama Reminder product ([`docs/chama-reminder/CHAMA_REMINDER_ARCHITECTURE_INTEGRATION.md`](../chama-reminder/CHAMA_REMINDER_ARCHITECTURE_INTEGRATION.md)) depends on broadcast-scale SMS being safe before its portal (that report's Phase 4) ships.

> **Phase 2a correction to §2 and §4.** Research during implementation found **five** send paths, not two: three OTP paths (`password-reset.service.ts`, `group-verification.service.ts`, `organization-members.service.ts`) called the provider directly with no billing, no consent check and **no log row at all**. They now write platform-funded rows via `sendServiceSms`.
>
> Two further corrections worth carrying forward:
> - **`notifyMember` already threw.** `sendText` sat outside any try/catch, so a WhatsApp client throw escaped to callers that don't guard. The "never throws" contract was aspirational; Phase 2a made it real, because a reservation now sits downstream of it.
> - **The two entry points could not merge into one function.** `/sms/send` needs `InsufficientSmsCreditsError` → 402 and the trigger engine catches to drive `retryOrFail`, while `notifyMember`'s callers need it never to throw. Convergence is at the **primitive** layer (`lib/services/messaging-billing.ts`) with two thin contracts over it — one place bills, one place writes the ledger.
**Source:** A pasted architectural vision for SMS as a first-class platform service, adopted and reconciled against the actual codebase.
**Companion:** [`docs/audits/SMS_MESSAGING_AUDIT_2026-08.md`](../audits/SMS_MESSAGING_AUDIT_2026-08.md) (score 38/100, three Critical defects proven in production).

---

## 1. Verdict on the proposal

**The vision is right and is adopted.** SMS is both mission-critical and a monetization engine here, and the audit proved the current state cannot support either: the billed path throws invalid SQL on every call, and the path that works bills nothing.

**But most of what the proposal asks to build already exists.** This repo has a designed event bus, a durable job queue, a template system, a provider adapter, an organization-payer model, and plan-aware SMS rates. The proposal reads as greenfield because the existing pieces are *unwired*, not absent — the trigger engine has 15 event types defined and only M-Pesa emits into it.

Rebuilding them would discard working, tested code and repeat the mistake this audit series has now made several times (the capital-layer spec duplicated four live subsystems; the RBAC spec's "proposed" roles were already the live ones). **This plan adopts the proposal's semantics and rejects its greenfield framing.**

The real work is: **unify the two entry points, make billing correct and reversible, wire the events that already have a bus, and apply the rate limiter that already exists.**

---

## 2. Reality check — every proposal section against the codebase

| Proposal asks for | What actually exists | Verdict |
|---|---|---|
| Central orchestrator; "no feature should ever call the provider directly" | Only `textsms.service.ts` touches the provider. Both stacks already route through it. | **Already true at the provider layer.** The dual-stack problem is one level up, at billing/orchestration. |
| Event-driven: modules publish, notification service listens | `lib/sms/trigger-engine.ts` + `sms_trigger_rules`/`sms_trigger_executions`; 15-event catalog (`lib/sms/events.ts:14-36`); group→org→platform specificity (`:81`); conditions DSL with depth/node budgets; `ON CONFLICT (rule_id, event_id)` idempotency (`:147-164`) | **Built, and well-built.** Only ~3 emit sites wired, all M-Pesa (`mpesa-b2c.service.ts:226`, `mpesa-spine.service.ts:173`, outbox). |
| Queue everything; never synchronous | `lib/jobs/` (db, processor, handlers, types) with `sms_bulk_send`, `sms_trigger_fire`, `sms_poll_dlr`, `sms_process_schedules`, `sms_retry_failed`; retries, dedup keys, `FOR UPDATE SKIP LOCKED` | **Built.** But "never synchronous" conflicts with OTP latency and with a deliberate prior fix — see §7 Decision A. |
| Versioned templates | `sms_templates` (template_key, body, variables, category, `is_system`, `group_id NULL` = platform default); resolved at send in 3 places | **Built, not versioned.** No version column. |
| Provider adapter normalizing `"200"` vs `200` | `textsms.service.ts` already returns an internal `SmsResponse` contract (`:68-73`) | **Built, buggy.** C2 is a coercion defect *inside* the existing adapter (`:143`), not a missing layer. |
| Org billing models: central vs per-group | `sms_usage_logs.payer_type` (`group`\|`organization`) + `payer_organization_id`, `organization_billing_accounts`, `organization_sms_credits`, `debit_organization_sms_credits()` SECURITY DEFINER with access re-check | **Built** for 2 of the 3 models. "NGO sponsors first 1,000, then group pays" is genuinely new. |
| Plans with SMS rates | `subscriptions.plan_type`, `monthly_fee`, `sms_rate`, `max_members`; `feature-flags.service.ts` already tiers `starter < growth < enterprise` | **Built.** No *bundled/included* SMS allowance and no monthly reset cycle. |
| SMS ledger with full attribution | `sms_usage_logs` already carries provider_msg_id, network_id, provider, payer_type, payer_organization_id, credits_deducted, status, reference_type/id, campaign_id, created/sent/delivered timestamps | **~70% built.** Missing: `member_id`, `notification_type`, `correlation_id`, reserved-vs-consumed split, `retry_count`, template version. |
| Multi-level rate limiting | `checkRateLimit` (`lib/redis/index.ts:171`) exists; used exactly once, in `mpesa/c2b/route.ts:96` | **Primitive exists, unapplied to SMS.** |
| Omnichannel (SMS/WhatsApp/email/push) — proposed as a *later* phase | `notifyMember` already does WhatsApp → SMS fallback **plus** an in-app notification row (`notifications.service.ts:104-158`) | **Already ahead of the proposal's own phasing.** |
| Secure the DLR callback: verify provider origin, signature/IP allowlist | **There is no inbound DLR callback.** DLR is outbound *polling* (`sms_poll_dlr` → `pollPendingDlrs`, `sms.service.ts:531-580`) | **Describes a component that does not exist.** See §3. |
| Credit reservation: reserve → send → finalize/release | Debit-then-send. No refund path anywhere in the codebase. | **Genuinely missing.** Core of Phase 2. |

---

## 3. One correction that matters for security

The proposal treats C3 as a callback-authentication problem — "verify the callback originates from the configured SMS provider," add signatures or an IP allowlist. **Implementing that would not fix C3, and would leave the vulnerability open.**

There is no inbound provider callback in this system. C3 is a **missing tenant scope on an authenticated internal GET**: `app/api/v1/sms/dlr/route.ts:8-14` passes a caller-supplied `messageId` to `getDlr`, which UPDATEs `sms_usage_logs` with no `group_id` predicate. The caller is an authenticated officer of *some* group, not a spoofed provider. Provider-origin verification is the wrong control for the wrong threat model.

**The fix is to scope the query to `auth.groupId`** (and to match on an internal id rather than the provider's, which is the proposal's own good instinct, correctly applied).

Building a real inbound DLR webhook later is worthwhile — push beats a polling loop — but it is a **new capability, not a remediation**, and it must not be counted as closing C3. If built, it then genuinely needs the shared-secret/IP controls the proposal describes, and this repo already has two precedents to copy (`email/webhooks/sendgrid/route.ts:27-50` ECDSA verification; `mpesa/callback/route.ts:22-33`).

---

## 4. Target architecture

The proposal's pipeline is correct. Expressed against the code that exists:

```
Business event (loan.approved, payment.received, …)
        │  emitBusinessEvent()            ← EXISTS, 15 events, 3 wired
        ▼
Trigger engine: rules → conditions → recipients   ← EXISTS
        │
        ▼
notifyMember() / notifyMany()            ← THE single entry point
        │
        ├── consent gate (opt-out)        ← EXISTS
        ├── in-app notification row       ← EXISTS
        ├── rate limiting                 ← primitive exists, unapplied
        ├── template resolve + render     ← EXISTS (unversioned)
        ├── credit reservation            ← NEW
        ├── channel: WhatsApp → SMS       ← EXISTS
        │        └── textsms adapter      ← EXISTS (fix coercion)
        ├── billing finalize / release    ← NEW
        └── ledger write                  ← EXISTS (extend columns)
```

**Unification target: `notifyMember`, not a new orchestrator.**

This is the single most important design call in this plan, and it inverts the obvious reading of the audit. The instinct is to fix the "real" billed path (`smsService.send`) and retire the unbilled one. That is backwards:

- `notifyMember` already has the consent gate, WhatsApp fallback, in-app notification, and per-recipient outcome reporting. `smsService.send` has none of those.
- `smsService.send` has billing and a transactional log insert. That is **one capability**, and it is the broken one.
- Every production SMS has flowed through `notifyMember`. It is the proven path.

So: **move billing into `notifyMember`; demote `smsService.send` to an internal dispatch primitive.** Porting one working capability into the richer path is far less risky than porting four into the broken one.

`sendBulkCampaign` stays separate as the fan-out path — it batches and chunks, which per-recipient `notifyMember` should not do — but it must call the *same* billing and ledger primitives rather than its own copy. Extracting those primitives is what prevents the dual stack from silently reforming.

---

## 5. Phased delivery

### Phase 1 — Stop the bleeding (no new architecture)

Ships the audit's Phase 1 exactly. Deliberately additive and small; none of it depends on the redesign, and all of it is prerequisite to it.

1. **C1** — `FOR UPDATE OF ba` (`sms.service.ts:160`), plus an integration test that actually sends through `debitPayer` against real Postgres. One line; the test is the point.
2. **C2** — coerce the provider code (`Number(code) === 200`, `textsms.service.ts:143`); audit `messageid`/`networkid` for the same assumption.
3. **H2** — apply `checkRateLimit` to `send`, `bulk`, `campaign` **before** C1 re-arms them.
4. **C3** — scope `getDlr` to `auth.groupId`.
5. **H4** — `.toISOString()` on campaign `scheduledAt` (`sms/page.tsx:304`), matching what the Schedules tab already does correctly at `:593`.

**C1 and C2 must ship together.** Fixing C1 alone routes live traffic into a path that marks every success as a failure.

**Exit criterion:** one real SMS sent end-to-end through the billed path, correctly debited, correctly recorded `sent`, DLR reconciled. The audit could not prove this; Phase 1 is not done until it is proven.

### Phase 2 — Unify the pipeline and make billing reversible

The architectural core. Requires Decision B (§7).

6. **Extract billing primitives** from `sms.service.ts` into a `messaging-billing` module: `reserveCredits` / `finalizeCredits` / `releaseCredits`. Reservation replaces debit-then-send and closes H5 (no refunds) and part of H3 (re-billing on retry).
7. **Route `notifyMember` through them.** This is the moment the dual stack ends and `credits_deducted = 0` (`notifications.service.ts:241`) stops being hardcoded.
8. **Ledger extension** (migration): `member_id`, `notification_type`, `correlation_id`, `credits_reserved`, `retry_count`, `template_id`/`template_version`. Additive columns on `sms_usage_logs`; no table replacement — it already carries ~70% of the proposal's field list.
9. **Reconcile the 158 genuine vs 112 misrecorded historical rows** (Decision C).

### Phase 3 — Reliability

10. **H3** — per-recipient checkpointing in `handleSmsBulkSend`; fix `resetStuckJobs` (`lib/jobs/db.ts:41-51`) to increment `attempts` so retries are bounded.

    > **Shipped 2026-08-11, out of sequence, ahead of Phase 2b/4/5.** `resetStuckJobs`'s bound (max_attempts) shipped earlier, per H3's own "partially fixed" note in the audit. The remaining re-billing-on-retry half is now closed differently than originally scoped: rather than a per-recipient checkpoint inside one long-running job, campaigns above 100 recipients split into 50-recipient chunks published to QStash (`lib/queue/qstash.ts`), each delivered as its own independent, retried call to `/api/v1/workers/sms-dispatch-chunk`. The idempotency key `sendBulkCampaign` needed (this item's own text: "a dispatch-level idempotency key, and `/sms/bulk` has no candidate today") is now `${jobId}:chunk:${chunkIndex}` — stable across both a QStash-level retry of one chunk and a job_queue-level retry of the whole publish loop. `sendBulkCampaign`'s `sms_campaigns.recipient_count`/`.status` writes were also fixed to aggregate across calls via `totalRecipientCount` (see `syncCampaignCompletion` in `sms.service.ts`) rather than assume one call is the whole campaign — required for chunking to report completion correctly, and covered by `__tests__/integration/sms-bulk-chunk-completion.test.ts`.
11. **H6** — align chunked bulk responses on `clientSmsId` instead of array position.
12. **M1** — platform-default rules pass `'system'` as `userId` → uuid cast failure (`trigger-engine.ts:227`). Currently masked by C1; it will surface the moment C1 is fixed. **Fix in Phase 1 or 3, not later.**
13. **M5** — build a real opt-out write path. `smsService.optOut` has zero callers and `sms_group_settings` has 0 production rows, so members currently cannot opt out. Compliance-relevant.

### Phase 4 — Event coverage (the proposal's ~80 message types)

This is the proposal's largest ask by volume and its **cheapest**, because the bus exists. Each message type is: add an event constant, add an `emitBusinessEvent` call at the state change, seed a trigger rule + template. No new infrastructure.

Sequence by value:
- **Identity & security** (OTP, password reset, new-device alerts) — partially built already (SMS OTP reset shipped in PR #10). **Subject to Decision A: OTP cannot go through a cron-tick queue.**
- **Loans** (5 of 6 events already in the catalog — wiring only)
- **Savings/contributions** (3 already in the catalog)
- **Member lifecycle, governance, meetings, welfare, share-out, social**

Recommend seeding trigger rules **disabled**, enabling per group, rather than switching ~80 message types on for 5 live groups at once.

### Phase 5 — Monetization depth

14. Bundled/included SMS per plan + monthly reset cycle (new columns on `subscriptions`; the rate side already exists).
15. Hybrid org sponsorship ("first N sponsored, then group pays").
16. Template versioning.
17. Platform/org/group analytics.
18. Inbound DLR webhook (§3) replacing the polling loop.

---

## 6. What this plan explicitly does not do

- **No `cap_*`-style parallel schema.** `sms_usage_logs` is extended, not replaced.
- **No new orchestrator class.** `notifyMember` is promoted, not superseded.
- **No new event bus, queue, template engine, or provider adapter.** All four exist.
- **No provider-origin authentication as a C3 fix** (§3).
- **No mass enablement** of new message types without per-group rollout.

---

## 7. Open decisions

### Decision A — "SMS should never be synchronous" contradicts a deliberate prior fix

The proposal states SMS should always be queued. Two things conflict:

1. `sms.service.ts:253-258` documents that dispatch was **deliberately moved off background execution**: "post-response background work is not guaranteed to run on serverless — the previous `setImmediate` left messages stuck `queued` while credits were already debited." Queuing everything re-introduces the failure mode that comment records fixing.
2. The job queue drains on a **pg_cron tick**. Routing login OTP and password-reset codes through it would put a multi-minute delay on an interactive auth flow — which would break login, not improve it.

**Recommendation: hybrid.** Interactive/latency-critical messages (OTP, password reset, 2FA, device alerts) dispatch synchronously after commit, as today. Everything else — triggered events, reminders, campaigns, bulk — goes through the queue. This satisfies the proposal's actual intent (durability, retries, rate limiting, failover) without breaking auth.

Escalating rather than silently obeying, consistent with how the capital-layer spec's "single atomic Postgres RPC" non-negotiable was handled.

> **DECIDED 2026-08-06: hybrid.** The proposal's "never synchronous" rule is therefore **overridden on the record** for interactive messages. Phase 4's identity/security events must respect this — OTP does not go through the cron-tick queue.

### Decision B — Does the currently-unbilled path start charging?

Reminders, M-Pesa receipts, and role-change notices flow through `notifyMember` and have **never been billed** (production: `SUM(credits_deducted) = 0.0000` across all 270 rows). Unifying the pipeline means they start consuming credits.

This is a real business decision affecting 5 live groups, not a technical cleanup. Options: bill everything; keep system/transactional notifications free and bill only group-initiated messaging; or bill everything but grant a bundled allowance (couples to Phase 5).

> **DECIDED 2026-08-06: bill everything, with a bundled per-plan allowance.**
>
> **This re-sequences the plan.** The bundled allowance is no longer optional Phase 5 polish — it is the mechanism that keeps existing groups whole when billing switches on. Item 14 (included SMS per plan + monthly reset) therefore becomes a **prerequisite of Phase 2, step 7**, not a later enhancement.
>
> Concretely: `subscriptions` needs an included-allowance column and a reset cycle, and the reservation logic must consume free allowance before paid credits, **before** `notifyMember` starts debiting. Switching on billing first and adding allowances later would bill 5 live groups for reminders and M-Pesa receipts they have never paid for — the exact outcome this option was chosen to avoid.

### Decision C — Backfill the 112 misrecorded rows?

They are recoverable (real provider message IDs; DLR is queryable). Cheap either way, but it rewrites financial-adjacent history, so it needs sign-off rather than a drive-by fix.

---

## 8. Risk notes

- **Phase 2 touches live-money billing paths.** Per this project's convention, it needs `EnterPlanMode` + Explore agents before implementation, not just this document.
- **Credit reservation changes failure semantics.** Today a failed send silently keeps the money; after reservation it returns it. That is correct but it is a real behavioural change to group balances.
- **M1 is currently masked by C1.** Fixing C1 will expose it. Do not treat a green Phase 1 as proof the trigger engine works until a platform-default rule has dispatched successfully.
- **Migrations are not auto-deployed here.** Any Phase 2/5 migration must be applied to production by hand and verified; a green Vercel deploy never proves schema is live.

---

## 9. Reconciled against a second pasted proposal — "QStash as the platform's standard async layer" (2026-08-11)

A second pasted vision, arriving after Phase 3 item 10 shipped (§5), proposed QStash as the
standard job/event layer for SMS, loan reminders, M-Pesa processing, contribution allocation,
disbursements, all recurring jobs, and SMS billing — plus Upstash Workflow for multi-step
processes. Checked against the codebase before adopting anything, per this doc's own §1 method.

**Verdict: narrow adoption, same as §1's finding on the first proposal.** Most of what it asks
for already exists, just not via QStash:

- **"QStash may retry; the operation must be idempotent, enforced by Postgres uniqueness"** — not
  new guidance, it's the pattern already in force: `mpesa_receipt_number`/`mpesa_transaction_id`
  UNIQUE, `reminder_dispatch_log`'s `(reference_type, reference_id, reminder_stage)` UNIQUE +
  claim/settle, `sms_trigger_executions`'s `ON CONFLICT (rule_id, event_id)`, and this doc's own
  `${jobId}:chunk:${chunkIndex}` dispatch key (§5 item 10). Confirmation, not a new rule to add.
- **"Persist raw → ack fast → process async → reconcile on callback"** for M-Pesa — already the
  shape of `app/api/v1/mpesa/callback/route.ts`: `logMpesaCallback` durably persists before the
  200-ack, `after()` runs processing in the background, and a failure marks the audit row for DLQ
  replay instead of losing the event.
- **Per-installment loan-reminder schedule with immutable per-stage job IDs** (`loan-due:
  {installment_id}:D-3`, `:D-1`, `:D0`, `:D+3`) to stop a member being notified once per day —
  **checked against `handleLoanDueAlerts` (`lib/jobs/handlers.ts:374`) and already solved**, by a
  different mechanism than the proposal assumed. `reminder_stage` is computed as a *discrete*
  CASE (`due_3_days` / `due_today` / `overdue_3_days` / `overdue_7_days` / `overdue_14_days`), not
  a rolling "within N days" window, and `sendOnce()` dedupes per `(reference_type, reference_id,
  reminder_stage)` — so a daily cron scanning the same pending installment for days only ever
  fires each stage once, with no pre-scheduling needed at loan-creation time. **No change made
  here** — pre-scheduling every stage as a separate job at creation time would be strictly worse:
  it can't adapt when a loan is restructured, repaid early, or its due date changes, where the
  current compute-stage-from-`due_date`-every-run approach self-corrects for free.
- **A canonical idempotency-key string format** (`payment:{mpesa_receipt}`,
  `disbursement:{disbursement_id}`, etc.) — **not adopted as proposed.** Every idempotency
  boundary in this codebase already dedupes on a composite key (real typed/indexed DB columns, or
  a DB-enforced UNIQUE constraint), which is strictly stronger than concatenating fields into one
  string and parsing them back out. Collapsing `(reference_type, reference_id, reminder_stage)`
  into a single colon-joined string would add a serialization layer for no correctness gain. The
  convention actually in force, worth reusing verbatim for the next boundary that needs one:
  compose the dedup key from the domain's own real columns (a composite UNIQUE index, or a
  DB-generated stable id like `job_queue.id`), never a hand-built string, unless the target
  system (like QStash's own `${jobId}:chunk:${chunkIndex}` message-level key) genuinely only
  accepts a flat string.

**One idea adopted as genuinely new: Upstash Workflow for the B2C disbursement flow.**
`docs/audits/B2C_DISBURSEMENT_AUDIT.md` (34/100, 5 Critical) was the starting pointer, but is
**stale on 4 of its 5 Criticals** — checked against the live code before planning anything, same
discipline as everywhere else in this doc. `disbursements.service.ts`/`mpesa-spine.service.ts`
(a "spine: reserve → maker-checker → dispatch" pipeline, per its own route comment) now enforce a
required `Idempotency-Key` header (C2), an available-balance check and `reserved_amount` earmark
before any Daraja call (C1), and second-officer approval with approver ≠ initiator (C3); Path A
and Path B are the same call path (C4). This subsystem was rebuilt 2026-08-11 (see
[[project_kitabu_yetu_settlements_vendor_payments]]), after the audit was written.

**C5 alone is still live and verified current**: `runReconciliation()`
(`mpesa-reconciliation.service.ts:108`) only sweeps `mpesa_stk_requests` — there is no equivalent
sweep for `mpesa_b2c_transactions`. A B2C payout whose Result callback is dropped or delayed
stays `initiated` forever with its true state unknown; `queryTransactionStatus`
(`daraja.service.ts`) and its route/handler exist but are only invoked manually, never on a
schedule against stuck B2C rows. This is the one gap Workflow's durable "wait for callback, with
an explicit timeout that resumes into a status-query + reconcile step" genuinely closes, better
than either today's callback-and-hope pattern or QStash's plain fire-and-retry messaging.
**Scoped separately, not folded into this doc** — it's a disbursement-subsystem change targeting
C5 specifically, not C1–C4 (already fixed) or the audit's other still-open items (per-group float
segregation, H1 callback-origin verification, outbound DLQ/reporting), and per §8's own risk note
it touches live money and needs `EnterPlanMode` + Explore agents before implementation, same as
Phase 2 here.
