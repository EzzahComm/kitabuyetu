# SMS / Messaging Subsystem Audit

**Date:** 2026-08-06
**Scope:** `lib/services/sms.service.ts`, `textsms.service.ts`, `sms-scheduler.service.ts`, `notifications.service.ts`, `lib/sms/*`, `app/api/v1/sms/*`, `app/(dashboard)/sms/*`, SMS migrations (006, 013, 042, 049, 051, 052, 053, 105, 120, 121, 122), and the SMS test suite.
**Score: 38 / 100**
**Status:** Findings only — no code changed in this pass.

---

## Executive summary

The SMS subsystem has genuinely good bones — the trigger engine's idempotency model, the scheduler's claim-and-advance locking, and the condition DSL's fail-closed evaluation are among the better-engineered code in this repo. It also has **three confirmed-in-production Critical defects**, two of which mean the billed send path has not worked at all for months and every SMS that *did* deliver was recorded as a failure.

This audit's findings are unusually well-evidenced because the production database was queried directly rather than reasoned about. Production recorded the primary bug's error message verbatim in its own table.

The central structural finding: **there are two parallel, independent SMS stacks**, and the wrong one is the one that works.

| | Billed stack | Unbilled stack |
|---|---|---|
| Entry | `smsService.send` / `sendBulkCampaign` | `notifyMember` / `notifyMany` |
| Callers | `/api/v1/sms/send`, trigger engine, campaign job | reminders, M-Pesa STK, role changes |
| Bills credits | yes (`debitPayer`) | **no** — `credits_deducted` hardcoded `0` |
| Honours opt-out | yes | yes |
| **Works in production** | **no — throws `0A000` on every call** | yes |

Every SMS production has ever sent came through the unbilled path. `notifications.service.ts:20` acknowledges the split as a TODO ("deduction logic from `smsService.send()` can be wired in here").

**Score rationale:** schema, RLS coverage, trigger-engine design and scheduler locking are strong (would sit near 70 on their own). The score is dragged down by a completely non-functional primary send path, a delivery-status defect that corrupts every success record, a cross-tenant IDOR, zero billing on the live path, and no rate limiting on an endpoint that spends real money.

---

## Verification method

Findings are labelled by how strongly they are established:

- **[PROVEN-PROD]** — verified by direct query against production (`qztcgryhoanennsizcll`).
- **[VERIFIED]** — I read the code myself and confirmed it.
- **[REPORTED]** — from research agents, cited but not independently re-read. Treat as high-confidence but unconfirmed.

Production is small (5 groups, 270 SMS log rows, 0 campaigns), so absence of data is weak evidence of absence of bugs. No load or provider-integration testing was performed. **No code was executed against a live server in this pass.**

---

## CRITICAL

### C1 — The group billing query is invalid SQL; every billed SMS path fails **[PROVEN-PROD]**

`lib/services/sms.service.ts:155-164`:

```sql
SELECT ba.sms_credits, COALESCE(s.sms_rate,'0.90') AS sms_rate
FROM billing_accounts ba
LEFT JOIN subscriptions s ON s.group_id=ba.group_id AND s.status='active'
WHERE ba.group_id=$1 FOR UPDATE
```

A bare `FOR UPDATE` locks every table in the `FROM`, including the nullable side of the `LEFT JOIN`. PostgreSQL rejects this at parse-analysis:

```
ERROR: 0A000: FOR UPDATE cannot be applied to the nullable side of an outer join
```

I ran this exact query against production with a **non-existent** group id and it still errored — this fails unconditionally, regardless of matching rows. It is not data-dependent and not intermittent.

`fetchBillingRow` is called by `debitPayer` (`:133`) on the group-payer path, which is the default (`GROUP_PAYER`) for:

- `POST /api/v1/sms/send` (`app/api/v1/sms/send/route.ts:13`)
- the **entire trigger engine** (`lib/sms/trigger-engine.ts:226`)
- **all bulk campaigns** (`lib/jobs/handlers.ts:550` → `sendBulkCampaign` → `debitPayer` at `sms.service.ts:349`)

The subscription check at `sms.service.ts:127-131` runs *before* this and would mask the bug for a group with no active subscription — but all 5 production groups have `status='active'` subscriptions, so the gate passes and the broken query is reached every time.

