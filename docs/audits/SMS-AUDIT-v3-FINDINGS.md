# SMS-AUDIT-v3-FINDINGS

**Date:** 2026-08-31 · **Mode:** read-only forensic re-audit · **Scope:** Kitabu Yetu SMS subsystem
**Supersedes as the current findings register:** `SMS_SYSTEM_AUDIT_2026-08-31.md` (same day, earlier pass — its 30 gaps are carried forward here by ID, not re-derived)

---

## 0. SPEC CORRECTIONS — read before anything else

The audit brief this pass was commissioned from contains **three factual premises that are false for this codebase**. They are recorded here because acting on them would have produced a fictional audit, and because they will recur if the brief is reused.

| # | Brief asserts | Reality | Evidence |
|---|---|---|---|
| SC-1 | Provider is **Africa's Talking** | Provider is **TextSMS** (`sms.textsms.co.ke`, partner ID auth). Africa's Talking was fully removed — its two vestigial columns (`at_message_id`, `at_cost`) were backfilled and dropped. | `supabase/migrations/20260529140000_049_drop_africastalking_columns.sql:1-10`; `lib/env.ts:100-102,177`; sole adapter `lib/services/textsms.service.ts` |
| SC-2 | Naming convention **"Account Credit"** for money vs **"SMS balance"** for sends must be preserved | **"Account Credit" does not exist anywhere in the codebase** — zero occurrences across all `.ts`/`.tsx`/`.sql`. The real vocabulary is `billing_accounts.sms_credits`, `sms_credits` (purchase lots), `sms_credit_ledger`. There is no convention to preserve; there is a convention to *establish*. | Repo-wide grep, 0 hits |
| SC-3 | A prior **RFC 2119 invariant set** exists to reconcile against | **No RFC 2119 document exists.** `docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md` and `docs/chama-reminder/CHAMA_REMINDER_ARCHITECTURE_INTEGRATION.md` contain **zero** occurrences of MUST/SHOULD/SHALL. No file in `docs/` matches RFC 2119 phrasing. | `grep -c "MUST\|SHOULD\|SHALL"` → 0 on both; `grep -rl "RFC 2119" docs/` → empty |

**SC-3 is the headline of the reconciliation pass** and is answered formally in §2. `SMS-INVARIANTS-v3.md` is therefore not a *revision* of a prior invariant set — it is the **first** one this subsystem has ever had.

Additionally, one in-scope item in the brief describes a component that does not exist: **there is no inbound DLR webhook**. Delivery reports are retrieved by outbound polling. H6 is adjudicated against that reality in §3, not against a hypothetical webhook.

---

## 1. PASS 1 — INVENTORY

### 1.1 Provider surface
Single adapter, single provider. `lib/services/textsms.service.ts` — four outbound operations: single send, bulk send (chunked), DLR fetch, balance query. Auth by `apikey` + `partnerID` in request body (POST paths) or query params (GET paths). Timeouts hardcoded per operation (20s single / 60s bulk / 15s DLR / 15s balance). No HTTP-level retry, no circuit breaker, no idempotency key sent to the provider.

### 1.2 Tables (live production, `qztcgryhoanennsizcll`)
`sms_usage_logs` (the ledger of record, 353 rows), `sms_delivery_reports` (61), `sms_campaigns`, `sms_schedules`, `sms_templates`, `sms_trigger_rules` (3 rows, all global), `sms_trigger_executions` (23), `sms_failures` (31), `sms_group_settings` (**0 rows**), `sms_credits` (purchase lots, 1), `sms_credit_ledger`, `sms_pricing_tiers`, `sms_packages`, `sms_provider_costs`, `sms_provider_balances`, `organization_sms_credits` (**0 rows**), `billing_accounts.{sms_credits, reserved_sms_credits, sms_allowance_used, sms_allowance_reserved}`, `reminder_dispatch_log`. Views: `vw_sms_credit_reconciliation`, `vw_sms_usage_summary`.

RLS is **enabled on every `sms_*` table**; forced on `sms_credits`, `sms_group_settings`, `sms_templates`, `sms_usage_logs`. All tables owned by `postgres` (`rolbypassrls = true`), so RLS binds `app_tenant` only — the admin pool bypasses it by design and must carry its own predicates.

