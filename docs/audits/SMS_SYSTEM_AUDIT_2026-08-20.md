# SMS System Audit — End-to-End Review & Optimization Pathway

**Date:** 2026-08-20
**Scope:** the whole SMS subsystem — architecture, sending lifecycle, provider integration, data integrity, billing, security, consent, scheduled jobs, performance, reliability, cost, code quality
**Codebase:** `main` @ `26ca54d`
**Production DB:** Supabase `qztcgryhoanennsizcll` (queried live)
**Provider:** TextSMS Kenya, partner `16532` (switched from `14643` during this audit)

---

## Evidence standard used in this document

The brief asked not to assume where the code or database does not provide evidence. Every finding below is tagged:

| Tag | Meaning |
|---|---|
| **[VERIFIED]** | Reproduced against the live production database, the live provider API, or executed code |
| **[INFERRED]** | Follows logically from code that was read, but the specific failure was not reproduced |
| **[NEEDS INVESTIGATION]** | Evidence is suggestive but incomplete; the open question is stated explicitly |

---

## 1. Executive summary

The SMS subsystem is **architecturally well-designed and substantially better engineered than typical for its stage**. The credit-reservation model, tenant isolation, rate limiting, and personalization pipeline are all sound, and the codebase carries unusually honest comments documenting prior defects and their reasoning. This audit did **not** find the system to be sloppy work.

It did find that **the system is effectively blind to what happens after a message leaves the application**, and that this blindness has been masking a total delivery outage.

Three facts frame everything else:

1. **Not one SMS in the platform's entire history has ever been recorded as delivered.** 323 messages sent, `status='delivered'` count = **0**. [VERIFIED]
2. **The delivery-report poller runs, receives correct data from the provider, and misclassifies 100% of it.** 22 delivery reports carry a real `delivered_at` timestamp from the provider while being stored with `status='pending'`. [VERIFIED]
3. **All SMS delivery has been silently broken since 2026-08-19 ~09:09–14:19 UTC** — provider-side, across two independent accounts. It was discovered by a user complaint, not by the platform. [VERIFIED]

Those three compound: (3) happened, (2) meant the platform could not see it, and (1) meant nobody had ever noticed (2). A monitoring gap turned a provider incident into a multi-day invisible outage affecting payment confirmations, contribution nudges, loan notices, and registration OTPs.

Separately, **two SMS background job types have been starved for 4–8 days** despite three rounds of fixes, and the job queue is growing faster than it drains.

**Headline priorities**

| # | Action | Severity | Effort |
|---|---|---|---|
| 1 | Fix DLR field misread (`delivery-status` → `delivery-description`) | Critical | ~1 hour |
| 2 | Alert on delivery-rate collapse and provider queue stalls | Critical | ~1 day |
| 3 | Resolve the TextSMS dispatch stall (provider escalation) | Critical | External |
| 4 | Fix job-queue starvation properly (dedicated lanes, not rotation) | High | ~2 days |
| 5 | Implement STOP/opt-out inbound handling (compliance) | High | ~2 days |

---

## 2. Current architecture and data flow

### 2.1 Component map [VERIFIED — files read]

```
                        ┌──────────────────────────────────────┐
   API surface          │ /api/v1/sms/{send,bulk,campaign,     │
   (18 routes)          │  schedules,templates,usage,dlr,...}  │
                        └──────────────┬───────────────────────┘
                                       │ withPermission('messaging.send')
                                       │ + enforceSmsRateLimit(surface, groupId)
                                       ▼
      ┌────────────────────────────────────────────────────────────────┐
      │  lib/services/sms.service.ts   (1,373 lines — the core)        │
      │    send()  · sendTemplated()  · sendBulkCampaign()             │
      │    pollPendingDlrs()  · retryFailures()  · getDlr()            │
      └───────┬───────────────────────────────┬────────────────────────┘
              │                               │
              ▼                               ▼
  ┌──────────────────────────┐   ┌─────────────────────────────────────┐
  │ messaging-billing.ts     │   │ notifications.service.ts            │
  │  reserveCredits()        │   │  notifyMember()  (consent-gated)    │
  │  settleReservation()     │   │  sendServiceSms() (platform-funded, │
  │  raiseLowBalanceAlert()  │   │    consent-EXEMPT, never throws)    │
  └───────────┬──────────────┘   └──────────────┬──────────────────────┘
              │                                 │
              │ reserve_sms_credits()           │
              │ settle_sms_credit_reservation() │
              ▼                                 ▼
     ┌─────────────────┐          ┌──────────────────────────────────┐
     │ Postgres RPCs   │          │ textsms.service.ts (provider)    │
     │ billing_accounts│          │  sendSingleSms · sendBulkSms     │
     │ organization_*  │          │  getDeliveryReport · getBalance  │
     └─────────────────┘          └──────────────┬───────────────────┘
                                                 │ HTTPS
                                                 ▼
                                    ┌────────────────────────────┐
                                    │  TextSMS Kenya API         │
                                    │  sms.textsms.co.ke         │
                                    └────────────────────────────┘

  Background:  job_queue → lib/jobs/processor.ts → handlers.ts
    sms_poll_dlr · sms_retry_failed · sms_release_stale_reservations
    sms_process_schedules · sms_bulk_send · sms_low_balance_alert
    sms_allowance_monthly_reset · sms_birthday_reminders · sms_trigger_fire
```