**Production proof.** The one trigger execution ever attempted:

```
event_type:  payment.received      created_at: 2026-07-31
status:      failed                attempts:   4
recipients:  0
reason:      "FOR UPDATE cannot be applied to the nullable side of an outer join"
```

A real member's payment-received SMS retried 4 times and failed on this error every time. `sms_campaigns` has 0 rows and `sms_failures` has 0 rows, both consistent with these paths never having completed successfully.

**Fix shape:** `FOR UPDATE OF ba`. One line — but see C1a.

**C1a — the lock is also semantically wrong.** Even once it parses, `FOR UPDATE OF ba` locks `billing_accounts` only after the row is read. The read-compare-update sequence at `:136-144` is a check-then-act on a locked row, which is correct *provided* the lock is actually taken. Verify the fix under concurrency, not just that it stops throwing.

### C2 — Every successfully delivered SMS is recorded as `failed` **[PROVEN-PROD]**

`lib/services/textsms.service.ts:134-144`:

```ts
const code = r?.['respose-code'] ?? 1005;
return { ..., success: code === 200 };
```

TextSMS returns numeric fields as **JSON strings**. Proven from the provider payload this system itself stored (`sms_delivery_reports.raw_response`):

```json
{ "status": "DeliveredToTerminal", "messageid": "655405696", "networkid": "1" }
```

`messageid` and `networkid` are both strings. `respose-code` arrives as `"200"`, and `"200" === 200` is `false` under strict equality — so `success` is `false` for **every** successful send.

**Production proof.** All 270 `sms_usage_logs` rows are `status='failed'`. Broken down by reason:

| `failed_reason` | rows | with real provider msg id | verdict |
|---|---|---|---|
| **"Success"** | **112** | **112** | **delivered, misrecorded as failed** |
| `status code 422` | 96 | 0 | genuine failure |
| `status code 401` | 54 | 0 | genuine failure (bad credentials) |
| `status code 500` | 8 | 0 | genuine failure |

All 112 "Success" rows carry a real provider message ID; the 158 genuine failures carry none. The single DLR row independently confirms delivery (`DeliveredToTerminal`, messageid `655405696`).

So the literal string `"Success"` is being written into a column named `failed_reason` on a row marked `failed`, 112 times.

**Consequences beyond bad records:** `pollPendingDlrs` only selects `status='sent'` (`sms.service.ts:540`), so delivery reports are never reconciled for these messages; the SMS Centre's usage stats report a 0% success rate; and any retry logic keyed on `failed` would re-send already-delivered messages at cost.

**Fix shape:** coerce before comparing (`Number(code) === 200`). Audit `networkid`/`messageid` handling for the same assumption. Note `SMS_CODES[...]` lookups happen to work with a string key because JS coerces object keys — so the description is right while the boolean is wrong, which is exactly why this hid for months.

### C3 — DLR endpoint allows cross-tenant read **and write** of another group's SMS logs **[VERIFIED]**

`app/api/v1/sms/dlr/route.ts:8-14`:

```ts
return withPermission(req, 'messaging.send', async () => {
  const messageId = new URL(req.url).searchParams.get('messageId');
  if (!messageId) return badRequest('messageId required');
  const result = await smsService.getDlr(messageId);
```

The handler is `async ()` — it never receives or reads the auth context, so `auth.groupId` is never applied. `smsService.getDlr` (`sms.service.ts:483-522`) then runs `UPDATE sms_usage_logs SET status=... WHERE provider_msg_id=$1` (`:492-504`) and upserts `sms_delivery_reports` keyed only on `provider_message_id` (`:508-519`) — none of it scoped by `group_id`.

Any authenticated user in any group holding `messaging.send` can supply an arbitrary `messageId` and both **read** another tenant's delivery status and **mutate** that tenant's log row. This is the only SMS route that takes a caller-supplied identifier without scoping it.

This is a real tenant-isolation break in code, independent of RLS — and note it would *not* be caught by the `app_tenant` RLS work, because the query runs on the admin pool via `getDlr`.

---

## HIGH

### H1 — The only working send path bills nothing **[PROVEN-PROD]**

`lib/services/notifications.service.ts:226-254`'s `writeSmsLog` inserts into `sms_usage_logs` directly via the raw admin `pool`, hardcoding `credits_deducted` to `0` (`:241`), bypassing `debitPayer` entirely. Every production row confirms it: `SUM(credits_deducted) = 0.0000` across all 270 rows.