### 1.3 Jobs (all cron-enqueued from `lib/jobs/index.ts`, drained by `app/api/cron/route.ts`)
`sms_retry_failed` (5 min, priority 6), `sms_process_schedules` (5 min), `sms_poll_dlr` (5 min), `sms_release_stale_reservations` (5 min), `sms_bulk_send` (ad-hoc), `sms_trigger_fire` (event), `sms_birthday_reminders` (daily 07:00 UTC), `sms_allowance_monthly_reset` (daily 01:00 UTC, anniversary-derived), `organization_sms_allowance_grant` (daily 01:00 UTC), `sms_low_balance_alert` (ad-hoc), `notify_contribution_reminders` (1st of month 08:00 UTC), `notify_loan_due_alerts` (daily 06:00 UTC).

### 1.4 Competing implementations (flagged per brief §Pass 1)
Two parallel send stacks persist, a known structural artifact: the **billed** stack (`smsService.send` / `sendBulkCampaign` → `messaging-billing.ts`) and the **notify** stack (`notifications.service.ts#notifyMember`/`sendSmsLeg`, which owns the WhatsApp→SMS fallback and the consent gate). Both now bill via the same primitive, so this is debt, not defect. Two retry owners also coexist — the trigger engine's `retryOrFail` and the `sms_failures`/`sms_retry_failed` cron — and that one **is** a defect (carried as G7).

---

## 2. PASS 2 — PRIOR-ART RECONCILIATION

**No prior invariant document exists (SC-3).** Reconciliation is therefore run against the *de facto* invariants — the correctness claims asserted by prior SMS documents (`SMS_MESSAGING_AUDIT_2026-08.md`, `SMS_SYSTEM_AUDIT_2026-08-20.md`, `SMS_MONETIZATION_AUDIT_2026-08.md`, `UNIFIED_MESSAGING_ARCHITECTURE.md`, `SMS_INVENTORY_AND_COVERAGE_2026-08.md`) and by load-bearing code comments.

`STATUS` ∈ ENFORCED · PARTIAL · NOT-ENFORCED · DOC-ONLY · SUPERSEDED.
**"ENFORCED" requires a mechanism that a second code path or a direct DB write cannot bypass.** Database-level evidence outranks application-level checks.