### 2.2 The send lifecycle [VERIFIED]

The **billed path** (`smsService.send` / `sendBulkCampaign`):

1. Normalize phones → `normalizePhone()` (E.164, `254…`)
2. Suppress opt-outs → `sms_group_settings.opt_out_phones` array
3. **Reserve** credits inside a transaction → `reserve_sms_credits()` RPC
4. Insert `sms_usage_logs` rows: `status='queued'`, `billing_state='reserved'`
5. Commit, **then** dispatch to provider (never holds a DB connection across HTTP)
6. Align responses back to log rows by `clientSmsId`, not array position
7. Update rows to `sent`/`failed` with `provider_msg_id`
8. **Settle**: accepted → `consume`, rejected → `release`
9. Rejected rows also get an `sms_failures` row with a 5-minute backoff

The **platform path** (`sendServiceSms`) — auth codes, OTPs, invitations — writes `payer_type='platform'` (a CHECK constraint guarantees zero charge), skips the consent gate deliberately, and **never throws**.

### 2.3 What is genuinely well done

Worth stating explicitly, because the findings below are all problems:

- **Reservation over debit-then-refund.** Retries are safe by construction rather than by remembering to refund. The reasoning is documented in `messaging-billing.ts`'s header and it is correct.
- **`clientSmsId` alignment** instead of positional matching across chunked sends — a subtle bug class, already closed.
- **Payer is stated, never inferred.** A group can be overseen by several organizations, so `payer_type`/`payer_organization_id` are recorded per row. Correct modelling.
- **`getDlr` scope is opt-in** (`{groupId}` vs `{system:true}`), with the ownership check *before* the provider call. This is the right shape and closes a real cross-tenant hole.
- **Index coverage on `sms_usage_logs` is genuinely good** — 11 indexes including partial indexes on `billing_state='reserved'`, `provider_msg_id IS NOT NULL`, and `correlation_id IS NOT NULL`. No missing-index findings.
- **Rate limiting exists on all three send surfaces** and is scoped per group (the budget being protected), fail-open by design.
- **Allowance reset derives the anniversary from `started_at` every run**, so it cannot drift and is idempotent at any cadence.

---

## 3. Findings by severity

### CRITICAL

---

#### C1 — Delivery reports read the wrong field; nothing is ever marked delivered

**Current problem.** `sms_usage_logs.status='delivered'` count is **0** across all 323 messages ever sent. `sms_delivery_reports` holds 22 rows with `status='pending'` — every one of which has a **non-null `delivered_at`**. [VERIFIED]

**Root cause.** `textsms.service.ts:getDeliveryReport()` reads:

```ts
status: String(data['delivery-status'] ?? data.status ?? 'unknown'),
```

Live provider payloads captured during this audit:

```json
{"message-id":"810668705","delivery-status":32,"delivery-description":"DeliveredToTerminal","delivery-time":"2026-08-14 12:57:42"}
{"message-id":"821169663","delivery-status":32,"delivery-description":"Scheduled","delivery-time":null}
```

`delivery-status` is the constant **32 for both outcomes**. The human-readable verdict lives in `delivery-description`. So `classifyDlrStatus()` receives the string `"32"`, matches neither the failure regex nor the delivered regex, and returns `'pending'` — **always**. Executed to confirm:

```
"32"                  -> pending      ← what the code actually passes
"DeliveredToTerminal" -> delivered    ← what it should pass
"Scheduled"           -> pending
"Rejected"            -> failed
```

The `SMS_CODES` map in the same file (`200: Success, 1001: Invalid Sender ID, …`) documents *send* response codes and has no bearing on the DLR endpoint. There is no numeric-status mapping table anywhere in the codebase, which is consistent with `delivery-status` never having been understood.

**Risk / impact.**
- Delivery confirmation is a **product feature that has never worked once**. `sms_campaigns.delivered_count` is permanently 0.
- **Genuinely failed messages are never detected** via DLR, so they are never routed into `sms_failures` and never retried. The customer was charged.
- `pollPendingDlrs` re-polls the same messages for a full 7 days because they never reach a terminal state — wasted provider calls and wasted job-queue budget, which is a contributing cause of **C4**.
- Removed the only signal that would have caught **C2** on day one.

**Recommended solution.** Read the description, keep the numeric code as metadata:

```ts
const raw = data['delivery-description'] ?? data['delivery-status'] ?? data.status ?? 'unknown';
return {
  messageId,
  status:       String(raw),
  statusCode:   Number(data['delivery-status'] ?? NaN),  // retain, don't classify on it
  deliveredAt:  data['delivery-time'] ? String(data['delivery-time']) : undefined,
  ...
};
```

`classifyDlrStatus()` itself needs no change — it already handles `DeliveredToTerminal`, `Scheduled` and `Rejected` correctly. Add `"scheduled|queued|accepted"` to an explicit pending allowlist so an unrecognised description is logged rather than silently bucketed.

Then **backfill**: re-poll the 151 `sent` rows within the provider's retention window to recover real delivery outcomes.

**Priority: P0.** ~1 hour of work. Highest value-to-effort ratio in this document.

---

#### C2 — All SMS delivery has been broken since 2026-08-19; the platform could not see it

**Current problem.** Every message submitted since ~2026-08-19 14:19 UTC sits at `Scheduled` in the provider's queue with `delivery-time: null`, indefinitely. [VERIFIED — live provider DLR queries]

| Provider msg id | Sent | Provider verdict |
|---|---|---|
| `818620215` | 08-19 09:09 UTC | **DeliveredToTerminal** |
| `819270384` | 08-19 14:19 UTC | **Scheduled** |
| `821169663` | 08-20 13:56 UTC | **Scheduled** |
| `821262633` | 08-20 15:00 UTC | **Scheduled** |
| `821287131` | 08-20 ~15:2x UTC | **Scheduled** (new account) |
| `821288758` | 08-20 ~15:3x UTC | **Scheduled** (new account) |

**Root cause.** Provider-side, and **not** account-specific. Ruled out by direct test:
- Not credit — account `14643` holds KES 437.00; the outage began with a healthy balance.
- Not sender ID — production is correctly `KITABU YETU` (11 chars, at the alphanumeric limit but valid).
- Not credentials — `getbalance` returns `200`.
- **Not the account** — switching to partner `16532` and sending two fresh live tests produced the *same* `Scheduled` stall, one with KES 5 credit and one with KES 104.
- **Provider bills for undelivered messages** — balance moved 104.00 → 103.00 across the test sends.

Two independent partner IDs, both accepting with `response-code 200`, both queueing forever ⇒ platform-side at TextSMS.

**Risk / impact.** Total outage of every SMS-dependent flow for **>24 hours and ongoing**: registration OTPs (users cannot complete signup at all), payment confirmations, contribution nudges, loan notices. Direct revenue impact via blocked signups; trust impact via members chasing payments that were in fact confirmed. Money is being spent on messages that are never delivered.

**Recommended solution.**
1. **Escalate to TextSMS** with the evidence above. The precise question: *why are messages accepted with `response-code 200` sitting at `delivery-description: Scheduled` and never dispatched to Safaricom, across partner IDs 14643 and 16532, since 19 Aug?*
2. **Do not top up further** until the queue is confirmed moving — the test proved credit is consumed without delivery.
3. Build **C3** so the next occurrence pages within minutes.
4. **Medium-term: add a second provider.** This incident is unmitigable today because TextSMS is a hard single point of failure (see H1).

**Priority: P0 (external dependency).**

---

#### C3 — No delivery-rate or provider-health monitoring

**Current problem.** A complete, billed, multi-day SMS outage reached the business through **a user complaining that a signup code never arrived**. No alert fired. [VERIFIED]