Combined with C1, the practical state is: **the path that bills doesn't work, and the path that works doesn't bill.** SMS is currently free to every group, and the `billing_accounts.sms_credits` balance is decorative. Consent *is* honoured on this path (`notifyMember` checks `isPhoneOptedOut` at `:119`), so this is a revenue/cost-control gap, not a compliance one.

### H2 — No rate limiting on any SMS send route **[REPORTED]**

None of `send`, `bulk`, or `campaign` call any rate-limiting primitive. The repo's only helper, `checkRateLimit` (`lib/redis/index.ts:171`), is used exactly once, in `app/api/v1/mpesa/c2b/route.ts:96`. `BulkSmsSchema.phones` permits 5,000 recipients per call (`lib/validators/sms.schema.ts:22`) with no cooldown between calls. Once C1 is fixed, a compromised officer token can spend a group's entire credit balance in seconds. Fix C1 and H2 together — fixing C1 alone re-arms a money-spending endpoint that currently has no velocity control.

### H3 — Campaign job retry re-bills and re-sends, without bound **[REPORTED]**

`handleSmsBulkSend` has no per-recipient checkpoint (acknowledged at `lib/jobs/handlers.ts:530-535`). In `sendBulkCampaign`, the debit (`sms.service.ts:349`) is inside the transaction but the provider call (`:397`) is not wrapped — a throw propagates to the job processor, which retries the whole job, re-running `debitPayer` and inserting a second full set of log rows. Worse, `resetStuckJobs` (`lib/jobs/db.ts:41-51`) returns a timed-out job to `pending` **without incrementing `attempts`** (only the catch branch bumps it, `processor.ts:68`), so a campaign that reliably exceeds the handler budget re-bills and re-sends indefinitely.

### H4 — Scheduling a campaign from the UI always fails with a 400 **[VERIFIED]**

`app/(dashboard)/sms/page.tsx:299` binds a raw `<input type="datetime-local">`, submitted unmodified at `:304`. That control yields `"2026-08-06T14:30"` — no seconds, no timezone offset. The server schema is `z.string().datetime({ offset: true })` (`lib/validators/sms.schema.ts:37`), which makes the offset **mandatory**. Every "Schedule" click 400s; "Send Now" (null) is unaffected.

The Schedules tab gets this right two tabs away (`page.tsx:593` calls `new Date(sNextRun).toISOString()`), which is the same fix. This is another instance of the exact bug class catalogued in `CLIENT_SERVER_CONTRACT_AUDIT_2026-08.md` — a payload shape that typechecks but cannot validate.

### H5 — Credits are never refunded, and provider exceptions get no retry **[REPORTED]**

There is no `sms_credits = sms_credits + …` anywhere outside the top-up path (`billing.service.ts:207`); `sms.service.ts:333-335` acknowledges this as unimplemented (ticket SMS-009). Separately, `dispatchBatch`'s catch-all (`:758-768`) marks rows failed but writes **no `sms_failures` row**, so a provider *exception* — unlike a provider *rejection* — gets no retry at all. Credits are burned on every non-rejection failure.

### H6 — Chunked bulk sends rely on unverified positional alignment **[REPORTED]**

`sendBulkSmsChunked` concatenates responses across 100-item chunks (`textsms.service.ts:242-247`), and both `sendBulkCampaign:401-418` and `dispatchBatch:747-754` index `logIds[i]` / `eligible[i]` against `result.responses[i]`. If any chunk returns fewer responses than items sent, every subsequent mapping shifts — marking the wrong log row sent and writing the wrong phone into `sms_failures`. A `clientSmsId` is set (`:394`) but never used to re-align. A partial-chunk response also aborts the batch and loses already-sent chunks' responses.

---

## MEDIUM