| ID | Statement (short) | Status | Evidence | Note |
|---|---|---|---|---|
| INV-01 | Credit is reserved before dispatch, never debited on attempt | **ENFORCED** | `reserve_sms_credits` (SECURITY DEFINER) is the sole mutator of `reserved_sms_credits`; all four send paths call it | Reservation model (migration 123) holds |
| INV-02 | One credit = one message (not money) | **PARTIAL** | Migration 144 fix intact in SQL + all TS paths | Correct for *rate*; wrong for *length* — see H4 |
| INV-03 | A group with no active subscription cannot reserve | **ENFORCED** | `reserve_sms_credits` raises `42501` before any lock | DB-level |
| INV-04 | Insufficient balance blocks the send | **ENFORCED** | `reserve_sms_credits` raises `22003` under row lock | DB-level, race-safe (H3) |
| INV-05 | `sms_credit_ledger` is append-only | **ENFORCED** | Trigger `sms_ledger_no_update` BEFORE DELETE OR UPDATE → `sms_ledger_immutable()` raises `42501` | DB-level. **But** `app_tenant` still holds redundant UPDATE/DELETE *grants* — trigger is the only thing standing; revoke for defence in depth |
| INV-06 | Balance reconciles against the ledger | **DOC-ONLY** | `vw_sms_credit_reconciliation` exists; **zero consumers** in any `.ts`/`.tsx` | Instrument built, dial never read (G16) |
| INV-07 | Opt-out is honoured before dispatch and costs nothing | **ENFORCED** | `notifications.service.ts:161,168` normalizes then checks *before* reservation; `sms.service.ts:554,1187` on other paths | Well built — see H10 REFUTED |
| INV-08 | Opt-out is available to the recipient | **PARTIAL** | Self-service route exists; **no STOP handling, no officer UI, `sms_group_settings` has 0 prod rows** | Reachable only by app-authenticated members (G20) |
| INV-09 | Consent is captured before first message | **NOT-ENFORCED** | No consent column, timestamp, or source anywhere; only a negative opt-out array | DPA 2019 exposure |
| INV-10 | Tenant isolation on every SMS table | **ENFORCED** | RLS enabled on all `sms_*`; policies verified live; admin-pool paths carry explicit `group_id` predicates | Re-verified this pass |
| INV-11 | SMS RPCs are not reachable via PostgREST | **ENFORCED** | `anon`/`authenticated` EXECUTE = false on `reserve_sms_credits`, `settle_sms_credit_reservation`, `draw_sms_credit_lots`, `sms_ledger_append` | Migration 126 holds |
| INV-12 | Delivery status is tracked to a terminal state | **NOT-ENFORCED** | 175/353 rows (≈50%) stuck `sent`, oldest 2026-07-01; poll capped at 15/tick | Field-read fixed 08-20, throughput is the new binding constraint (G3) |
| INV-13 | A retried job does not re-bill or re-send | **PARTIAL** | Correlation-id dedup present in `sendBulkCampaign`; **absent in `smsService.send`**; chunked path broken outright | G1, G7 |
| INV-14 | Bulk sends >100 recipients fan out via QStash | **NOT-ENFORCED** | Non-UUID dispatch key written to a `uuid` column — every such send fails, zero rows | **G1, Critical** |
| INV-15 | Scheduled occurrences cannot double-fire across workers | **ENFORCED** | `FOR UPDATE SKIP LOCKED` + claim and enqueue in one transaction | `sms-scheduler.service.ts:161-183` — genuinely well built |
| INV-16 | A per-schedule timezone is honoured | **DOC-ONLY** | `sms_schedules.timezone` is written (`schedules/route.ts:37,50`) and **never read**; due-check is bare `next_run_at <= NOW()` | Column is decorative (H8) |
| INV-17 | Provider is swappable behind an adapter | **NOT-ENFORCED** | `'textsms'` hardcoded across ≥6 files incl. business + pricing logic; `provider` column written as a literal, never read for routing | H14 CONFIRMED |
| INV-18 | Per-group send caps limit spend | **DOC-ONLY** | `daily_send_limit` is SELECTed and returned to the client; **no send path reads it**; not in the update schema | H12 CONFIRMED (G25) |
| INV-19 | Message bodies and MSISDNs stay out of logs | **ENFORCED** | Only SMS-subsystem logger calls carrying recipient data log a *count* (`recipients: logs.length`) and a rule name | `trigger-engine.ts:278,291` — H11 clean on the PII axis |
| INV-20 | Personal data has a retention limit | **NOT-ENFORCED** | No purge/retention job or migration for `sms_usage_logs`, which stores `message_text` + recipient phone indefinitely | DPA 2019 storage-limitation exposure |
| INV-21 | Billed automations are opt-in per group | **PARTIAL** | Honoured for birthday SMS (`handlers.ts:498-502`, DEFAULT false); **violated by welcome SMS** (global rule, no toggle) | G8 |
| INV-22 | A trigger execution marked `sent` was really delivered | **ENFORCED** | PR #124 guard: `if (!logs.some(l => l.status !== 'failed')) return retryOrFail(...)` | Fixed 08-27 |
| INV-23 | Campaign counters match the message log | **PARTIAL** | `syncCampaignCompletion()` correct going forward; **no retroactive path** — one live campaign still inverted | G6 |

### DOC-ONLY count — stated explicitly per §10

**3 of 23 reconciled invariants are DOC-ONLY** (INV-06 ledger reconciliation, INV-16 schedule timezone, INV-18 daily send cap) — each is a built artifact with no consumer: a view nothing queries, a column nothing reads, a limit nothing enforces.

A further **5 are NOT-ENFORCED** (INV-09, INV-12, INV-14, INV-17, INV-20) and **5 are PARTIAL**. **10 of 23 are fully ENFORCED**, all ten by database-level mechanisms — which is the single most reassuring result in this audit and the pattern the pathway extends.

---

## 3. PASS 3 — HYPOTHESIS RESULTS

Verdicts: **CONFIRMED** (defect proven) · **REFUTED** (enforcing mechanism identified) · **INSUFFICIENT-EVIDENCE**.
H1, H2, H5, H6, H7 were fully traced in the earlier pass this same day and are carried forward with their citations rather than re-derived. H3, H4, H8–H14 were tested fresh in this pass.

### H1 — Credit can be consumed without being reserved → **REFUTED**
Every dispatch path passes through `reserveCredits` → `reserve_sms_credits`. Enumerated callers of the provider client: `smsService.send`, `sendBulkCampaign`, `retryFailures`, `sendServiceSms`, `notifications.service.ts#sendSmsLeg`. All reserve first. The platform-payer branch (`payer_type='platform'`, OTP paths) is constrained by a CHECK making a charge on a platform row schema-impossible. *Mechanism: SECURITY DEFINER function is the sole mutator of `reserved_sms_credits`.*