**Root cause.** There is no monitoring on SMS outcomes at all. `sms_provider_balances` is the closest thing to a health signal, and until this audit it recorded provider *errors* as a confident `KES 0.00` (fixed in PR #108). There is no check on delivery rate, no check on queue age, no alert on provider response codes.

**Risk / impact.** Any future provider incident is again invisible until a customer reports it. For a product whose core mechanism (Chama Reminder) *is* SMS, undetected delivery failure is close to a total product outage.

**Recommended solution.** Three alerts, in priority order:

| Alert | Condition | Why |
|---|---|---|
| **Delivery-rate collapse** | `delivered / sent < 80%` over trailing 1h, min 20 messages | Catches C2 directly |
| **Provider queue stall** | any message `sent_at < now() - 30 min` still non-terminal | Catches C2 even at low volume |
| **Provider balance floor** | `credit < 500` (now that it throws instead of reporting 0.00) | Prevents credit-exhaustion outages |

Add `sms_health_check` as a job type; route to email + in-app for `super_admin`, never SMS (the same reasoning that governs `raiseLowBalanceAlert`).

**Note:** the delivery-rate alert is worthless until **C1** is fixed — today `delivered` is always 0, so it would fire permanently. **C1 must ship first.**

**Priority: P0**, immediately after C1.

---

### HIGH

---

#### H1 — TextSMS is an unmitigated single point of failure

**Current problem.** One provider, hardcoded end to end. `provider` is written as the literal string `'textsms'` at every insert site; there is no provider abstraction, no failover, no routing. [VERIFIED]

**Root cause.** `textsms.service.ts` is imported directly by `sms.service.ts` and `notifications.service.ts`. The `provider` column exists and suggests multi-provider intent, but nothing reads it to choose a transport.

**Risk / impact.** Exactly C2: when TextSMS stalls, the platform has no recourse. Switching accounts does not help (proven). This will recur.

**Recommended solution.** Introduce a provider interface and route by policy:

```ts
interface SmsProvider {
  readonly name: string;
  send(items: BulkSmsItem[]): Promise<BulkSmsResult>;
  dlr(messageId: string): Promise<DlrResult>;
  balance(): Promise<BalanceResult>;
}
```

Then: primary/secondary with automatic failover on stall or error-rate threshold; **critical-path routing** so OTPs and payment confirmations prefer the healthier provider. Africa's Talking is the obvious Kenyan secondary.

Sequencing matters — the DLR abstraction should land only after C1, so the interface is designed against a correct understanding of delivery semantics.

**Priority: P1.** ~1 week.

---

#### H2 — Two SMS job types have been starved for 4–8 days

**Current problem.** [VERIFIED — live `job_queue` counts]

| Job type | Pending | Oldest due | Last completed |
|---|---|---|---|
| `sms_release_stale_reservations` | **2,258** | 2026-08-12 20:20 | **2026-08-12 20:15** |
| `sms_poll_dlr` | **1,100** | 2026-08-16 20:50 | **2026-08-16 20:45** |
| `sms_process_schedules` | **841** | 2026-08-17 18:25 | 2026-08-17 18:20 |
| `sms_retry_failed` | 35 | 2026-08-20 13:35 | 2026-08-20 13:30 ✓ |

`sms_release_stale_reservations` has not completed a single job in **8 days**. `sms_poll_dlr` in **4 days**. Both are enqueued every 5 minutes, so the backlog grows ~288 rows/day each, unbounded.

**Root cause.** Job-queue starvation, addressed by three successive fixes (#103 per-type caps, #104 round-robin, #106 tick rotation) — **none of which resolved it for these two types**. The queue drains by priority (`idx_job_queue_pick` orders `priority DESC, run_at`), and these are priorities 3–4, the lowest. Higher-priority work fills the per-tick budget before rotation reaches them. This audit confirms the concern already recorded after #106 deployed: the two worst-stuck types showed no progress.

**Risk / impact.**
- **Stale reservations are never swept.** No rows are currently stuck in `billing_state='reserved'` [VERIFIED], so no live money is trapped — but that is a function of low volume, not of the sweeper working. At scale this becomes trapped customer credit.
- DLR polling is dead, compounding C1.
- **The backlog itself is now a performance problem** — 4,000+ pending rows scanned every tick.

**[NEEDS INVESTIGATION]** `sms_delivery_reports.queried_at` shows a poll at **2026-08-20 15:35**, while `sms_poll_dlr` last *completed* on 08-16. Something polled DLRs outside the job's completion accounting. Candidates: the manual `/api/v1/sms/dlr` route, or jobs executing without their queue row being marked complete. If the latter, job-completion accounting is itself unreliable and the backlog numbers understate the problem. **Resolve this before designing the fix.**

**Recommended solution.** Stop tuning the shared queue. Give starvation-prone maintenance jobs **guaranteed capacity** rather than a fair share:

1. **Dedicated lanes** — a reserved slice of each tick for maintenance types, so high-priority traffic cannot consume 100% of the budget.
2. **Age-based priority escalation** — `effective_priority = priority + floor(age_minutes / 30)`, so anything starved long enough eventually outranks everything.
3. **Collapse redundant enqueues** — these are idempotent sweeps; 2,258 pending copies do the work of one. Dedup on `(type, status='pending')` rather than a 5-minute bucket key, and **purge the existing backlog** as part of the fix.

**Priority: P1.** ~2 days. Do (3) immediately as a quick win.

---

#### H3 — No STOP / inbound opt-out handling (compliance exposure)

**Current problem.** There is **no inbound SMS webhook** anywhere in the codebase. [VERIFIED — no route under `app/api` matching webhook/inbound/callback for SMS] Opt-out exists only as `smsService.optOut(groupId, phone)`, reachable through the app UI. **A recipient replying STOP has no effect whatsoever.**

**Root cause.** The opt-out model was built group-facing (an officer removes a number) rather than recipient-facing.

**Risk / impact.** Kenya's **Data Protection Act 2019** requires a clear mechanism to withdraw consent, and CAK consumer-protection guidance expects opt-out on unsolicited messaging. Members receiving campaign SMS today have **no self-service way to stop them**. This is a regulatory and reputational exposure, not merely a feature gap — and it grows with every campaign sent.

Two secondary gaps in the same area:
- **Opt-out is per-group, not per-platform.** A member in three groups must opt out three times. `opt_out_phones` is a `text[]` on `sms_group_settings`.
- **No opt-out footer.** Campaign messages carry no "Reply STOP to opt out" text, so even a working handler would be undiscoverable.

**Recommended solution.**
1. Add `POST /api/v1/webhooks/sms/inbound`, signature-verified, parsing `STOP`/`SITISHA`/`ACHA` (English + Swahili) case-insensitively.
2. Promote opt-out to a first-class table — `sms_opt_outs (phone, group_id NULLABLE, scope, opted_out_at, source)` — where `group_id IS NULL` means platform-wide. The current `text[]` does not scale and cannot record *when* or *how* consent was withdrawn, which is precisely what a regulator asks for.
3. Append an opt-out footer to `campaign` and marketing-class messages. **Not** to transactional or OTP messages — those are service messages, and the footer costs a second segment.
4. Keep the existing `sendServiceSms` consent exemption for OTPs; that is correct and defensible.

**Priority: P1.** ~2 days.

---

#### H4 — 53% lifetime failure rate, never investigated

**Current problem.** Of 323 messages: 151 `sent`, **172 `failed`**, 0 `delivered`. A 53% failure rate. [VERIFIED]

**Root cause.** [NEEDS INVESTIGATION] Not determinable from status alone. `failed_reason` is populated, but the historical distribution was not analysed in this pass. Note that some of this is *reporting* rather than genuine failure: an earlier confirmed bug recorded accepted messages as `failed` with `failed_reason: "Success"` (112 such rows) because of a response-code parsing defect, since fixed.

**Risk / impact.** The true failure rate is unknown, which means the real cost of waste is unknown. If a meaningful share are genuine, the platform is paying for messages that never arrive — on top of C2.

**Recommended solution.** Run a `failed_reason` distribution before optimising anything:

```sql
SELECT failed_reason, count(*), min(created_at), max(created_at)
FROM sms_usage_logs WHERE status='failed'
GROUP BY 1 ORDER BY 2 DESC;
```

Then classify per §8 and decide retry policy by class. This is cheap and should precede any cost work.

**Priority: P1** (investigation), ~2 hours.

---

### MEDIUM

---

#### M1 — Low-balance alerts never re-arm

`clearLowBalanceFlag()` exists and **has no callers** — `billing.service.ts:addSmsCredits()` never invokes it. [VERIFIED — documented in `messaging-billing.ts:228-232` as a known, deliberately unfixed gap]

**Impact.** After one low-balance alert, a group that tops up never re-arms the alert; the next time it runs dry, it is warned only if 24h has elapsed. Given C2 proved credit exhaustion causes silent outages, this matters more than it looks.

**Fix.** Call `clearLowBalanceFlag(groupId)` from `addSmsCredits()` and `clearOrganizationLowBalanceFlag()` from `addOrganizationSmsCredits()`. ~30 minutes. **Priority: P2.**

---

#### M2 — Eight messages delivered free (historical, unreconciled)

8 rows hold `billing_state='released'` **and** `status='sent'` — accepted by the provider but with credits returned. [VERIFIED] All dated 2026-08-16 14:43, which is **before** PR #93 (`4a085cc`, merged 2026-08-16 22:13) fixed retry billing.

So the *code* bug is fixed. What was never done is the **backfill** — these 8 remain unbilled, and no reconciliation job would detect them.

**Fix.** Add a reconciliation query to the (currently unused) `vw_sms_credit_reconciliation` view surfacing `billing_state='released' AND status IN ('sent','delivered')` as an anomaly class, and settle the 8 historical rows. **Priority: P2.**

---

#### M3 — `sendServiceSms` failures are invisible to the caller (partially fixed)

`sendServiceSms` returns `{sent, detail}` and never throws. Callers that ignore the return report success unconditionally.

Fixed for group verification in PR #108 (`startGroupVerification` now raises `OTP_SEND_FAILED`). **Other callers were not audited in this pass** — password reset and organization invitations follow the same pattern. [NEEDS INVESTIGATION]

**Fix.** Audit every `sendServiceSms` call site; each must either act on `sent === false` or document why it deliberately ignores it. **Priority: P2.**

---

#### M4 — `sms_provider_costs` has RLS enabled and zero policies

[VERIFIED] RLS on with no policies is **deny-all** for non-superuser roles — fail-closed, so not a security hole. But it means the table is unreadable through the tenant connection, which either indicates dead schema or a feature silently broken since `app_tenant` cutover.

**Fix.** Determine whether the table is live. If yes, add an explicit `super_admin`-only policy; if no, drop it. **Priority: P2.** Note: any new policy or view here must follow the project's established grant hygiene — `CREATE OR REPLACE` resets function privileges, and new views are auto-granted to `anon`/`authenticated` by Supabase.

---

#### M5 — Rate limiting counts requests, not recipients

`SMS_RATE_LIMITS` caps `bulk` at 5 requests/60s, but `BulkSmsSchema.phones` permits up to **5,000 recipients per request**. A compromised officer token can therefore submit **25,000 messages per minute** within the limit. [VERIFIED — documented as a known gap in `lib/sms/rate-limit.ts`]

The credit balance is the real backstop, and `checkRateLimit` is fail-open by design, so this is not an accounting hole — but it is a cost-blast-radius hole.

**Fix.** Add a recipients-per-window counter alongside the request counter. **Priority: P2.**

---

### LOW

---

- **L1 — `personalize()` renders per recipient with no length guard.** A long `{{full_name}}` can push a message past 160 chars into a second billed segment, invisibly. Add a post-render length check and surface segment count at campaign preview. [INFERRED]
- **L2 — No message-length/segment accounting anywhere.** `credits_deducted` assumes 1 message = 1 credit (`CREDITS_PER_MESSAGE`), but a 200-character message is **2 segments** and costs the provider double. The platform under-bills long messages. See §11. [VERIFIED — code read]
- **L3 — `sms.service.ts` is 1,373 lines** spanning sending, billing coordination, DLR, retries, opt-out, and analytics helpers. Split along existing seams (`sms-send`, `sms-delivery`, `sms-consent`). [VERIFIED]
- **L4 — `classifyDlrStatus` regex ordering is correct but fragile.** `/undeliv|fail|.../` is tested before `/deliv|.../` specifically so `UNDELIV` is not caught by `deliv`. Correct, and load-bearing — it needs a regression test pinning exactly that. [VERIFIED]
- **L5 — Two independent opt-out read paths** (`fetchOptOuts` in `sms.service.ts`, `isOptedOut` in `notifications.service.ts`) query the same column separately. Consolidate when H3 introduces the real table.

---

## 4. Quick wins (ship this week)

| # | Change | Effort | Impact |
|---|---|---|---|
| 1 | **C1** — read `delivery-description` | 1h | Restores delivery tracking entirely |
| 2 | **H2(3)** — purge job backlog, fix dedup keys | 2h | Removes 4,000-row scan per tick |
| 3 | **M1** — call `clearLowBalanceFlag` on top-up | 30m | Alerts re-arm |
| 4 | **H4** — run the `failed_reason` distribution | 2h | Unblocks cost work |
| 5 | **M2** — settle the 8 unbilled rows | 1h | Revenue recovery + anomaly class |
| 6 | Backfill DLRs for the 151 `sent` rows | 2h | Recovers real history (after #1) |

**Total ≈ 1.5 days for a disproportionate share of the value in this document.**

---

## 5. Medium-term (next 4–6 weeks)

1. **H1 — provider abstraction + failover.** The single highest-leverage structural change. Sequence after C1.
2. **H3 — consent subsystem.** Inbound webhook, `sms_opt_outs` table, platform-wide scope, footers.
3. **H2 — job-queue lanes + age escalation.** Stop iterating on the shared-priority model.
4. **Segment-aware billing (L2).** Compute segments at send time; store `segments` on `sms_usage_logs`; bill `segments × rate`.
5. **Split `sms.service.ts` (L3).**

---

## 6. Long-term architecture

**Target shape:**

```
  Producers → sms_outbox (durable, idempotency_key UNIQUE)
                   ↓
            Dispatcher workers (N, claim by SKIP LOCKED)
                   ↓
            Provider router  ── health/cost/route policy
              ↓           ↓
          TextSMS    Secondary provider
                   ↓
            DLR reconciler (webhook-first, poll as fallback)
                   ↓
            Billing settler (reservation → consume/release)
```

Key shifts:

- **Outbox with a UNIQUE `idempotency_key`** makes duplicate suppression a database invariant rather than an application concern. Today dedup relies on `correlation_id` lookups in application code (`sendBulkCampaign`'s H3 handling) — correct, but not enforced by the schema.
- **Webhook-first DLR.** Polling is inherently laggy and expensive; if TextSMS supports DLR callbacks, that removes `sms_poll_dlr` entirely and with it the largest source of job-queue pressure. **[NEEDS INVESTIGATION — confirm with the provider.]**
- **Separate dispatch workers from the general job queue**, so SMS throughput cannot be starved by unrelated work (H2's root cause, structurally resolved).
- **Partition `sms_usage_logs` by month** once volume justifies it (~1M rows). Not needed now at 323 rows.

---

## 7. Performance & scalability

**Current volume: 323 messages, 4 groups sending.** The system is nowhere near its limits, so most scaling concerns are latent rather than active.

| Volume | Expected behaviour |
|---|---|
| **Today (10²)** | Fine. Indexes ample. |
| **10³–10⁴/mo** | Job-queue starvation (H2) becomes materially damaging; stale reservations start trapping real customer credit. |
| **10⁵/mo** | `sendBulkCampaign`'s **row-at-a-time INSERT loop** becomes the bottleneck — one round trip per recipient inside a transaction. A 5,000-recipient campaign is 5,000 sequential inserts. Must become a single multi-row `INSERT … SELECT unnest()`. [VERIFIED — code read, `sms.service.ts:576-600`] |
| **10⁶/mo** | Requires the outbox architecture, table partitioning, and multi-provider routing. |

**The one change that matters before scale:** the per-recipient INSERT loop. It is invisible today and will be the first hard wall.

---

## 8. Error handling & reliability

| Class | Example | Current handling | Recommended |
|---|---|---|---|
| **Transient provider** | timeout, 5xx | Caught in `sendBulkCampaign`; rows → `failed`, `sms_failures` @ 5 min | Correct. Add jittered exponential backoff |
| **Permanent provider** | 1003 Invalid Mobile | Retried like any failure | **Do not retry.** Classify by response code; mark terminal |
| **Provider stall** | C2 — accepted, never dispatched | **None — invisible** | C3 alerting |
| **Credential** | 1006 | Surfaces as generic failure | Distinct alert — never retried, always operator action |
| **Billing** | insufficient credits | `bumpRetry` without consuming an attempt | Correct |
| **Application** | unmatched `clientSmsId` | Treated as rejection, released | Correct, but should log |
| **User input** | malformed phone | `isValidKenyanPhone` pre-check | Correct |

**The systemic weakness is not retry logic — it is that failures are silent.** `sendServiceSms` never throws; `settleReservation` swallows errors; `insertSmsLog` returns null on failure and proceeds. Each is individually defensible (documented reasoning, sweeper backstops) but together they mean the SMS path degrades quietly by design. **C3's alerting is the correct compensating control** — do not unpick the swallowing, add observability above it.

---

## 9. Security & compliance

**Verified sound:**
- All 15 `sms_*` tables have RLS enabled; `sms_usage_logs` carries 4 policies.
- All three send surfaces enforce `withPermission('messaging.send')` + rate limiting.
- `getDlr` requires explicit scope, ownership checked before the provider call.
- Platform-funded sends cannot carry a charge (CHECK constraint).
- Credentials read through validated `env` (fails fast at cold start), now `.trim()`-normalised (PR #109).

**Gaps:**
- **H3** — no STOP handling (Data Protection Act 2019 exposure). Highest compliance risk.
- **M5** — rate limits bound requests, not recipients.
- **M4** — `sms_provider_costs` RLS with no policies.
- **Message bodies are stored indefinitely** in `sms_usage_logs.message_text`. Personal data with no retention policy. Recommend a retention window (12–24 months) with redaction, per DPA data-minimisation. [VERIFIED — no retention job exists]
- **[NEEDS INVESTIGATION]** OTP bodies are stored in `message_text` in plaintext via `sendServiceSms`. Codes are short-lived and hashed in `registrant_verifications`, so impact is limited — but a plaintext OTP sitting in a queryable log for months is worth redacting.

---

## 10. Cost optimization

**Current spend is small** (~KES 130 in credits, 323 messages), so these are structural rather than urgent.

| Opportunity | Mechanism | Est. saving |
|---|---|---|
| **Stop paying for undelivered messages** | C2 resolution + C3 alerting | Currently **100% of spend is waste** |
| **Segment-aware billing (L2)** | Bill `segments × rate`; today a 2-segment message is billed as 1 | Recovers real under-billing |
| **Don't retry permanent failures** | Classify response codes; 1003 is never worth a retry | Proportional to H4's true rate |
| **Message-length linting** | Warn at campaign compose when >160 chars | Prevents accidental 2× cost |
| **Dedup at the outbox** | UNIQUE `idempotency_key` | Eliminates duplicate-send class entirely |

**The single largest cost lever is C1 + C3.** Without delivery visibility there is no way to know what share of spend is wasted — and C2 demonstrates the answer can be *all of it*.

---

## 11. Monitoring & alerting (recommended)

| Metric | Threshold | Severity | Channel |
|---|---|---|---|
| Delivery rate (1h) | < 80% | **Critical** | email + in-app |
| Messages non-terminal > 30 min | any | **Critical** | email + in-app |
| Provider balance | < 500 | High | email |
| Provider error rate | > 5% / 15 min | High | email |
| Job backlog by type | > 100 pending | High | email |
| Oldest pending job age | > 60 min | High | email |
| Stale reservations | any > 30 min | Medium | dashboard |
| `released` + `sent` anomalies | any | Medium | dashboard |

**Never route SMS alerts over SMS** — the existing `raiseLowBalanceAlert` reasoning applies with more force here.

---

## 12. Testing strategy

**Current state [VERIFIED]:** 55 suites / 544 unit tests pass; 52 integration suites run against real Postgres in CI. Coverage of SMS billing and reservation logic is genuinely good.

**Gaps:**

1. **No test pins DLR field parsing** — C1 would have been caught instantly by a fixture asserting a real provider payload maps to `delivered`. **Add first**, with the captured payloads in this document as fixtures.
2. **No provider-contract tests.** All provider parsing is exercised against hand-written mocks that encode the same misunderstanding as the code. Record real responses as fixtures.
3. **`classifyDlrStatus` ordering (L4)** needs an explicit `UNDELIVERABLE → failed` regression test.
4. **No end-to-end send→DLR→settle test.**
5. **`jest.integration.config.ts` sets no `testTimeout`**, so the suite runs on Jest's 5s default and flakes under the slower `app_tenant` connection — observed failing then passing unchanged on PR #109. Set 30s. [VERIFIED]

---

## 13. Migration & refactoring risks

| Change | Risk | Mitigation |
|---|---|---|
| **C1 DLR fix** | Low | Pure read-path change. Messages can only move `pending → delivered/failed`; existing guards already prevent downgrading a `delivered` row |
| **DLR backfill** | Low–Med | Could mark old messages `failed` and trigger retries of stale content. **Suppress retry creation during backfill** |
| **H2 job purge** | Medium | Deleting pending rows loses queued work. These are idempotent sweeps re-enqueued every 5 min — safe, but purge by `type` explicitly, never blanket |
| **H3 opt-out migration** | Medium | Migrating `text[]` → table must not lose entries. Dual-read during transition |
| **L2 segment billing** | **High** | Changes what customers are charged. Requires comms, and should apply forward-only — never retroactively |
| **H1 provider abstraction** | Medium | Broad refactor of the send path. Land behind a flag, default to TextSMS, shadow-test the secondary |

---

## 14. Prioritized roadmap

**Week 1 — restore sight**
1. C1 — DLR field fix `[P0, 1h]`
2. Backfill DLRs for 151 `sent` rows `[P0, 2h]`
3. C3 — delivery-rate + queue-stall alerts `[P0, 1d]`
4. H2(3) — purge backlog, fix dedup `[P1, 2h]`
5. H4 — `failed_reason` distribution `[P1, 2h]`
6. M1, M2 `[P2, 1.5h]`

**Week 2–3 — stop the bleeding**
7. C2 — TextSMS escalation `[P0, external]`
8. H2 — dedicated lanes + age escalation `[P1, 2d]`
9. M3 — audit `sendServiceSms` call sites `[P2, 4h]`
10. Testing gaps 1–3, 5 `[P1, 1d]`

**Week 4–6 — resilience & compliance**
11. H1 — provider abstraction + failover `[P1, 1w]`
12. H3 — consent subsystem `[P1, 2d]`
13. M4, M5, L1 `[P2, 1d]`

**Quarter — scale**
14. Segment-aware billing (L2)
15. Bulk INSERT rewrite (§7)
16. Outbox architecture (§6)
17. Message retention policy (§9)
18. `sms.service.ts` split (L3)

---

## 15. Open questions requiring investigation

1. **Who polled DLRs on 2026-08-20 15:35** when `sms_poll_dlr` last completed 08-16? If jobs execute without completion accounting, H2's numbers understate the problem.
2. **Does TextSMS support DLR webhooks?** Determines whether §6's webhook-first design is available and whether `sms_poll_dlr` can be deleted outright.
3. **What is the true `failed_reason` distribution** across the 172 failed messages? (H4)
4. **Is `sms_provider_costs` live or dead schema?** (M4)
5. **Which `sendServiceSms` callers ignore the return value?** (M3)
6. **What is TextSMS's actual per-segment price and segment-counting rule?** Required before L2.

---

## Appendix A — Verification method

| Claim | How verified |
|---|---|
| 0 delivered messages | `SELECT count(*) … status='delivered'` → 0 |
| DLR misclassification | Executed `classifyDlrStatus` against live payloads |
| Provider stall + cutover window | Live `getdlr/` calls, 14 message ids, prod credentials |
| Two-account failure | Live sends on partner 16532, both stalled |
| Billing without delivery | Provider balance 104.00 → 103.00 across test sends |
| Job starvation | `job_queue` grouped by type/status |
| No stuck reservations | `sms_usage_logs` grouped by `billing_state` |
| RLS coverage | `pg_class.relrowsecurity` + `pg_policies` |
| Index coverage | `pg_indexes` |
| No inbound webhook | Filesystem search of `app/api` |
| PR #93 vs unbilled rows | `git log` timestamp vs row `reserved_at` |

## Appendix B — Provider payload reference

```json
// DELIVERED
{"response-code":200,"message-id":"810668705","response-description":"Success",
 "delivery-status":32,"delivery-description":"DeliveredToTerminal",
 "delivery-tat":"0.24 sec","delivery-networkid":1,"delivery-time":"2026-08-14 12:57:42"}

// STALLED (C2)
{"response-code":200,"message-id":"821169663","response-description":"Success",
 "delivery-status":32,"delivery-description":"Scheduled",
 "delivery-tat":null,"delivery-networkid":1,"delivery-time":null}
```

**`delivery-status` is 32 in both.** This is the single most important line in this document.