- **M1 — Platform-default trigger rules cannot dispatch.** `trigger-engine.ts:227` passes `created_by ?? 'system'` as `ctx.userId`; `set_config('app.current_user_id','system')` then fails `NULLIF(...)::uuid` in `app_current_user_id()` with `22P02`. Platform-scope rules (`created_by` nullable, `RuleRow:43`) would fail every dispatch — currently masked by C1. **[REPORTED]**
- **M2 — `FORCE ROW LEVEL SECURITY` is inconsistent.** All 13 SMS tables have RLS enabled, but only `sms_usage_logs`, `sms_credits`, `sms_group_settings`, `sms_templates` have it *forced* (confirmed live via `pg_class.relforcerowsecurity`). Migration 097's header claims to cover every table reached via `withDb()`, but `sms_campaigns` (`app/api/v1/sms/campaign/route.ts:20`) and `sms_schedules` (`schedules/route.ts:12`) are both queried that way and were missed. Moot while the app role has `BYPASSRLS`; matters at `app_tenant` cutover. **[PROVEN-PROD]**
- **M3 — Trigger-rule overrides are keyed on free-text `name`.** `specificity()` (`trigger-engine.ts:81`) collapses group > org > platform by `rule.name`; a typo means the override silently fails and **both** rules fire. **[REPORTED]**
- **M4 — Reminder stage gaps.** The stage `CASE` (`handlers.ts:385-391`) has holes at `days_until_due` = 2, 1, −1, −2 → `reminder_stage IS NULL` → filtered out at `:395`, so nothing sends the day before a due date. `due_3_days`/`due_today` are exact-day matches, so a skipped cron tick loses them permanently (only overdue buckets are ranges). The `b069779` dedup fix itself is **intact and unregressed** — verified across `reminder.service.ts:49-110`, `handlers.ts:342-429`, and migration 106. **[REPORTED]**
- **M5 — The opt-out list is never populated.** `smsService.optOut` (`sms.service.ts:703-720`) has zero callers, and nothing else writes `sms_group_settings.opt_out_phones`; production has **0 rows** in that table. Both consent checks (`fetchOptOuts:166`, `isPhoneOptedOut`) therefore read a permanently empty list — members have no way to opt out. Compliance-relevant. **[PROVEN-PROD]**
- **M6 — Provider config bypasses env validation.** `textsms.service.ts:20-21` reads `process.env.TEXTSMS_API_KEY!` / `PARTNER_ID!` at module scope with non-null assertions, never importing the Zod schema that exists at `lib/env.ts:88-90`. Unset credentials post `"apikey": undefined` and surface as provider code 1006 instead of failing fast — which is plausibly the origin of the 54 production `401` rows. Also two different default sender IDs: `'KITABU'` (`textsms.service.ts:22`, `sms.service.ts:607,732`) vs `'KitabuYetu'` (`lib/env.ts:89`). **[VERIFIED]**
- **M7 — No confirmation or cost preview before sending.** `app/(dashboard)/sms/page.tsx` has no `ConfirmDialog`/`Dialog`/`window.confirm` anywhere. "Send SMS" (`:165-173`), campaign create, campaign cancel, template delete and schedule delete are all one-click. Recipient count and estimated cost are never shown pre-send — only character count. This is the one place in the app where a misclick spends money with no interstitial, and it contradicts the money-action dialog pattern adopted elsewhere. **[REPORTED]**
- **M8 — 403 is indistinguishable from empty or broken.** `PaginatedTable` now handles `isError` correctly (closing the platform-wide gap from `UX_UI_OPTIMIZATION_AUDIT_2026-08.md`) and all four SMS tabs pass `isError`/`error` through. But `getErrorMessage` (`lib/utils.ts:39-41`) does no status-code branching, so a permission denial renders identically to a 500. `BalanceCard` has no error state at all — a failed fetch renders `KES —`, same as "no data". **[REPORTED]**
- **M9 — `balance` and `usage` still use the legacy role guard.** `app/api/v1/sms/balance/route.ts:10,27` and `usage/route.ts:10` use `withRole('treasurer')` while every other SMS route migrated to `withPermission`. SMS spend visibility is therefore unaffected by the `roles.permissions` catalog. **[REPORTED]**

---

## LOW