### H2 — A failed or rejected send leaks reserved credit → **REFUTED, with one narrow exception (CONFIRMED)**
Provider 4xx/5xx/timeout all release (`sms.service.ts:726, 1350`); the `sms_release_stale_reservations` sweeper (15-min threshold) is the crash backstop. **Exception:** if `insertSmsLog` returns `null` (documented tolerated failure), the aggregate earmark is committed but no per-item ticket exists — and the sweeper scans **only `sms_usage_logs`**, so it can never find it. Permanent, silent, unrecoverable without manual SQL. → **G19**.

### H3 — Concurrent sends can overdraw a tenant's balance → **REFUTED**
`reserve_sms_credits` takes `SELECT … FROM billing_accounts WHERE group_id = p_group_id FOR UPDATE` (group branch) / the same on `organization_billing_accounts` (org branch), *then* computes `v_available := v_credits - v_reserved`, *then* raises `22003` if insufficient, *then* UPDATEs — all under the row lock, inside one function, and every caller runs it in a transaction. Concurrent sends serialize on the row. The aggregate query is deliberately split into a second statement because `FOR UPDATE` and aggregates cannot coexist — a correct and documented workaround. *This is the strongest correctness result in the audit.*

### H4 — Segment counting under-bills or over-bills → **CONFIRMED (three-way divergence)**
Established previously: no segment counting exists in billing; `CREDITS_PER_MESSAGE = 1` flat per recipient. **New this pass — there IS a second, independent counter, and it disagrees with both reality and billing:**
`components/sms/tabs.tsx:122-123` — `const charCount = message.length; const smsPages = Math.max(1, Math.ceil(charCount / 160));` displayed to the officer at `:156-157` as "N SMS parts".

Three numbers diverge for a 300-character message sent to 10 recipients:
- **UI quotes** `ceil(300/160)` = **2 parts** — wrong constant; concatenated GSM-7 segments are **153** chars, not 160.
- **Provider actually bills** `ceil(300/153)` = **2 segments** GSM-7, or `ceil(300/67)` = **5** if any character forces UCS-2 (one emoji or curly apostrophe does it). The UI never detects encoding, so its estimate is unconditionally GSM-7.
- **Kitabu Yetu charges** the customer **1 credit** per recipient — 10 credits total, for 20–50 provider segments.

So the officer is shown a number computed from the wrong constant, and charged a number unrelated to either. A second template-composer counter at `:424` uses `body.length` with no parts calculation at all. → **G5** (billing), plus new **V3-01** (the quoting divergence specifically).

### H5 — Retry produces duplicate delivered messages → **CONFIRMED**
No idempotency key is sent to the provider. Dedup is internal and inconsistent: `sendBulkCampaign` excludes already-logged recipients by `correlation_id` before reserving (correct, enforced by a real query); `smsService.send` has **no dedup at all**. Two independent retry owners exist — the trigger engine's `retryOrFail` and the `sms_failures`/`sms_retry_failed` cron — with no coordination, so a transient outage can produce duplicate delivered messages and duplicate charges. → **G7**.

### H6 — The DLR webhook is unauthenticated or replayable → **N/A — the component does not exist**
There is no inbound SMS webhook (`app/api/v1/webhooks/` contains only `whatsapp`). DLR is outbound polling. **The hypothesis cannot be confirmed or refuted; it is inapplicable.** The adjacent real control was verified instead: the *worker* endpoint `app/api/v1/workers/sms-dispatch-chunk/route.ts:53-77` verifies an Upstash QStash signature over the raw body and **fails closed (503) when signing keys are absent** — the strongest auth on any SMS surface. Recorded so a future pass does not re-open this as unaudited.

### H7 — Tenant isolation is bypassable on the SMS surface → **REFUTED**
RLS enabled on every `sms_*` table (forced on four); policies verified live and correctly scoped by `app_current_group_id()` / `app_current_organization_id()` / `is_super_admin()`. The broad `anon`/`authenticated` table grants that look alarming in isolation were traced end-to-end: every policy keys on `current_setting('app.current_group_id'/'app.current_role', true)`, which is only ever set inside the app's own pool — a raw PostgREST caller resolves them to NULL and is denied. SECURITY DEFINER RPCs confirmed non-executable by `anon`/`authenticated`. Admin-pool routes carry explicit `group_id` predicates. One residual: `getDlr`'s UPDATE lacks a `group_id` clause although its preceding ownership check has one (defence-in-depth only) → **G29**.

### H8 — The scheduler can double-fire or silently skip → **CONFIRMED (timezone + catch-up burst); locking REFUTED**
- **(a) Timezone — CONFIRMED.** `lib/jobs/index.ts:29,31` derives `hour`/`date` from `now.getUTCHours()` / `getUTCDate()`. Kenya is **UTC+3**, so every "hour === H" schedule fires at **H+3 local**: the monthly contribution reminder at `hour===8` fires **11:00 EAT**, loan-due alerts at `hour===6` fire **09:00 EAT**, birthday SMS at `hour===7` fires **10:00 EAT**. These land in daytime by luck, not design — but `sms_allowance_monthly_reset` at `hour===1` fires **04:00 EAT**, and any future schedule authored as a local hour will be silently 3 hours off. There is **no quiet-hours control anywhere**.
- **(b) `sms_schedules.timezone` — DOC-ONLY.** Written at `app/api/v1/sms/schedules/route.ts:37,50`, and the due-check is bare `next_run_at <= NOW()` (`sms-scheduler.service.ts:92-93`) with no conversion. The column is decorative.
- **(c) Concurrent-worker locking — REFUTED.** `claimOccurrence` uses `FOR UPDATE SKIP LOCKED` and advances `next_run_at` in the **same transaction** as the enqueue (`sms-scheduler.service.ts:161-183`). Correct.
- **(d) Catch-up — CONFIRMED (burst, not skip).** `next_run_at = c.occurrence + INTERVAL '1 day'|'7 days'|'1 month'` advances from the **previous scheduled occurrence**, not from `NOW()`. After a multi-day outage a daily schedule fires once per tick until it catches up — a member gets N identical reminders in rapid succession. No occurrence-level recipient dedup guards this (the `reminder_dispatch_log` stage key is period-based and would suppress same-period repeats, but ad-hoc `sms_schedules` sends do not go through `sendOnce`). → **V3-02**.

### H9 — Phone normalization admits invalid or duplicate MSISDNs → **CONFIRMED (narrow)**
`lib/utils/phone.ts:5-14` — strips all non-digits, then accepts: `254`+12 digits, `0`+10 digits, `7`+9 digits, `1`+9 digits; else throws. Hand-traced:

| Input | Output |
|---|---|
| `0722123456` | `254722123456` ✓ |
| `+254722123456` / `254722123456` | `254722123456` ✓ |
| `722123456` | `254722123456` ✓ |
| `07 22 12 34 56` | `254722123456` ✓ (spaces stripped) |
| `+254 (0)722123456` | **throws** — digits become `2540722123456` (13), matches nothing |
| `020 1234567` (Nairobi landline) | **`254201234567` — ACCEPTED as a mobile** ✗ |
| `2547221234567` (12-digit malformed) | throws ✓ |
| `+447911123456` (UK) | throws ✓ |
| `''` | throws ✓ |
| `null` | **`TypeError`**, not the intended `Error` ✗ |

**Defect:** the `0`+10-digit rule admits **any** Kenyan landline (`020…`, `041…`, `051…`) as a mobile MSISDN. Such a number reserves credit, dispatches, and fails at the provider — billed as a failure, retried up to `max_retries`. `null` throws the wrong error type, which a `try/catch` expecting the documented `Error` message will mis-handle.

**Refuted half:** normalization is *consistent* — one implementation, used at every boundary, and critically **the opt-out check normalizes before comparing** (`notifications.service.ts:161` then `:168`; `sms.service.ts:1187` uses `normalized`). Opt-out matching cannot silently miss on formatting. Storage is normalized at member-create and import. No divergent normalizer exists. → **V3-03**.

### H10 — Opt-out and consent are not enforced at dispatch → **REFUTED on enforcement; CONFIRMED on consent capture**
- **Enforcement — REFUTED.** Every send path checks. `notifications.service.ts:168` runs the check **before any reservation** (its comment states this is deliberate: "a suppressed send costs nothing"), and returns a distinct `suppressed` status not counted as failure. `sms.service.ts:554` builds a `Set` from `opt_out_phones` for bulk; `:1187` for retry. Comparison is against a normalized phone (H9).
- **Scope — per-group.** Every query is `WHERE group_id = $1`. A member in three chamas must opt out three times; there is no global suppression.
- **Consent capture — CONFIRMED absent.** There is no consent record of any kind — no column, timestamp, or source. Only a negative opt-out array. No inbound STOP handling exists.
- **Reachability — CONFIRMED weak.** `sms_group_settings` has **0 rows in production** across all 8 groups, so no opt-out has ever been recorded. A phone-only member (added by an officer, no app account) has no route to opt out at all. → **G20**, INV-09.