- Dead code: DB function `deduct_sms_credits` (migration 009:233-260, zero call sites — `debitPayer` inlines its own UPDATE); `smsService.sendTemplated` (`sms.service.ts:297-322`); `TextSmsError` (`textsms.service.ts:48-57`, never thrown); `EmptyState` in `components/dashboard/sms/shared.tsx:21-33` (never imported).
- `BulkCampaignInput.sentBy` is required and populated by all four callers but never read — campaign log rows carry no sender attribution.
- `/api/v1/sms/send` has no client caller (`smsApi.send` exported at `lib/api/endpoints.ts:329`, never invoked); the UI uses `smsApi.bulk` exclusively.
- Weak validation in `lib/validators/sms.schema.ts`: `rawRecipients` is `z.record(z.unknown())` with no correlation to `recipientType`; `cronExpression` has no syntax validation; `timezone` has no IANA validation; `senderId` has no charset validation. Template `body` allows 640 chars (`:51`) but `message` caps at 320 (`:33`), so a template can validate at creation and exceed budget at send.
- `sendBulkCampaign` batches inserts by 200 (`sms.service.ts:353`) but still issues one INSERT round-trip per recipient (`:356`) — the batching is cosmetic.
- UI: 5-tab bar has no `overflow-x-auto`/`flex-wrap` (`page.tsx:744`); local `SummaryStatsGrid` used instead of the shared `StatCard`; hardcoded `blue-600` tokens (`:469,667,722,752`). SMS uses inline panels rather than modals, so the platform-wide dialog-scroll issue does **not** apply here.
- `sms-scheduler.service.ts` has no try/catch anywhere — one bad row aborts the rest of that tick.

---

## Test coverage

Existing tests are good where they exist: `sms-conditions.test.ts` (96 lines) covers the condition DSL thoroughly including malformed input and depth bounding; `sms-scheduler.test.ts` proves exactly-once enqueue semantics; `sms-events.test.ts` covers recipient-spec parsing including the `group_admin`→`chairperson` rename.

**None of the Critical findings could have been caught by the current suite**, because nothing tests:

- the provider client at all — `textsms.service.ts` has **no test file**; no coverage of failure, timeout, non-2xx, or **response type coercion** (C2)
- **any code path that reaches `debitPayer`** (C1) — no test executes the billing query against real Postgres
- the `dlr` route or the `messaging.send` permission (C3) — `sms-email-messaging.test.ts` covers templates/schedules/campaign-cancel gates only
- credit deduction, insufficient-balance, or refund behaviour
- cross-tenant isolation of SMS data specifically (the RBAC test uses a single group)

C1 is the notable one: a single integration test that sends one SMS against real Postgres would have caught it immediately, and the repo already has real-Postgres integration infrastructure.

---

## Roadmap

**Phase 1 — Stop the bleeding (small, high-certainty, do together)**

1. **C1** `FOR UPDATE OF ba` + an integration test that actually sends through `debitPayer` against real Postgres.
2. **C2** coerce the provider response code; audit sibling fields for the same assumption.
3. **H2** rate-limit the three send routes *before* C1 re-arms them.
4. **C3** scope `getDlr` to `auth.groupId`.

C1 and C2 interact: fixing C1 alone routes live traffic into a path that will mark every success as a failure. Ship them together.

**Phase 2 — Reconcile the two stacks (needs a product decision)**
Decide whether `notifyMember` should bill (H1). This is a real business decision — turning on billing for reminders/STK receipts changes what groups are charged for, and the 5 live groups have never been billed for SMS. Flagging rather than choosing.

**Phase 3 — Durability**
H3 (checkpointing + `resetStuckJobs` attempt counting), H5 (refunds + `sms_failures` on exception), H6 (align on `clientSmsId`), M1.

**Phase 4 — Correctness and polish**
H4 (one-line fix, ship anytime), M3–M9, then Low.

**Phase 5 — Backfill decision**
The 112 misrecorded rows are recoverable — they have provider message IDs and DLR is queryable. Decide whether to correct history or leave it. Cheap either way; needs sign-off because it rewrites financial-adjacent records.

---

## Caveats

- **Nothing here was fixed.** Findings only.
- **No end-to-end run.** The dev server was not exercised against a live provider. C1/C2 are proven from production data and a real SQL error, not from a successful send.
- **Small production dataset** (5 groups, 0 campaigns, 270 log rows). Absence of campaign bugs in prod data is not evidence of their absence.
- **[REPORTED]** findings come from research agents and were not independently re-read. Given this series' history of grep-derived false positives (`mpesa_b2c` RLS, `EmptyState`), re-verify any **[REPORTED]** item against source before acting on it.
- Migration 097's scope claim was found inaccurate (M2) — treat migration header comments as intent, not ground truth.