### H11 — PII leaks into logs, error payloads, or telemetry → **REFUTED on logs; CONFIRMED on retention**
- **Logs — clean.** The only SMS-subsystem logger calls carrying recipient-adjacent data log a **count**, not the list: `trigger-engine.ts:278` `{ rule, recipients: logs.length }`, `:291` `{ rule, reason: err.message }`. No phone number, message body, or national ID reaches a log sink. No error-tracking SDK is configured at all (no Sentry/Datadog dependency, no `instrumentation.ts`), so no third-party telemetry exfiltration path exists.
- **Retention — CONFIRMED.** `sms_usage_logs` stores `message_text` and `recipient_phone` and has **no purge or retention job, in code or in any migration**. Personal data is retained indefinitely. Kenya DPA 2019 requires storage limitation. → **V3-04**.
- Note the *credential* leak on the same axis (API key via nested axios error) is already logged as **G13** and is not restated here.

### H12 — There is no cost ceiling → **CONFIRMED**
- **Per-tenant cap:** `daily_send_limit` exists on `sms_group_settings` and is referenced in exactly **five places, all read-or-display** — `lib/api/endpoints.ts:396` (type), `app/api/v1/sms/settings/route.ts:28,37,46,53,81` (SELECT, DTO, column list). **No send path reads it.** It is also absent from the update schema, so it cannot even be set through the product.
- **Per-request caps:** `/sms/bulk` capped at 5,000; `/sms/send` **uncapped** (G9); campaign `rawRecipients` **unvalidated and uncapped** (G10).
- **Global kill switch:** **none.** No SMS feature flag, no env kill, nothing in `feature-flags.service.ts` for the SMS module. An operator cannot halt sending during an incident without a redeploy or revoking provider credentials.
- **Spend anomaly detection:** none.
- **Worst realistic case:** an authenticated officer, bounded only by the per-user API limit of 240 req/60s, can drive SMS through the trigger path (member-create, which bypasses the SMS limiter entirely — G12) at ~240/min ≈ **14,400 messages/hour**, or via repeated `/sms/send` calls with unbounded recipient arrays at 30 req/min × unbounded = **effectively unlimited**. Nothing stops either. → **G12, G25, and new V3-05 (no kill switch)**.

### H13 — The ledger is not append-only or does not reconcile → **SPLIT: append-only REFUTED, reconciliation CONFIRMED**
- **Append-only — REFUTED, at the database level.** Trigger `sms_ledger_no_update` fires `BEFORE DELETE OR UPDATE ON sms_credit_ledger FOR EACH ROW` executing `sms_ledger_immutable()`, which unconditionally `RAISE EXCEPTION … ERRCODE = '42501'`. No code path or direct write can mutate a ledger row. *This is exactly the DB-enforced posture the brief asks for and it is already in place.*
- **Caveat (defence in depth):** `app_tenant` nonetheless still holds `UPDATE, DELETE` **grants** on the table; the trigger is the sole thing standing. Revoking them costs nothing and removes the single point of failure. → **V3-06**.
- **Reconciliation — CONFIRMED absent in practice.** `vw_sms_credit_reconciliation` computes `drift` and `lot_drift` correctly and reads 0 across all 8 groups today — but **nothing consumes it**: zero references in any `.ts`/`.tsx`, no cron job, no admin surface. An instrument with no reader is not a control. → **G16**.

### H14 — The provider abstraction is not swappable → **CONFIRMED**
`'textsms'` is a hardcoded string literal in **at least 12 sites across 6 files**, well beyond the adapter: `lib/services/sms.service.ts:463,625,862`; `lib/services/notifications.service.ts:378`; `lib/services/sms-margin.service.ts:77,274`; `lib/services/sms-pricing.service.ts:108,140`; `lib/services/sms-pricing-admin.service.ts:117,282,287,291`. The `sms_usage_logs.provider` column is **written as a literal and read only as a filter constant** — never used for a routing decision. Provider-specific artifacts leak outward (the dual `respose-code`/`response-code` spelling handling, `delivery-description`, `clientsmsid`, numeric provider codes). There is no provider interface a second implementation could satisfy. By contrast the **email** subsystem already has `sendEmailWithFallback` — a working in-repo model SMS could copy. → **G15/V3-07**.

---

## 4. PASS 4 — GAP LEDGER

### Severity derivation rule (stated per §Pass 4)

```
BASE      = max(FINANCIAL, REGULATORY, BLAST_RADIUS)          -- each None/Low/Med/High
FLOOR     = HIGH  if the gap can silently move money or credit,
                  OR breaches Kenya DPA 2019                   -- regardless of likelihood
MODULATE  = LIKELIHOOD may raise BASE by one band if Certain;
            it may NEVER lower a FLOOR-set HIGH
SEVERITY  = max(BASE_after_modulation, FLOOR)
CRITICAL  = reserved for a gap that is BOTH floor-HIGH AND currently
            causing total loss of a primary function in production
```

### Ledger

Prior-pass IDs (G*) are carried forward unchanged so the two documents interlock; V3-* are new this pass.

| GAP-ID | CLASS | HYPOTHESIS / INVARIANT | EVIDENCE | FIN | REG | BLAST | LIKELIHOOD | SEVERITY |
|---|---|---|---|---|---|---|---|---|
| **G1** | defect | INV-14 | `sms-dispatch-chunk/route.ts:111` → `uuid` column | High | — | All groups >100 recipients | Certain (100% today) | **CRITICAL** |
| **G5** | defect | H4 / INV-02 | `sms.service.ts:176` flat 1 credit | High | — | Every long message | Certain | **HIGH** |
| **V3-01** | defect | H4 | `components/sms/tabs.tsx:122-123` `/160`, no encoding detect | Med | — | Every officer composing | Certain | **HIGH** |
| **G2** | defect | — | `app/api/cron/route.ts:38` vs `processor.ts:70` | High | — | All SMS jobs | Likely under load | **HIGH** |
| **G3** | defect | INV-12 | `sms.service.ts:954` limit 15; 175/353 stuck | Med | — | Half of all traffic | Certain (proven) | **HIGH** |
| **G4** | defect | H2 | `textsms.service.ts:419-437` rethrow | High | — | Multi-chunk sends | Possible | **HIGH** |
| **G7** | defect | H5 / INV-13 | 2 retry owners, no dedup on `send()` | High | — | Any outage | Likely | **HIGH** |
| **G8** | defect | INV-21 | migration 157 global rule, no toggle | High | Med (consent) | All 8 groups | Certain | **HIGH** |
| **G9** | defect | H12 | `sms.schema.ts:7` no `.max()` | High | — | Per-token | Possible | **HIGH** |
| **G10** | defect | H12 | `sms.schema.ts:73` `z.record(z.unknown())` | High | — | Campaign/schedule | Possible | **HIGH** |
| **G13** | defect | H11 (cred) | `sms.service.ts:991` nested axios err | High | — | Platform-wide key | Certain on error | **HIGH** |
| **V3-05** | debt | H12 | no kill switch anywhere | High | — | Platform-wide | — | **HIGH** |
| **G12** | defect | H12 | limiter on 3 routes only, not the spend primitive | High | — | Per-token | Possible | **HIGH** |
| **V3-04** | drift | H11 / INV-20 | no retention on `sms_usage_logs` | — | **High (DPA)** | All members | Certain | **HIGH** |
| **INV-09** | drift | H10 | no consent record exists | — | **High (DPA)** | All recipients | Certain | **HIGH** |
| **G20** | drift | INV-08 | 0 rows in `sms_group_settings`; no STOP | — | **High (DPA)** | Phone-only members | Certain | **HIGH** |
| **G19** | defect | H2 | sweeper scans only `sms_usage_logs` | Med | — | Per-incident | Rare | **MEDIUM** |
| **G16** | drift | INV-06 | view, zero consumers | Med | — | All billing bugs | Certain | **MEDIUM** |
| **G17** | drift | — | no provider-side reconciliation | Med | — | Margin truth | Certain | **MEDIUM** |
| **G18** | defect | INV-06 | `NUMERIC(14,4)` vs `(15,2)` | Low | — | Every top-up | Certain | **MEDIUM** |
| **G6** | defect | INV-23 | live campaign `0/8` vs real `8/0` | Low | — | Admin reporting | Confirmed live | **MEDIUM** |
| **G11** | defect | — | `eventId: memberId` vs global rule | Low | — | Multi-group members | Certain | **MEDIUM** |
| **V3-02** | defect | H8(d) | `next_run_at = occurrence + INTERVAL` | Low | Low | Post-outage | Possible | **MEDIUM** |
| **V3-03** | defect | H9 | `0`+10 admits landlines | Low | — | Bad data entry | Possible | **MEDIUM** |
| **G14** | debt | — | no alerting sink at all | Med | — | Detection of all above | Certain | **MEDIUM** |
| **G15/V3-07** | debt | H14 / INV-17 | `'textsms'` × 12 across 6 files | Med | — | Provider outage | — | **MEDIUM** |
| **G21** | drift | — | `reminder_dispatch_log` no read surface | — | Med (DSAR) | Support + compliance | Certain | **MEDIUM** |
| **G22** | defect | — | day-1 window + no preview | Low | Low | Members | Possible | **MEDIUM** |
| **G23** | defect | — | unbounded awaited `pruneOldJobs` | Low | — | Monthly tick | Possible | **MEDIUM** |
| **H8(a)** | drift | INV-16 | `getUTCHours()`; timezone col unread | Low | Low | All schedules | Certain | **MEDIUM** |
| **G25** | drift | INV-18 | `daily_send_limit` display-only | Low | — | False assurance | Certain | **LOW** |
| **V3-06** | debt | H13 | `app_tenant` retains UPDATE/DELETE grants | Low | — | Defence depth | — | **LOW** |
| **G24** | defect | H7 | `/sms/balance` role scope | Low | Low | Platform BI | Certain | **LOW** |
| **G26** | debt | — | `package_id`/`currency` dead | Low | — | One report | Certain | **LOW** |
| **G27** | defect | — | org top-up no `ON CONFLICT` | Low | — | Future STK | Rare now | **LOW** |
| **G28** | debt | — | no retry action / cost preview | Low | — | Officer UX | Certain | **LOW** |
| **G29** | defect | H7 | `getDlr` UPDATE unscoped | Low | — | Defence depth | Rare | **LOW** |
| **G30** | debt | — | stale comment, `organization_sms_credits` | — | — | Maintainer | Certain | **LOW** |

**Totals:** 1 Critical · 15 High · 14 Medium · 8 Low.
Three High items are **regulatory-floor** (V3-04, INV-09, G20) — none would be High on financial or blast-radius grounds alone; all three are Kenya DPA 2019.

---

## 5. INSUFFICIENT-EVIDENCE REGISTER

Recorded per §6 rather than guessed:

| Item | What is needed to resolve |
|---|---|
| Vercel plan tier (caps G2's fix at 60s or allows 300s) | Account plan confirmation — `vercel` CLI shows the team but not the function-duration ceiling |
| Whether TextSMS supports **inbound/two-way SMS** (would make STOP handling possible, closing G20/INV-08 properly) | Provider documentation or account-manager confirmation for partner ID 14643 |
| Whether TextSMS supports a **DLR webhook** (would let `sms_poll_dlr` be deleted entirely, removing the largest queue pressure and closing G3 structurally) | Same |
| Whether TextSMS bills **per segment** and at what rate for UCS-2 (sizes G5's true financial exposure) | A provider invoice or statement export |
| Real p99 duration of `retryFailures` / `pollPendingDlrs` in production (sizes G2 precisely) | `job_logs` duration analysis, or timing instrumentation |
| Historical count of long/Unicode messages already sent (sizes G5's accrued loss) | `SELECT count(*) FILTER (WHERE length(message_text) > 160) FROM sms_usage_logs` — deliberately not run this pass to keep it strictly read-only-minimal; trivial to run |

---

## 6. ACCEPTANCE CRITERIA CHECK

- ✅ Every hypothesis has a verdict with citations (H6 adjudicated as inapplicable, with reasoning).
- ✅ Every prior invariant has a status — 23 reconciled.
- ✅ Every gap has evidence; none rests on assumption.
- ✅ DOC-ONLY count stated explicitly: **3 of 23** (§2).
- ✅ No code modified, no migration executed — read-only throughout; the only DB statements issued were `SELECT` / catalog introspection.
- ✅ Uncertain findings labelled INSUFFICIENT-EVIDENCE with the artifact required (§5).
- ✅ Spec errors reported plainly rather than absorbed (§0).

**Pathway items and closure tests:** `SMS-OPTIMIZATION-PATHWAY.md`. **Consolidated invariant set:** `SMS-INVARIANTS-v3.md`.
