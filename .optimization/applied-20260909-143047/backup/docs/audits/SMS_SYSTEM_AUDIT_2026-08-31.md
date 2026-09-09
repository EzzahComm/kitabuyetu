# SMS Subsystem Audit — 2026-08-31

**Third full audit of this subsystem** (after `SMS_MESSAGING_AUDIT_2026-08.md`, 2026-08-06, score 38/100, and `SMS_SYSTEM_AUDIT_2026-08-20.md`, score not formally re-scored but "fully complete" as of 2026-08-21). This pass does **not** re-derive those findings. Every prior Critical/High is re-verified against current source below and, where still fixed, stated once and not written up again. The focus here is: (a) confirm no regression, (b) find what changed in the 4 days since the last close-out — chiefly PR #124 (welcome-on-join SMS, migration 157) and PR #126 (job-worker time budget) — and (c) find what neither prior pass looked at (segmentation/billing units, chunked-dispatch correctness, reconciliation, consent reachability, observability).

**Method.** Four parallel research passes against current source (`d:\Claude\Projects\KITABU YETU\kitabuyetu`, branch `main` @ `ce8be86`), each briefed on what the prior two audits already found so it would not re-derive it: (1) provider integration & delivery reliability, (2) billing & accounting, (3) security & multi-tenancy, (4) jobs/scheduling, consent/compliance, UX/observability. Every finding below carries a file:line citation from the pass that found it. In parallel, this session queried **production Postgres directly** (`qztcgryhoanennsizcll`, the same instance `kitabuyetu.co.ke` runs on) for the numbers that follow, and used those numbers to **correct one research-pass claim** (§Correction) and **resolve one apparent contradiction** between source-reading and live data (Finding G6). Findings are labelled **[PROVEN-PROD]** where live data confirms them, **[VERIFIED]** where read directly from current source, following this series' own labelling convention.

---

## 1. Executive Audit Summary

The subsystem's architecture is sound and its hardest problems — the reservation billing model, RLS tenant isolation, the trigger engine's idempotency claim, the job-sweep dedup fix — are correctly built and, on direct re-reading, **not regressed**. Two full audit cycles of real fixes are holding.

What this pass found is a different shape of risk than the first two audits: not "the whole pipe is broken" (2026-08-06) or "one field is misread, hiding all delivery status" (2026-08-20), but a set of **narrower, deeper defects that only show up when you trace a specific path to its end** — a UUID column fed a non-UUID key, a time-budget change that quietly removed the safety margin three job types depend on, a billing unit ("1 credit = 1 message") that was fixed for *rate* but never extended to *length*, and a brand-new automated send path (shipped four days ago) that bills every group with no way to see or refuse it.

**The single most consequential finding:** chunked bulk SMS — the path QStash was specifically introduced to support — has been **completely broken since it was built**. Any ad-hoc "send to all members" or recurring Chama Reminder send to more than 100 recipients writes a non-UUID string into a UUID column and fails on every attempt, with **zero user-visible error** (the API already returned `{queued: true}` before the failure). Nothing has surfaced this because no test covers the failing combination — a chunk key *without* a `campaignId` (corrected during remediation; integration tests do run in CI, see §G1). This is the kind of "genuinely well-built plumbing, one wrong assumption, invisible until traced" defect this audit series keeps finding — see [[project_kitabu_yetu_sms_messaging]] for the pattern.

**Second:** PR #126 (2026-08-30/31, "give the job worker a real time budget") is a real, correct fix for job-queue starvation — but it also **cut the safety margin for long-running jobs from ~293 seconds to ~10**, without re-checking the three SMS job types whose worst-case runtime was tuned against the old margin. This was independently found by two separate research passes reading different files, which is strong corroboration. It re-arms exactly the double-bill/double-send failure mode PR #34/#41 (2026-08-06/08) fixed once already.

**Third:** SMS billing has no concept of a segment. Every message — 1 character or 640 — costs exactly 1 credit. This was also independently found by two research passes. It is a live, uncapped margin leak, and — this is the part neither prior audit could have found, because the instrument didn't exist until this pass looked for it — **nothing would ever detect it**: the internal reconciliation view has zero consumers, and provider-side reconciliation (comparing what TextSMS actually billed us against what we think we sent) doesn't exist at all.

**Fourth:** the welcome-on-join SMS shipped four days ago (PR #124) is architecturally sound (correct idempotency claim shape, correct opt-in-by-default *pattern* used elsewhere in the same codebase for birthday SMS) but was shipped **without following that pattern** — it bills every group by platform default, with no settings toggle, no UI of any kind, and an idempotency key that silently drops a second welcome for a member who joins a second group (which multi-group registration, shipped 2026-08-15, makes a normal case, not an edge case).

None of what follows requires a rewrite. Every fix is additive or a targeted correction to code shipped in the last three weeks. The billing core, tenant isolation, and job-sweep fairness machinery this audit re-verified are the right foundation to build on.

**Headline numbers, live production, 2026-08-31:**

| Metric | Value |
|---|---|
| Total `sms_usage_logs` rows, all time | 353 (2026-05-29 → 2026-08-27) |
| Messages permanently stuck `status='sent'` (never resolved delivered/failed) | **175 (≈50%)**, oldest since 2026-07-01 |
| `sms_delivery_reports`: pending vs delivered | 54 pending / 7 delivered |
| `sms_group_settings` rows (of 8 groups) | **0** — consent/automation settings table has never been written to by any group |
| `organization_sms_credits` rows | 0 (writer exists since PR #98; no org has used it) |
| Campaign `sms_campaigns.sent_count`/`failed_count` vs real `sms_usage_logs` | **Confirmed still lying for one live row** — see Finding G6 |
| SECURITY DEFINER SMS RPCs exploitable by `anon`/`authenticated` | 0 — migration 126's fix holds |

---

## 2. Gap Register

Ordered by severity, then by how directly the gap touches money or delivery correctness.

| # | Area | Issue | Severity | Status |
|---|---|---|---|---|
| G1 | Reliability | Chunked bulk SMS writes a non-UUID key into a UUID column — every &gt;100-recipient ad-hoc/scheduled send fails silently, zero rows written | **Critical** | Open |
| G2 | Reliability / Billing | `maxDuration=60` (PR #126) is below worst-case runtime of 3 SMS job types — re-arms the timeout-kill double-bill/double-send bug fixed once already | High | Open |
| G3 | Reliability | DLR poll limit (15/tick) is a stale pre-#126 workaround — throughput capped ~4,320/day platform-wide, messages age out of the 7-day poll window and get stuck `sent` forever | High | Open — **[PROVEN-PROD]** 175 stuck rows |
| G4 | Reliability | Mid-batch chunk failure discards already-accepted provider responses — free delivery, no bill, then a duplicate send on retry | High | Open |
| G5 | Billing | No segment/multipart accounting anywhere — every message is 1 credit regardless of length or encoding | High | Open |
| G6 | Billing / Observability | Campaign counters can still show inverted sent/failed counts for a completed campaign, and nothing detects or backfills it | Medium | Open — **[PROVEN-PROD]** |
| G7 | Billing | Trigger-engine retry (PR #124) and the independent `sms_failures` cron retry can both retry the same failed message — duplicate send, duplicate charge | High | Open |
| G8 | Consent / Billing | Welcome-on-join SMS bills every group by platform default with no toggle, no UI, no failure visibility | High | Open |
| G9 | Security | `POST /sms/send` accepts an unbounded recipient array, defeating its own rate-limit tiering | High | Open |
| G10 | Security | Campaign/schedule `rawRecipients` is entirely unvalidated — no phone format check, no cap, throws 500 mid-campaign | High | Open |
| G11 | Security | Welcome SMS's idempotency key omits the membership — a member joining a 2nd group gets no welcome, silently and permanently | Medium | Open — **[PROVEN-PROD]** confirmed via live index def |
| G12 | Security | Welcome SMS bypasses the per-group SMS rate limiter entirely (only 3 routes are gated, not the spend primitive) | Medium | Open |
| G13 | Credentials | `TEXTSMS_API_KEY` printed to console on DLR poll errors outside production | High | Open |
| G14 | Observability | No alerting of any kind — a total provider outage (the Ndengelwa 401 incident) is invisible until a human reads the DB | Medium | Open |
| G15 | Reliability | No provider fallback/circuit breaker; retry cadence has no health gate, so an outage produces maximum wasted work at maximum latency | Medium | Open — SPOF, reconfirmed |
| G16 | Billing | Reconciliation view (`vw_sms_credit_reconciliation`) has zero consumers anywhere in the app | Medium | Open |
| G17 | Billing | No provider-side reconciliation exists at all — the one control that would catch G5 | Medium | Open |
| G18 | Billing | `sms_credit_ledger`/`billing_accounts` numeric-scale mismatch means reconciliation can never read exactly 0 even when correct | Medium | Open |
| G19 | Billing | Stranded aggregate reservation when a log-row insert fails — sweeper can't find it (scans only `sms_usage_logs`) | Medium | Open |
| G20 | Consent | Self-service opt-out unreachable by phone-only members — exactly the population G8 now auto-messages | Medium | Open, compounds G8 |
| G21 | UX / Compliance | No read surface anywhere for `reminder_dispatch_log` — can't answer "did this fire, to whom, was anyone suppressed" | Medium | Open |
| G22 | UX | Same-day duplicate-reminder risk on day 1 of month; manual "Remind" has no recipient/cost preview | Medium | Open |
| G23 | Reliability | Unbounded `pruneOldJobs()` DELETE runs inline/awaited on the monthly high-stakes tick, competing for the now-scarce time budget | Medium | Open |
| G24 | Security | `GET /sms/balance` over-shares the platform-wide provider float to all 3 officer roles instead of `super_admin` only | Low | Open |
| G25 | UX | `daily_send_limit` is displayed as if enforced; it is never enforced and cannot be set via the UI | Low | Open |
| G26 | Billing | `sms_credits.package_id`/`.currency` still dead columns — "revenue by package" admin report is structurally misleading | Low | Open |
| G27 | Billing | Org SMS top-up has no idempotency guard — safe today (admin-only), High the day org self-serve top-up ships | Low (High-if-shipped) | Open |
| G28 | UX | No retry action or cost/recipient preview on failed messages / before large sends | Low | Open |
| G29 | Reliability | Two small, low-risk items: O(n²) scan in the reservation sweeper; `getDlr`'s UPDATE isn't group-scoped in its own WHERE clause (the read-check is) | Low | Open |
| G30 | Documentation | Stale comment in `sms-margin.service.ts` asserting `organization_sms_credits` has no writer (wrong since PR #98) | Low | Open |

**Confirmed still fixed, no regression** (full list in §8): the migration-144 unit fix, reservation atomicity, C1–C3 (2026-08-06), the DLR field-read + 404 handling + H2 dedup-key + M1 low-balance re-arm (2026-08-20), H3 job-retry dedup, the parameter-type-inference SQL bug class (0 new instances found across 5 known-affected files), campaign `notification_type` attribution, the `ComposeTab` 500-recipient cap, the SMS Sender ID, and the SECURITY DEFINER RPC grant hygiene from migration 126.

### Correction to a research-pass claim

One pass reported `sms_delivery_reports` as having no `group_id` column and therefore relying on grants alone for tenant scoping. **This is incorrect** — verified directly against production: the table has a `group_id` column, RLS is enabled, and a real per-group policy (`rls_sms_delivery_reports_group`) scopes it exactly like every other SMS table. No action needed there. (The broader point that pass was making — that the broad `anon`/`authenticated` table grants on every `sms_*` table look alarming out of context — is also addressed below: it is Supabase's documented-safe default pattern for this schema, confirmed by re-deriving the RLS chain live, not a new exposure. See §7 Security note.)

---

## 3. Detailed Findings

### CRITICAL

#### G1 — Chunked bulk SMS writes a non-UUID dispatch key into UUID columns; every &gt;100-recipient send fails silently

**Current behavior.** `app/api/v1/workers/sms-dispatch-chunk/route.ts:111` builds `dispatchBatchId: \`${payload.jobId}:chunk:${payload.chunkIndex}\`` — a string like `55555555-…:chunk:0`. `lib/services/sms.service.ts:523` uses this as `dispatchKey`, which the very first statement of the send path binds against `sms_usage_logs.correlation_id`, a `UUID` column (migration 123). The bind raises `22P02 invalid input syntax for type uuid`. The same value would also land in `correlation_id`/`reference_id` (also `UUID`) further down. The throw is caught by the worker route, returns 500, QStash retries 3× — all fail identically. **Zero `sms_usage_logs` rows, zero credits reserved, zero messages sent, and no user-visible error**, because `/api/v1/sms/bulk` already returned `{queued: true}` before the async chunk dispatch runs.

Reachability turns on whether `campaignId` is set: `/sms/campaign` passes it (safe — the per-chunk key becomes dead code there); **`/sms/bulk` and every `sms_schedules` occurrence do not** (`lib/services/sms-scheduler.service.ts:124-142`) — broken above 100 recipients. QStash is provisioned in this environment (all 4 `QSTASH_*` vars present).

**Why CI missed it.** *(Corrected 2026-08-31 during remediation — the original claim here was wrong in two ways and is retained below only as a caution about auditing test coverage by filename.)*

Integration tests **do** run in CI, via `npm run test:integration` against a real `postgres:17-alpine` service container (`.github/workflows/ci.yml:388-390, 440`), using `jest.integration.config.ts`. The `testPathIgnorePatterns` entry in `jest.config.ts` only keeps them out of the *unit* run, which is correct and deliberate.

The real reason CI missed it: **no test covers the failing combination.** `sendBulkCampaign` resolves `dispatchKey = campaignId ?? dispatchBatchId`. `sms-bulk-chunk-completion.test.ts` passes the `${jobId}:chunk:N` string *and* a `campaignId`, so the campaign id always wins and the malformed string is never used as the key. `sms-bulk-retry-idempotency.test.ts:72` does exercise the no-campaign path, but with a valid uuid `jobId`. The production shape — chunk key **and** no campaign, which is what `/api/v1/sms/bulk` and every `sms_schedules` occurrence produce — was simply never written as a test.

Closed by `__tests__/integration/sms-chunked-dispatch-key.test.ts` (added with the fix), which pins all four behaviours: the no-campaign chunk dispatch, retry dedup on a re-derived key, sibling-chunk independence, and rejection of a non-uuid key at the boundary.

**Expected behavior.** A dispatch key stored in a UUID column must be a UUID.

**Root cause.** A synthetic string key was invented at the QStash chunk boundary without checking the SQL type of the column it lands in.

**Risk/impact.** Silent, total failure of the highest-volume, most business-critical message class in the product: group-wide announcements and every recurring Chama Reminder send over 100 recipients.

**Recommended fix.** Derive a deterministic UUIDv5 from `${jobId}:chunk:${chunkIndex}` at `sms-dispatch-chunk/route.ts:111` (stable across QStash retries, distinct per chunk). Guard `dispatchKey` with a UUID-shape check in `sendBulkCampaign` and fail loudly at entry rather than mid-transaction.

**Files affected.** `app/api/v1/workers/sms-dispatch-chunk/route.ts`; `lib/services/sms.service.ts:523, 566-569, 625-631`; `jest.config.ts`/CI config.

**DB-schema impact.** None — UUIDv5 fix needs no migration. No historical rows are affected (every such send has always failed).

**Backward-compat.** None — nothing currently succeeds on this path.

**Testing.** Add `__tests__/integration/` to CI (or at minimum a unit test asserting `dispatchBatchId` matches a UUID regex). Integration test: enqueue `sms_bulk_send` with 150 phones, no `campaignId`, QStash configured; assert 150 `sms_usage_logs` rows land across 3 chunks. Same for a 150-recipient `sms_schedules` occurrence.

---

### HIGH

#### G2 — PR #126's `maxDuration=60` sits below the worst-case runtime of three SMS job types

**Current behavior.** `lib/jobs/processor.ts:70` raised `TIME_BUDGET_MS` from 7,000ms to 50,000ms (correct — this is what actually fixed the starvation the commit targeted). But `app/api/cron/route.ts:38` simultaneously **pins** `maxDuration = 60`, where the function previously inherited a platform default the commit's own message states is 300s. The time-budget check runs only **before claiming** the next job (`processor.ts:129-139`) — once a job is claimed there is no further check, so a job that starts at t=49.9s runs to completion or to platform kill.

Worst-case single-job runtimes against the new 60s ceiling: `pollPendingDlrs(limit=15)` — 15 sequential provider calls at a 15s timeout each, **up to 225s**; `retryFailures(limit=100)` — 100 sequential sends at a 20s timeout each, far in excess of 60s even at healthy latency; unchunked `sms_bulk_send` (QStash unconfigured, or ≤100 recipients) — 60s **per chunk alone**. This was found independently by two research passes reading different files (`textsms.service.ts` timeouts vs. `processor.ts`/`app/api/cron/route.ts`), which is strong corroboration.

**Expected behavior.** The function ceiling must exceed the tick budget plus the longest realistic single job, not plus ~10s.

**Root cause.** The 60s pin assumed short jobs; three SMS job types are unbounded loops over outbound HTTP with per-call timeouts individually larger than the entire residual headroom.

**Risk/impact.** A kill mid-job returns the job to `pending` via `resetStuckJobs(6)`, counting an attempt. For `sms_bulk_send` this **re-bills and re-inserts log rows on every pass** unless the dispatch-key dedup (H3, already fixed) happens to have already written the rows before the kill — i.e. the exact failure mode PR #34/#41 fixed once, re-armed by a much smaller safety margin. For `retryFailures`, a kill between "provider accepted" and "mark `sms_failures` row resolved" produces a genuine duplicate SMS to a real member on the next tick.

**Recommended fix.** Raise `app/api/cron/route.ts:38`'s `maxDuration` back toward 300 (restoring the margin the commit's own reasoning assumed) — **needs confirmation of the actual Vercel plan tier first**, since Hobby caps at 60s regardless. Independently, give `pollPendingDlrs` and `retryFailures` an internal deadline check per iteration so they return partial progress rather than running unbounded, and lower `retryFailures`' default limit from 100 toward ~20.

**Files affected.** `app/api/cron/route.ts:38`; `lib/jobs/processor.ts:70, 129-132`; `lib/services/sms.service.ts:954, 1020`; `lib/services/textsms.service.ts:229, 263, 326`.

**DB-schema impact.** None.

**Backward-compat.** Raising `maxDuration` is additive; lowering `retryFailures`' limit only slows drain rate (the 5-min cadence compensates).

**Testing.** Unit test asserting `maxDuration > TIME_BUDGET_MS + worst-case single-job budget` so the invariant can't silently regress again. Load test: 100 due `sms_failures` rows against a 2s-latency mocked provider; assert the handler returns inside the deadline with every row either resolved or still cleanly due — never lost or duplicated.

---

#### G3 — DLR poll throughput is capped at ~4,320/day platform-wide by a stale pre-#126 constant; this is why half of all messages are permanently stuck `'sent'` **[PROVEN-PROD]**

**Current behavior.** `lib/services/sms.service.ts:954` — `pollPendingDlrs(limit = 15)`. The comment at `:946-952` explains this number was chosen **specifically because of the old 7-second tick budget** ("one job doing up to 50 sequential outbound HTTP calls could alone exceed the per-tick time budget"). That constraint no longer exists (§G2), but the limit was never revisited. 15/tick × 12 ticks/hour = 180/hour = **4,320/day, globally, for every group combined** (`handleSmsPollDlr` calls it with no override, `lib/jobs/handlers.ts:812-819`).

The query filters to a 7-day window (`sent_at >= NOW() - INTERVAL '7 days'`). Once eligible messages outnumber the daily poll budget, the backlog grows faster than it drains and the **oldest rows age out of the window without ever being checked again** — this is precisely the failure mode the 24h→7d widening was meant to fix, reopened through a different door.

**[PROVEN-PROD]**: live production right now shows **175 of 353 `sms_usage_logs` rows (≈50%) permanently stuck at `status='sent'`**, the oldest dating to 2026-07-01 — nearly two months unresolved. `sms_delivery_reports` shows 54 `pending` against only 7 `delivered`. This directly undermines the headline fix of the 2026-08-20 audit (the DLR field-read bug) — the field is now read correctly, but most messages never get polled enough times to reach a terminal answer at all.

**Why this matters for the UX/reporting surfaces.** `'sent'` displays as a first-class blue-badged status in the officer SMS log, indistinguishable from a healthy in-flight message — but at current volume roughly half of everything ever sent will sit there forever. `sms_campaigns.delivered_count` (and the margin/analytics dashboards built on delivery status) inherit this blind spot.

**Expected behavior.** DLR poll throughput should scale with the tick budget the same way the rest of the job system now does, and the poll order should favor never-yet-polled messages over ones that have already exhausted their realistic chance of a report.

**Root cause.** A workaround constant survived the constraint that justified it, and its own comment — left unedited — now actively misleads a future reader into treating 15 as intentional.

**Recommended fix.** Raise the limit in proportion to the budget increase (15 → ~100, matching the same ~7× ratio PR #126 applied elsewhere). Add a `poll_count`/`queried_at`-ordered fairness scheme (least-recently-polled first, with backoff) so a handful of permanently-unreportable messages can't monopolize every slot — see the appendix query in the provider-integration research notes for the exact rewrite. Update the now-stale comment.

**Files affected.** `lib/services/sms.service.ts:946-978`; optionally `lib/jobs/handlers.ts:814`; one migration adding `sms_delivery_reports.poll_count`.

**DB-schema impact.** `ALTER TABLE sms_delivery_reports ADD COLUMN poll_count INT NOT NULL DEFAULT 0;` — additive, nullable-safe.

**Backward-compat.** None — purely additive; existing untracked messages sort first under a fairness rewrite, so nothing currently-tracked regresses.

**Testing.** Integration test: seed 20 `sent` messages, provider stubbed `"No dlr"` for the 15 oldest and `"DeliveredToTerminal"` for the 5 newest; run the poller twice; assert the newest 5 resolve by the second run (they would not today). Regression test asserting throughput scales with the configured limit.

---

#### G4 — A mid-batch chunk failure discards already-accepted provider responses: free delivery, no bill, then a duplicate on retry

**Current behavior.** `lib/services/textsms.service.ts:419-437` accumulates responses across chunks in a local array and **rethrows on any chunk's failure**, discarding every prior chunk's already-accepted, already-provider-billed responses. The caller (`sendBulkCampaign`, `sms.service.ts:686-728`, and `dispatchBatch`, `:1328-1351`) then marks **the entire batch** `status='failed'`, writes `sms_failures` retry rows for every recipient, and **releases every reservation** — including for recipients who already received the message. `retryFailures` (`sms.service.ts:1110`) then sends those recipients the message a **second time**, this time charging for it. Exposure: any &gt;100-recipient send taking the direct (non-QStash-chunked) path, or any multi-phone `dispatchBatch` call.

**Expected behavior.** A failure in chunk *k* should mark chunk *k*'s items failed and preserve chunks 0…k-1 as correctly recorded/billed.

**Root cause.** `sendBulkSmsChunked`'s all-or-nothing error contract doesn't match its caller's recovery logic, which assumes a failure means "the provider never answered at all" — true for one chunk, false for a multi-chunk send.

**Risk/impact.** Duplicate SMS to real members plus unrecovered provider cost (we paid TextSMS, never billed the tenant) — compounds with G2 (a mid-batch platform kill produces the identical shape).

**Recommended fix.** Change `sendBulkSmsChunked` to catch per-chunk and return partial results (`{responses, sent, failed, chunkErrors}`), synthesizing failure entries only for the chunk that actually failed so `alignBulkResponses` maps everything correctly by `clientSmsId`.

**Files affected.** `lib/services/textsms.service.ts:419-437`; `lib/services/sms.service.ts:686-728, 1305-1351`.

**DB-schema impact.** None.

**Backward-compat.** `BulkSmsResult` gains an optional field; existing consumers unaffected.

**Testing.** Mock chunk 0 success / chunk 1 rejection across 150 items; assert 100 real successes are preserved and only the true 50 failures get retry rows.

---

#### G5 — No SMS segmentation anywhere: every message is billed exactly 1 credit regardless of length or encoding

**Current behavior.** Found independently by two research passes reading different files — the strongest-corroborated finding in this audit. `const CREDITS_PER_MESSAGE = 1` (`lib/services/sms.service.ts:176`) is applied unconditionally at every insert and retry site, and the reservation quantity passed to `reserveCredits` is the **recipient count**, never a segment count (`:434, 583`; `notifications.service.ts:228` passes a literal `1`). A repo-wide search for segment/GSM/UCS-2/153/67 arithmetic in `lib/`/`app/` finds nothing except two prose comments (`lib/sms/templates.ts:66-68`) acknowledging the concept without enforcing it.

Meanwhile the validators *permit* multi-segment bodies: `SendSmsSchema`/`BulkSmsSchema`/`CampaignCreateSchema.message` cap at **320 chars** (3 GSM-7 concatenated parts, or **5** if any character forces UCS-2 — a single emoji or curly apostrophe does this); `TemplateCreateSchema.body` caps at **640 chars** (up to 5 GSM-7 / 10 UCS-2 parts). Personalization (`{{first_name}}`, etc.) renders **after** validation, so even a body inside the cap can render longer.

**Expected behavior.** Credits reserved/consumed should equal the segments TextSMS actually bills, computed from the rendered body per recipient.

**Root cause.** Migration 144 (2026-08-13) correctly fixed "credits were debited in *money*, credited in *message count*" — but equated "one message" with "one API call," not "one billable segment." The named constant is honest about what it does; what it does is simply the wrong unit.

**Risk/impact.** Direct, uncapped margin erosion, fully within tenant control: any group with template-management permission can author a 640-char template and pay 1 credit for 5 provider segments. Worse, **the platform's own margin dashboard cannot see this** — `sms-margin.service.ts` computes margin from `credits_deducted`, which by definition reports the wrong-unit number as correct. This is compounded by G16/G17 below: neither the internal reconciliation view nor any provider-side check exists to catch it.

**Recommended fix.** Add `lib/sms/segments.ts` (`countSegments(body): {encoding, segments}` — GSM-7 160/153, UCS-2 70/67, extension-set chars counting double). Reserve/consume `sum(segments)` instead of recipient count in every send path. Persist `sms_usage_logs.segments` for auditability. Add a live segment/character counter to the compose UI. This is a **price change** and needs a customer-facing decision on rollout, not a silent flip.

**Files affected.** New `lib/sms/segments.ts`; `lib/services/sms.service.ts` (176, 434, 457, 583, 618, 1085, 1097); `lib/services/messaging-billing.ts`; `reserve_sms_credits`/`settle_sms_credit_reservation` (note: both are `CREATE OR REPLACE` SECURITY DEFINER functions — **any migration touching them must re-apply the `REVOKE ALL … FROM PUBLIC, anon, authenticated`**, the exact re-open pattern that has bitten this codebase twice already); `lib/validators/sms.schema.ts`; the compose UI.

**DB-schema impact.** `ALTER TABLE sms_usage_logs ADD COLUMN segments SMALLINT NOT NULL DEFAULT 1`. Note the allowance-reservation arithmetic (`settle_sms_credit_reservation`, migration 146) currently derives `sms_allowance_reserved`'s decrement from a **row count**, while `reserve_sms_credits` increments it by **message count** — these only agree today because `credits_from_allowance` is always 0 or 1 per row. Introducing multi-segment rows breaks that identity unless both sides are changed together.

**Backward-compat.** Historical rows default `segments=1`, correctly matching what was actually charged historically — do not backfill. This is a real price increase for long/Unicode messages and needs advance customer communication.

**Testing.** Table-driven unit tests for the GSM-7/UCS-2 boundaries (160/161, 306/307, 70/71) and the extension-character double-count. Integration test: a 200-char, 3-recipient send reserves and consumes 6, not 3.

---

#### G7 — Trigger-engine retry and the independent `sms_failures` cron retry can both retry the same failed message

**Current behavior.** PR #124 added a full-rejection retry guard to `dispatchExecution` (`lib/sms/trigger-engine.ts:262-267, 298-310`) — correct on its own terms. But its retry re-invokes `smsService.send()`, which **has no correlation-id dedup guard** (unlike its sibling `sendBulkCampaign`, which does). Meanwhile the *first* attempt already wrote `sms_failures` retry rows for each rejected recipient, and the independent `sms_retry_failed` cron (every 5 min) re-reserves and re-sends the same message on its own schedule. Two retry owners, no coordination.

**Expected behavior.** Exactly one retry owner per failed message.

**Root cause.** The two retry mechanisms were built independently; PR #124 wired the trigger engine into the first without disabling or dedup-guarding against the second.

**Risk/impact.** A transient provider outage (the exact scenario PR #124 was built to survive) can now produce up to 4 trigger-level attempts × their own `sms_failures` retry chains — each successful attempt bills a credit and sends a real duplicate message.

**Recommended fix.** Give `smsService.send()` the same correlation-id pre-flight exclusion `sendBulkCampaign` already has — `correlation_id` is already populated (`exec.event_id`) at the trigger-engine call site, so the key exists; this is the smaller, more general fix and closes the gap for any other re-entrant caller too.

**Files affected.** `lib/sms/trigger-engine.ts`; `lib/services/sms.service.ts` (`send`, `dispatchBatch`, `logFailure`).

**DB-schema impact.** None required; optionally a partial unique index on `sms_usage_logs(group_id, recipient_phone, correlation_id) WHERE correlation_id IS NOT NULL` as a hard backstop.

**Backward-compat.** Adding dedup to `send()` changes its return shape for already-logged recipients — the trigger engine's "all deduped ⇒ treat as opted-out" branch needs a distinct signal so a deduped retry isn't misreported as mass opt-out.

**Testing.** Integration test: rule fires, provider rejects all, run both the trigger-level retry and the `sms_retry_failed` cron to completion; assert exactly one delivered message and one consumed credit.

---

#### G8 — Welcome-on-join SMS bills every group by platform default, with no toggle, no UI, no failure visibility

**Current behavior.** Migration 157 (PR #124, 2026-08-27) inserted `member_welcome` into `sms_trigger_rules` with **no `group_id`** — a platform-default rule, active for every group. Billing falls to the group (no `organization_id`, so the group-payer branch applies) per `lib/sms/trigger-engine.ts:220-224`. There is **no product surface of any kind**: `sms_trigger_rules`/`sms_trigger_executions` are referenced in exactly the engine, the event catalog, one M-Pesa callback, a one-off backfill script, and a test — zero API routes, zero pages, zero components. `sms_group_settings` has toggles for contribution/loan/meeting/birthday automation (`app/api/v1/sms/settings/route.ts:71-79`) — **no welcome toggle exists**.

The codebase already states the correct principle for a sibling feature shipped days earlier: the birthday-SMS handler is explicitly gated on a per-group opt-in "since it's billed… **a group shouldn't get charged for a channel it never turned on**" (`lib/jobs/handlers.ts:498-502`). Welcome SMS violates that rule verbatim.

**Expected behavior.** A billed automation should be opt-in per group, visible, and inspectable when it fails — matching the pattern this exact codebase already uses for birthday SMS.

**Root cause.** PR #124's own migration comment frames this as *completing* pre-existing half-built plumbing ("the rule was never connected") rather than as shipping a new billed feature that needs the same consent/visibility scaffolding every other billed automation has.

**Risk/impact.** Every group is silently charged per member added, with no way to decline. The Ndengelwa 8-member 401 incident that prompted PR #124's own fix was found only by direct SQL — the same incident today would be equally invisible, since `sms_trigger_executions` is append-only with no admin surface to inspect or re-fire a stuck execution.

**Recommended fix.** Add `sms_group_settings.auto_send_welcome BOOLEAN NOT NULL DEFAULT false`, mirroring `auto_send_birthday`, and gate the rule on it. Ship a minimal read-only "Automations" surface: rules with on/off state, an executions list filtered to the caller's group (rule, event, recipient, status, attempts, last error), and a staff view of exhausted/stuck executions.

**Files affected.** New migration; `lib/validators/sms.schema.ts`; `app/api/v1/sms/settings/route.ts`; `lib/sms/trigger-engine.ts`; new `app/api/v1/sms/triggers/route.ts`; new UI in `components/sms/` + `app/(dashboard)/sms/page.tsx` + `app/(reminder)/reminder/`.

**DB-schema impact.** One additive nullable-with-default column; the rest is read-only.

**Backward-compat.** **Defaulting the new toggle to `false` turns the automation off for every group currently receiving it — a deliberate product call, not an accident.** If continuity is preferred instead, backfill `true` only for groups that have already customized a `welcome` template override (confirmed one such group exists in prod today), `false` elsewhere. This decision should be made explicitly, not defaulted silently either way.

**Testing.** Integration: a member added to a group with the flag off sends nothing and bills nothing. New executions endpoint is correctly group-scoped under RLS.

---

#### G9 — `POST /sms/send` accepts an unbounded recipient array, defeating its own rate-limit tiering

**Current behavior.** `SendSmsSchema.phone` (`lib/validators/sms.schema.ts:7`) is `phoneSchema.or(z.array(phoneSchema))` with **no `.max()`**. `send()` loops one sequential INSERT per phone inside one open transaction (`lib/services/sms.service.ts:456-469`). The `send` surface is rate-limited far more generously than `bulk` (30 req/60s vs 5 req/60s) precisely because the limiter's own comment asserts `send` is "the single/few-recipient path" — an assumption this schema doesn't enforce.

**Expected behavior.** `send` should cap its recipient list at a small number (e.g. 10) so the surface-tiering the rate limiter depends on actually holds; anything larger routes through `/bulk`.

**Root cause.** A recipient cap was placed on `BulkSmsSchema.phones` (`.max(5000)`) but never added when `SendSmsSchema.phone` grew a multi-recipient overload.

**Risk/impact.** A single officer token can issue 30 requests/minute each carrying an unbounded list — bypassing both the bulk request-rate ceiling and its 5,000-recipient cap. Also a real availability risk independent of abuse: an unbounded sequential-INSERT loop inside one transaction can exhaust the serverless request budget mid-flight, after credits are already reserved, stranding them for the sweeper.

**Recommended fix.** Add `.max(10)` to the array branch of `SendSmsSchema.phone`.

**Files affected.** `lib/validators/sms.schema.ts:7`; `lib/services/sms.service.ts:456-469` (batch the insert loop into one multi-row INSERT while here).

**DB-schema impact.** None.

**Backward-compat.** Any caller sending &gt;10 phones to `/sms/send` breaks — check first-party callers before shipping; the in-app UI sends a single phone today.

**Testing.** Route test: 11-element array → 400; scalar and 2-element array still succeed; 5,000-element array is rejected outright, not silently accepted.

---

#### G10 — Campaign/schedule `rawRecipients` is entirely unvalidated: no phone-format check, no cap, no membership check

**Current behavior.** `CampaignCreateSchema.rawRecipients` (`lib/validators/sms.schema.ts:73`) is `z.record(z.unknown())` — no shape enforced. For `recipientType: 'custom_phones'`, the handling is a single unsafe cast: `(rawRecipients as {phones?: string[]})?.phones ?? []` (`lib/services/sms.service.ts:282-285`), passed straight to `.map(normalizePhone)`, which **throws** on malformed input, aborting mid-request after the campaign row is already inserted (orphan row). The same unvalidated blob is persisted to `sms_schedules.raw_recipients` for **repeated future execution** on a cron. Contrast `/sms/bulk`, whose equivalent field is a real validated, capped array.

Independently: no send path anywhere (`/send`, `/bulk`, or campaign `custom_phones`) verifies a recipient phone belongs to a member of the sending group — a group with send permission can address any Kenyan MSISDN from the shared "KITABU YETU" registered sender ID, at their own cost but the platform's shared reputational asset.

**Expected behavior.** One shared, validated recipient schema (a discriminated union on `recipientType`) across all three surfaces, capped the same way `/bulk` already is.

**Root cause.** `resolveSmsRecipients` was extracted as a shared helper across three call sites, but its input validation was only ever written for the one call site (`/bulk`) that predated it.

**Risk/impact.** Unbounded recipient count on the campaign and schedule paths (worse on schedules, since a bad payload re-executes on a cron); a single malformed phone number 500s an entire campaign after its row is already committed; no reputational guardrail on off-roster sends.

**Recommended fix.** Replace `z.record(z.unknown())` with a discriminated union requiring `{phones: z.array(phoneSchema).max(N)}` for `custom_phones` and `{memberIds: z.array(z.string().uuid()).max(N)}` for `selected`. Add a group-membership cross-check (or an explicit, audit-logged opt-in) before accepting an off-roster phone.

**Files affected.** `lib/validators/sms.schema.ts:73, 96`; `lib/services/sms.service.ts:282-285`; `app/api/v1/sms/campaign/route.ts:287`; `app/api/v1/sms/schedules/route.ts:477`.

**DB-schema impact.** None.

**Backward-compat.** Existing `sms_schedules.raw_recipients` rows predate any schema — validate on write only, keep a defensive (non-throwing) filter on read for already-stored rows.

**Testing.** Campaign POST with 50,000 phones → 400, not 500; garbage phone → 400 with no orphan campaign row left behind; a `selected` payload referencing another group's member resolves to zero recipients (the join already does this — pin it with a regression test).

---

#### G13 — `TEXTSMS_API_KEY` is written to console logs on any DLR poll error, outside production

**Current behavior.** `sms.service.ts:991` — `logger.error('[sms] DLR poll error', { logId: log.id, err })` — the error is nested **inside an object**, not passed top-level. `lib/logger.ts:24-32` only reduces a **top-level** `Error` argument to `{message, stack, name}`; a nested error takes the plain-object branch and is `JSON.stringify`-ed whole at `:35`. `JSON.stringify` invokes `AxiosError.prototype.toJSON()`, which serializes `config` — and the DLR call places `apikey` directly in `config.params` (`textsms.service.ts:323`). So any DLR poll failure (every provider 5xx, timeout, or connection reset — which happens in volume during exactly the kind of incident this system has already had) writes the live API key in cleartext to the log stream whenever `NODE_ENV !== 'production'`. The two other SMS error sites (`sms.service.ts:702, 1329`) pass the error top-level and are already safe.

**Expected behavior.** Provider credentials never reach a log sink, in any environment.

**Root cause.** The logger's Error-narrowing only inspects top-level arguments; the one SMS call site that nests its error was never brought in line with the others.

**Risk/impact.** Standing credential exposure in preview/CI/dev logs, which are frequently more broadly readable than production. A leaked key allows sending SMS as "KITABU YETU" at the platform's cost and reading every tenant's delivery reports.

**Recommended fix.** Fix the one call site to pass the error top-level; harden `lib/logger.ts` to reduce a nested `Error` the same way, or add a generic redaction pass for keys matching `/apikey|token|secret|password|partnerid/i`. Treat `TEXTSMS_API_KEY` as already-compromised and rotate it.

**Files affected.** `lib/services/sms.service.ts:991`; `lib/logger.ts:24-32`.

**DB-schema impact.** None.

**Backward-compat.** Console output for nested errors changes shape in dev; keep `stack` for debuggability.

**Testing.** Unit test: construct an `AxiosError` with `config.params.apikey`, pass it nested to `logger.error` under `NODE_ENV≠production`, assert the secret never appears in the captured output.

---

### MEDIUM

#### G6 — Campaign counters can still show inverted sent/failed for a completed campaign; nothing detects or backfills it **[PROVEN-PROD]**

**Current behavior.** The `syncCampaignCompletion()` fix (`lib/services/sms.service.ts:236-252`, shipped 2026-08-12) is real and does correctly recompute `sent_count`/`failed_count` from `sms_usage_logs` — confirmed both by source reading and by a live campaign that completed *after* the fix shipped showing correct counts (`f4b66cbb…`, completed 2026-08-27 15:05: `sent=8, failed=0`, matching real logs exactly).

**But a different campaign from the same day still shows the inverted historical bug** — `9e1d1bf5…` (completed 2026-08-27 13:36) reads `sent_count=0, failed_count=8` in `sms_campaigns` today, while the real `sms_usage_logs` rows for that campaign show `real_sent=8, real_failed=0`. This is the "Mobilization campaign" already noted in this project's own memory as a live incident at the time — and it has **never been corrected**, three weeks later, in production.

**Root cause.** `syncCampaignCompletion` is only invoked from inside `sendBulkCampaign`'s own completion paths (three call sites, all requiring `input.campaignId`) — it recomputes at the moment a campaign transitions to complete, going forward. It has **no retroactive counterpart**: nothing ever re-runs it against an already-completed row, and there is no reconciliation job of any kind that would notice `sent_count`/`failed_count` disagreeing with the ground-truth `sms_usage_logs` aggregate (this is the same gap as G16 — no reconciliation surface exists for any SMS aggregate, not just credits).

**Expected behavior.** A campaign's displayed counts should always agree with its own message log, and a drift between them should be self-healing or at least detectable.

**Risk/impact.** Direct, currently-live misinformation on an admin-facing dashboard — an admin looking at this specific campaign today sees "0 sent, 8 failed" for a campaign that in fact fully succeeded. Low volume today (one row), but the underlying gap (no backfill mechanism, no reconciliation) means any future regression of `syncCampaignCompletion` would silently accumulate the same way, undetected.

**Recommended fix.** One-off: `UPDATE sms_campaigns c SET sent_count=(SELECT count(*) FROM sms_usage_logs WHERE correlation_id::text=c.id::text AND status='sent'), failed_count=(...status='failed') WHERE ...` — trivial, safe, additive. Structural: add a lightweight nightly reconciliation job (or extend the one recommended in G16/G17) that flags any `sms_campaigns` row whose stored counts disagree with the real aggregate.

**Files affected.** One-off `scripts/ops/` backfill; `lib/jobs/handlers.ts`/`types.ts`/`index.ts` for the recurring check.

**DB-schema impact.** None.

**Backward-compat.** Purely corrective; no schema or API change.

**Testing.** After the backfill, assert `SELECT count(*) FROM sms_campaigns c WHERE c.sent_count != (SELECT count(*) FROM sms_usage_logs WHERE correlation_id::text=c.id::text AND status='sent')` returns 0.

---

#### G11 — Welcome SMS's idempotency key omits the membership: a member joining a second group silently gets no welcome, permanently **[PROVEN-PROD]**

**Current behavior.** `emitMemberRegisteredEvent` (`lib/services/members.service.ts`) passes `eventId: memberId`. The claim is `ON CONFLICT (rule_id, event_id) DO NOTHING` — **confirmed live**: the actual unique index is `sms_trigger_exec_idempotent ON sms_trigger_executions (rule_id, event_id)`, and the `member_welcome` rule is confirmed a single global row (`group_id IS NULL AND organization_id IS NULL`). Because the rule is global, `rule_id` is constant across every group — so member M joining group A claims `(rule, M)`; M later joining group B hits the identical key and is silently dropped by `DO NOTHING`. Multi-group registration (shipped 2026-08-15, PR #76) makes a member belonging to two chamas a routine case, not an edge case.

**Root cause.** The PR's own commit message states the event identity should be the *membership*, not the *member* — but the code passes `memberId`. `sms_trigger_executions` is append-only (DELETE refused, UPDATE refused on terminal rows), so a suppressed welcome cannot be recovered through the trigger at all.

**Risk/impact.** Silent under-delivery in the direction the platform's multi-group model makes routine, permanently unrecoverable without a manual backfill script (which already exists for the original incident and would need re-running).

**Recommended fix.** Pass `group_members.id` (the membership row, already in scope at the call site) as `eventId` instead of `memberId`.

**Files affected.** `lib/services/members.service.ts` (`emitMemberRegisteredEvent`).

**DB-schema impact.** None if only the emitted value changes. (Widening the unique index to `(rule_id, group_id, event_id)` as defense-in-depth would require checking for pre-existing duplicate-by-group rows first — there should be none, since duplicates are exactly what's being suppressed.)

**Backward-compat.** Members already welcomed under the old key will get a **second** welcome for group A once the key shape changes, unless existing rows are backfilled to membership ids first — this needs a deliberate call, not a silent ship.

**Testing.** Create member M in group A → 1 execution; add M to group B → a second, distinct execution and a second SMS. Re-adding M to group A still dedupes correctly.

---

#### G12 — Welcome SMS bypasses the per-group SMS rate limiter entirely

**Current behavior.** `enforceSmsRateLimit` is invoked from exactly three HTTP routes (`/sms/send`, `/sms/bulk`, `/sms/campaign`) — never from the trigger-engine dispatch path that the welcome SMS (and every other trigger rule) actually spends credits through. The only ceiling on this send path is the general per-user API rate limit (240 req/60s, post-PR #113).

**Root cause.** The SMS-specific limiter is bolted onto three routes rather than onto the service that actually spends credits — a structural gap that will recur with every future trigger rule, not specific to welcome SMS.

**Risk/impact.** A compromised token with member-create permission can drive credit spend at ~240/min — 48× the `/bulk` ceiling — without ever touching an SMS endpoint. Also interacts with PR #113: authenticated traffic's rate ceiling was correctly *raised* per-user to fix a legitimate CGNAT false-positive, which as a side effect widens exactly this blast radius, since the per-group SMS limiter never covered this entry point to begin with.

**Recommended fix.** Move the SMS rate-limit check into `smsService.send`/`sendBulkCampaign` (or into the trigger engine's dispatch step) so it applies regardless of entry point, keyed on the spending group. Add a distinct `trigger` tier to the existing rate-limit config.

**Files affected.** `lib/sms/rate-limit.ts`; `lib/sms/trigger-engine.ts`; `lib/services/members.service.ts`.

**DB-schema impact.** None.

**Backward-compat.** Remove the now-redundant per-route checks in the same change, or the effective ceiling silently halves.

**Testing.** 300 rapid member-creates in one group should not produce 300 SMS. Confirm the limiter's existing fail-open behavior on a Redis outage is preserved.

---

#### G14 — No alerting of any kind; a total provider outage is invisible until a human reads the database

**Current behavior.** Every SMS failure signal terminates at `console` — `lib/logger.ts` writes structured JSON in production with a comment aspiring to "easy ingestion by Logtail/Datadog," but no such sink is wired (no Sentry/Datadog/OTel dependency anywhere in `package.json`). The **only** alert primitive in the entire SMS job catalog is the low-balance alert; there is no equivalent for provider health. The Ndengelwa incident (every send returning HTTP 401 platform-wide) produced correct log lines and was found only by a human reading production data days later — that detection gap is unchanged today.

**Expected behavior.** A sustained failure-rate breach or a consecutive-failure streak from the provider should raise the same kind of staff notification the low-balance alert already uses.

**Root cause.** Failure logging exists and is reasonably thorough; nothing consumes it in aggregate.

**Risk/impact.** Every finding in all three SMS audits to date, including this one, was discovered by manual SQL rather than by the system noticing on its own.

**Recommended fix.** Route `logger.error` to a real sink (Sentry is the lowest-friction option for this stack). Add an `sms_provider_health` job sampling recent failure rate and raising a staff notification (in-app + email, never via SMS) past a threshold. Extend the existing `/status` probe to include SMS provider reachability and queue depth.

**Files affected.** `lib/logger.ts`; `lib/jobs/types.ts`, `handlers.ts`, `index.ts`; `app/status`; `package.json`.

**DB-schema impact.** Optional health-snapshot table; can run from `sms_usage_logs` aggregates initially.

**Backward-compat.** Additive.

**Testing.** Simulate 100% provider failure; assert one alert is raised, not one per message, and never via SMS itself.

---

#### G15 — No provider fallback or circuit breaker; retry cadence has no health gate

**Current behavior.** Confirmed still true: `provider` is a hardcoded literal at every insert, no second adapter exists, and nothing routes on the column. New this pass: **credits are handled correctly under an outage** (every failure path correctly releases reservations, backstopped by the stale-reservation sweeper) — but the *failure bookkeeping* amplifies the outage's cost. Every failed send writes an `sms_failures` row with a flat 5-minute retry regardless of cause, and `retryFailures` pulls up to 100 due rows per tick with no notion of provider health. A one-hour outage over normal daily volume produces thousands of retry rows becoming due together, each burning a 20s timeout inside the now-tight 60s function ceiling (G2) — maximum work, maximum latency, for guaranteed-zero delivery, starving every other job type through the shared time budget exactly when recovery matters most.

**Recommended fix.** A lightweight circuit breaker in `textsms.service.ts` (consecutive-failure counter, fail-fast while open, periodic half-open probe); gate `retryFailures` on it so an outage doesn't burn retry budget uselessly.

**Files affected.** `lib/services/textsms.service.ts`; `lib/services/sms.service.ts:1020-1145`; `lib/jobs/handlers.ts`.

**DB-schema impact.** Optional health-state table.

**Backward-compat.** Breaker defaults closed; no behavior change while healthy.

**Testing.** N consecutive rejections open the circuit; a successful half-open probe closes it; an outage does not exhaust a message's `max_retries` budget while the circuit is open.

---

#### G16 — Reconciliation view (`vw_sms_credit_reconciliation`) has zero consumers anywhere in the app

**Current behavior.** Confirmed by grep: no `.ts`/`.tsx` file references the view, `drift`, or `lot_drift`. `sms-margin.service.ts` and both admin SMS pricing routes query the underlying tables directly, never the view. No cron job reconciles anything. The instrument exists (migrations 141/146); nothing reads the dial.

**Risk/impact.** Every billing-bug class this audit series exists to catch — a missed settle, a manual grant, a partial sweep, G19's stranded reservation, G18's rounding drift — is currently invisible, and would stay invisible indefinitely.

**Recommended fix.** A daily reconciliation job mirroring the existing `gl_cash_reconciliation` pattern already in the codebase; alert above a tolerance; surface a drift table on `/admin/sms-pricing`. Fix G18 first, or the job cries wolf on every payer from day one.

**Files affected.** `lib/jobs/types.ts, handlers.ts, index.ts`; `lib/services/sms-margin.service.ts`; `app/(admin)/admin/sms-pricing/page.tsx`.

**DB-schema impact.** None — the view and its grants already exist correctly.

**Testing.** Seed a known drift; assert the job reports it; assert a clean tenant reports exactly zero.

---

#### G17 — No provider-side reconciliation exists at all

**Current behavior.** A TextSMS balance-query endpoint exists and is correctly hardened, but is only triggered manually by a treasurer — no cron enqueues it, and nothing compares provider balance depletion against what the platform believes it submitted (segments × unit cost). This is the specific control that would have caught G5 (the segment-billing leak) automatically.

**Recommended fix.** Enqueue an hourly provider-balance snapshot; a daily job computing expected vs. actual balance drop between snapshots (unit cost is already available, date-scoped, in `sms_provider_costs`); alert beyond tolerance.

**Files affected.** `lib/jobs/types.ts, index.ts, handlers.ts`; `lib/services/sms-margin.service.ts`.

**DB-schema impact.** Optional `sms_provider_reconciliations` table mirroring the existing `mpesa_reconciliations` shape.

**Backward-compat.** Additive; historical snapshots are sparse, so the series is only meaningful going forward.

**Testing.** Two synthetic snapshots plus a known segment count; assert variance computation and threshold alerting.

---

#### G18 — Numeric-scale mismatch between `sms_credit_ledger` and `billing_accounts` means reconciliation can never read exactly zero, even when everything is correct

**Current behavior.** `sms_credit_ledger.amount` is `NUMERIC(14,4)`; `billing_accounts.sms_credits` and `sms_credits.credits_added` are `NUMERIC(_,2)`. The top-up writer computes credits to 4dp and writes that value to both the 2dp balance and the 4dp ledger. At the live 0.90 rate, KES 100 → 111.1111: balance stores 111.11, ledger stores 111.1111 — a small, same-sign, permanent drift on every single top-up.

**Risk/impact.** Once any reconciliation job exists (G16), it inherits noise that makes a real discrepancy indistinguishable from rounding — the exact "alerting that cries wolf" risk G16's own fix depends on avoiding.

**Recommended fix.** Round once, at the source — compute credits to the balance column's own scale (2dp) in the top-up writer and use that single value everywhere (balance, lot, ledger), rather than widening columns.

**Files affected.** `lib/services/billing.service.ts` (`addSmsCredits` and its organization mirror).

**DB-schema impact.** None if rounding at source; a one-off reconciling ledger `adjustment` entry should absorb any drift already accumulated (never edit the append-only ledger in place).

**Testing.** After N top-ups at a rate with a non-terminating reciprocal, assert `drift` and `lot_drift` both read exactly zero.

---

#### G19 — A failed log-row insert strands an aggregate reservation the sweeper can never find

**Current behavior.** `sendSmsLeg` reserves credits first, then inserts the per-item `sms_usage_logs` ticket — which is documented to return `null` on write failure and let the send proceed anyway, skipping settlement entirely. But the aggregate earmark on `billing_accounts.reserved_sms_credits` has already committed. The stale-reservation sweeper selects **only from `sms_usage_logs`**, so with no ticket row, there is nothing for it to find.

**Risk/impact.** Low frequency, unbounded consequence: a group's spendable balance (`sms_credits - reserved_sms_credits`) permanently shrinks with no report explaining why, and no existing reconciliation surface would catch it (`vw_sms_credit_reconciliation` doesn't look at `reserved_sms_credits` at all).

**Recommended fix.** On a `null` insert result, immediately compensate (release the just-taken reservation) rather than let the send proceed unaudited. Add a second sweeper arm reconciling `billing_accounts.reserved_sms_credits` against `SUM(credits_reserved) WHERE billing_state='reserved'`, clamping drift after a grace window.

**Files affected.** `lib/services/notifications.service.ts`; `lib/jobs/handlers.ts` (stale-reservation sweep); one new SQL function.

**DB-schema impact.** New function, no table change.

**Backward-compat.** The new sweeper arm will find and can release any drift already accumulated in production — run it report-only first.

**Testing.** Force `insertSmsLog` to return `null`; assert the reservation returns to its pre-send value.

---

#### G20 — Self-service opt-out is unreachable by the exact population G8 now auto-messages

**Current behavior.** The self-service opt-out (PR #39) is correctly wired and honoured on every send path, but requires an authenticated app session scoped to one active group — precisely what a phone-only member added by an officer (the population the welcome SMS now messages on day one) does not have. There is no inbound STOP webhook (confirmed still absent) and no officer-side UI to record a verbal opt-out request — `opt_out_phones` is not exposed in the settings route's read or write schema at all.

**Risk/impact.** Kenya DPA 2019 requires a data subject be able to object to processing; a phone-only member currently has no mechanism whatsoever — not STOP, not login, not an officer they can ask. This is sharper than the general "no inbound webhook" finding because the platform now *initiates* contact with exactly this population via G8.

**Recommended fix.** Add an officer-managed opt-out list to group SMS settings (immediate, unblocks the human workflow); investigate whether TextSMS Kenya supports inbound STOP webhooks and wire one if so (the real, structural fix); add a "stop all my groups" control to the member-facing toggle for multi-group members.

**Files affected.** `app/api/v1/sms/settings/route.ts`; `lib/validators/sms.schema.ts`; a new inbound webhook route if the provider supports it; `app/(member)/me/notifications/page.tsx`.

**DB-schema impact.** The `text[]` opt-out column is a poor fit for an auditable consent record (no timestamp, source, or actor) — recommend a proper `sms_opt_outs` table with the array kept as a derived/trigger-synced read path during migration, rather than a big-bang cutover.

**Backward-compat.** Four existing read sites reference the array directly and would need migrating alongside any schema change.

**Testing.** Opt-out via each entry point suppresses across every send path; multi-group per-group and global variants both verified.

---

#### G21 — No read surface anywhere for `reminder_dispatch_log`: nobody can answer "did this reminder fire, and to whom?"

**Current behavior.** `reminder_dispatch_log` is written by five call sites and read by zero user-facing surfaces — every `app/` reference is a write/claim path. The admin-visible SMS log (`LogsTab`) shows *messages*, not *reminders*: it cannot show a suppressed-for-opt-out outcome (which never produces a message row at all), which reminder stage a send belonged to, or whether a stuck `failed` dispatch-log row is waiting to retry.

**Risk/impact.** Support burden (this is currently unanswerable without SQL) and a DPA 2019 gap: a member's data-subject-access request about messages sent to them, or evidence that a suppression was honoured, cannot be served from the product today.

**Recommended fix.** A group-scoped `GET /api/v1/sms/reminders` endpoint joined to member name, filterable by reference type/stage/status/date, including suppressed outcomes; surface as a tab in the Chama Reminder product and a self-service equivalent on the member portal.

**Files affected.** New API route; new UI in `components/sms/` and `app/(reminder)/reminder/`; `app/(member)/me/notifications/page.tsx`.

**DB-schema impact.** Read-only — but verify an RLS policy exists on `reminder_dispatch_log` for group-scoped reads before exposing it (it is currently only touched via the admin pool, so one may not exist yet).

**Backward-compat.** Purely additive.

**Testing.** RLS test confirming an officer of group A cannot read group B's rows; assert suppressed rows are included in the listing.

---

#### G22 — Same-day duplicate-reminder risk on the 1st of the month; no recipient/cost preview before a manual send

**Current behavior.** The scheduled contribution-reminder job and the manual "Remind non-contributors" button use genuinely non-overlapping dedup keys (previous month vs. current month) — that reasoning still holds and prevents *key collision*. It does not prevent the member's phone buzzing twice: on day 1 of the month, the manual button's "current month" filter matches essentially the *entire* group (nobody has contributed yet for a month that just started), while the scheduled job fires the same morning for the *previous* month's non-contributors. A member in both sets receives two similar-sounding reminders on the same day, and an officer clicking Remind early in a month is functionally messaging everyone, with no recipient count or cost shown before the click.

**Recommended fix.** A member-level cooldown in the shared `sendOnce` primitive (suppress a second send to the same member within N hours regardless of stage — a general safeguard, not specific to this pair); exclude the first several days of a month from the manual nudge's eligibility, or gate it on the group's actual due-day having passed; show a resolved recipient count and estimated credit cost in a confirmation step before the Remind action fires.

**Files affected.** `lib/services/reminder.service.ts` (`sendOnce`); `lib/services/contributions.service.ts`; the dashboard's non-contributors task component; `app/api/v1/contributions/remind-non-contributors/route.ts`.

**DB-schema impact.** None for the cooldown; an index on `(member_id, sent_at)` would help.

**Backward-compat.** A cooldown changes `sendOnce`'s outcome set — callers' sent/skipped/failed tallies need a new `cooldown` outcome so they don't misreport it as a failure.

**Testing.** Two `sendOnce` calls for the same member on different stages within the cooldown window: the second returns `cooldown`, no provider call, no billing. Simulate the day-1 collision end to end.

---

#### G23 — Unbounded `pruneOldJobs()` DELETE runs inline and awaited on the highest-consequence monthly tick

**Current behavior.** Inside the time-based job enqueuer, on the 1st of the month at 08:00 UTC — the same tick that enqueues the monthly contribution-reminder sweep — an unbounded `DELETE FROM job_queue WHERE status IN ('completed','failed') AND updated_at < NOW() - 30 days` is `await`ed despite a comment calling it "fire and forget." It has no `LIMIT` and no dedup key of its own, so it re-runs on every tick within that hour.

**Risk/impact.** With production job-queue volumes now in the tens of thousands of historical rows, this DELETE competes for the same shrunk time margin G2 already tightened, on a schedule that lands squarely on the month's highest-stakes SMS tick.

**Recommended fix.** Convert to a real queued job with its own dedup key and a `LIMIT` so it drains incrementally, or genuinely fire-and-forget it (don't `await`); measure its actual duration against current row counts before deciding which.

**Files affected.** `lib/jobs/index.ts`; `lib/jobs/db.ts` (`pruneOldJobs`); `lib/jobs/types.ts` if converted to a job type.

**DB-schema impact.** None (a new `JobType` union member is TS-only).

**Backward-compat.** A queued/incremental prune makes the 30-day retention boundary approximate for a tick or two — harmless.

**Testing.** Unit test that a `LIMIT`-bounded prune still converges to the retention target over repeated runs.

---

### LOW

#### G24 — `GET /sms/balance` over-shares the platform-wide provider float to all three officer roles

The platform's own TextSMS account balance (not any tenant's credits — that's the separate, correctly-scoped `/sms/credits`) is readable by `secretary`/`treasurer`/`chairperson` alike via `messaging.view`, a permission all three hold, after being loosened from a `treasurer`-only gate. **Fix:** move it to the `super_admin` admin surface it conceptually belongs with, or re-gate behind `withPlatformRole('super_admin')`. **Files:** `app/api/v1/sms/balance/route.ts:33-46`.

#### G25 — `daily_send_limit` is displayed as if enforced; it is never enforced and cannot be set via the UI

The column is read and shown in the settings API response, but no send path checks it, and the update schema doesn't accept it — so it reads as an active control to an operator when none exists. **Fix:** enforce it in `send()`/`sendBulkCampaign()` (`null` = unlimited, preserving current behavior for every existing row) and add it to the update schema. **Files:** `app/api/v1/sms/settings/route.ts`; `lib/validators/sms.schema.ts`; `lib/services/sms.service.ts`.

#### G26 — `sms_credits.package_id`/`.currency` are still dead columns

Neither is written by the top-up flow; `package_id` is read by the "revenue by package" admin report, which therefore attributes 100% of revenue to the null/"custom" bucket regardless of actual purchases. **Fix:** thread the selected package through the top-up call, or retire the report until packages are actually sellable. **Files:** `lib/services/billing.service.ts`; `lib/services/sms-margin.service.ts`.

#### G27 — Organization SMS top-up has no idempotency guard

The group top-up path has `ON CONFLICT (payment_id) DO NOTHING`; the organization mirror has a bare INSERT (its own comment acknowledges this). Harmless today because it's admin-triggered only — becomes a real double-credit risk the day a callback-driven org top-up path ships. **Fix:** add the same conflict guard and a unique index now, ahead of that. **Files:** `lib/services/billing.service.ts`; one migration.

#### G28 — No retry action or cost/recipient preview in the officer compose UI

A `failed`-status filter exists in the message log, but failed rows have no action — retry is automatic-only and stops permanently once `max_retries` is exhausted, with no way for an officer to intervene. Separately, the compose UI shows per-message cost (`smsPages`) but never `pages × recipients`, the number that actually determines spend, and there's no confirmation step before a large send. **Fix:** a manual retry action (reusing `retryFailures`' safe re-send path, not re-billing) and a dry-run recipient-count/cost preview before Send. **Files:** `components/sms/tabs.tsx`; `app/api/v1/sms/bulk/route.ts`; a new retry route.

#### G29 — Two minor reliability items

An O(n²) array scan in the stale-reservation sweeper (`.filter(...includes(...))` over up to 500 rows) — trivial today, worth a `Set` while touching that function anyway. And `getDlr`'s UPDATE statements aren't group-scoped in their own WHERE clause even though the preceding ownership *check* is — defense-in-depth gap only, since TextSMS message IDs are account-global and a real collision is unlikely, but worth closing alongside a partial unique index on `provider_msg_id`. **Files:** `lib/jobs/handlers.ts:930`; `lib/services/sms.service.ts:906-920`.

#### G30 — Stale comment asserting `organization_sms_credits` has no writer

`sms-margin.service.ts` carries a comment stating flatly that no code path anywhere ever inserts into `organization_sms_credits` and that a nonzero value would be a bug — untrue since PR #98 shipped `addOrganizationSmsCredits`. Load-bearing guidance in a file whose whole purpose is judging whether numbers are real; low risk today only because no organization has actually topped up yet. **Fix:** update the comment. **Files:** `lib/services/sms-margin.service.ts:210-215`.

---

## 4. Target SMS Architecture

The pipeline this audit series has converged on — and which is **already substantially built**, per the inventory in [[project_kitabu_yetu_sms_messaging]] — is:

```
UI (compose / campaign / trigger settings)
  → API route (Zod validation → auth/permission → per-surface + per-group rate limit)
    → SMS service (reserve credits — count today, segments after G5)
      → job queue (durable, priority-lane, dedup-keyed) OR synchronous dispatch for OTP/interactive
        → provider adapter (TextSMS today; circuit-breaker + health gate after G15; second-provider-ready)
          → DLR poll (fair, backlog-aware, after G3) or inbound webhook (does not exist — G20)
            → status reconciliation (per-message: exists and is correct since 2026-08-20;
                                      per-account: does not exist — G16/G17)
              → billing settle (consume/release — correct; segment-aware after G5)
                → audit/reporting (per-message log: solid; per-reminder/per-trigger: does not exist — G21)
```

**What is already right and should not be rebuilt:** reservation-over-debit billing with atomic locking; the trigger engine's `(rule, event)` idempotency claim mechanism (correct shape, wrong key for one new rule — G11); the job-sweep dedup-key fix; RLS tenant isolation on every SMS table (re-verified this pass, no regression); `clientSmsId`-based bulk response alignment; the `dispatchBatchId` job-retry dedup (correct pattern — G1 is a *type* bug in one new implementation of it, not a design flaw); rate limiting's existence, just not its reach (G9, G12); the low-balance alert as the template for the alerting this system otherwise lacks (G14).

**What needs to be added, roughly in dependency order:** (1) fix the type bug that breaks the chunked path outright (G1); (2) restore the safety margin PR #126 removed (G2, G3); (3) close the two duplicate-send surfaces (G4, G7); (4) add the missing unit to billing (G5) and the reconciliation that would have caught it (G16, G17, G18); (5) give the new automation (G8) the same consent scaffolding its sibling already has, and fix its idempotency key (G11); (6) close the consent-reachability gap that automation exposes (G20); (7) add the observability layer that would make every future instance of this audit's findings self-reporting instead of SQL-discovered (G14, G21).

---

## 5. Optimization Roadmap

### Phase 1 — Critical fixes (immediate production/financial/security risk)

- **G1**: UUIDv5 dispatch key for chunked sends. *Highest priority — currently a total, silent outage for the product's highest-volume send path.*
- **G13**: Fix the nested-error logging call site; rotate `TEXTSMS_API_KEY`.
- **G9, G10**: Cap `/send`'s recipient array; replace `rawRecipients`'s unvalidated blob with a real schema.
- **G2**: Confirm the Vercel plan tier, then restore `maxDuration` headroom (or bound the three long-running SMS handlers individually if the plan caps at 60s).

### Phase 2 — Reliability (queues, retries, idempotency, delivery tracking, reconciliation)

- **G3**: Raise the DLR poll limit in step with the tick budget; add fairness/backoff so a backlog can't monopolize every slot.
- **G4**: Per-chunk (not per-batch) error handling in `sendBulkSmsChunked`.
- **G7**: Correlation-id dedup guard on `smsService.send()`.
- **G19**: Compensate on a failed log-insert instead of leaving an orphaned reservation; add the aggregate-vs-ticket sweep arm.
- **G16, G17, G18**: Ship the internal and provider-side reconciliation jobs (fix the numeric-scale mismatch first).
- **G6**: One-off backfill of the known-wrong campaign row; fold ongoing detection into the G16 job.
- **G23**: Make the monthly prune bounded or genuinely async.
- **G15**: Circuit breaker + health-gated retry.

### Phase 3 — UX & Operations (templates, reporting, credit visibility, failed-message management, admin tools)

- **G8**: Opt-in toggle + minimal Automations/executions UI for trigger rules (welcome SMS specifically, generalizable to future rules).
- **G11, G12**: Fix the welcome-SMS idempotency key; route trigger-engine sends through the per-group rate limiter.
- **G20**: Officer-managed opt-out list (fast); investigate inbound STOP webhook support (structural).
- **G21**: Reminder-dispatch read surface, including suppressed outcomes.
- **G22**: Member-level send cooldown; recipient/cost confirmation before a manual bulk send.
- **G28**: Manual retry action on failed messages; pre-send cost/recipient preview.
- **G24, G25, G26, G30**: The four low-severity cleanups (permission scope, dead-limit UI honesty, dead columns, stale comment).

### Phase 4 — Scalability (higher volume, multiple organizations)

- **G5**: Segment-based billing — the highest-effort, highest-stakes item in this whole report, because it is a real price change requiring customer communication and UI work (segment counter) ahead of the backend flip. Sequence last, after G16/G17 exist to measure its actual current impact before committing to a rollout plan.
- **G27**: Idempotency guard on organization SMS top-ups, ahead of building the org self-serve top-up flow this audit series has flagged as still-missing since PR #98/#99.
- **G14**: Real alerting sink (Sentry or equivalent) — positioned last only because it's infrastructure rather than a specific bug, but it is what turns every future instance of "found by manual SQL three weeks later" into "found by an alert the same day."

---

## 6. Backward Compatibility

No item in this report requires a rewrite; every fix is additive or a targeted correction to code shipped in the last three weeks (G1, G7, G8, G11, G12 are all inside PR #124/#126's diff; G2/G3/G23 are inside PR #126's diff). The items needing explicit, non-silent product decisions before shipping:

- **G8's default.** Turning welcome SMS off-by-default (matching its sibling birthday-SMS pattern) changes live behavior for every group today. The alternative — defaulting on only for groups with a customized template — needs a decision, not a default either way.
- **G5's rollout.** Segment-based billing is a real price increase for long or Unicode-bearing messages. Ship the UI counter first, communicate before the backend flip, and do not retroactively re-price historical rows (`segments=1` is correct for what was actually charged).
- **G11's backfill.** Changing the welcome-SMS idempotency key means already-welcomed members get a second welcome for their first group unless existing rows are backfilled to the new key shape first.
- **G9's cap.** Confirm no first-party caller currently sends `/sms/send` a large array before shipping the `.max(10)` cap.
- **G22's cooldown.** Requires threading a new outcome state through every caller of `sendOnce` so a suppressed-by-cooldown send isn't misreported as a failure in existing counters.

Everything else — the reconciliation jobs, the read-only reminder/trigger surfaces, the officer opt-out list, the retry/preview UI, the low-severity cleanups — is purely additive with no compatibility surface at all.

---

## 7. Testing Strategy

| Category | What this pass found is missing or would have caught the findings above |
|---|---|
| **Unit** | `countSegments()` boundary table (G5); UUID-shape guard on `dispatchBatchId` (G1); `logger.error` secret-redaction test (G13); `maxDuration > budget + worst-case-job` invariant test (G2) |
| **API/route** | `/sms/send` array cap (G9); `/sms/campaign` `rawRecipients` schema rejection cases (G10); `/sms/balance` role gating (G24) |
| **Integration (real Postgres — already runs in CI via `test:integration`; the gap was a missing case, not a disabled runner)** | Chunked bulk send with **no `campaignId`** (G1 — added as `sms-chunked-dispatch-key.test.ts`); mid-batch chunk failure preserving partial success (G4); trigger-retry + cron-retry collision (G7); stale-reservation compensation on a failed log insert (G19); reconciliation-view zero-drift after N top-ups (G18) |
| **Provider-failure scenarios** | Circuit breaker open/half-open/close cycle (G15); outage does not exhaust `max_retries` while breaker is open (G15); sustained-failure alert fires once, not per-message (G14) |
| **Webhook/DLR** | Fairness/backoff poll ordering resolves a mixed backlog within N ticks (G3) |
| **Retry/idempotency** | Welcome-SMS second-group execution (G11); dedup on `smsService.send()` (G7); manual retry doesn't re-bill and still honours opt-out (G28) |
| **Billing/credit** | Segment-aware reservation math end to end (G5); rounding-source fix produces exact-zero drift (G18); org top-up conflict guard (G27) |
| **Bulk SMS** | 5,000-recipient reject/accept boundary on `/bulk` (G9 adjacent); chunk-partial-failure billing correctness (G4) |
| **Scheduled notification** | Day-1-of-month collision between manual nudge and scheduled reminder (G22); cooldown suppresses a same-day duplicate without misreporting as failed |
| **Multi-tenant isolation** | `reminder_dispatch_log` RLS policy exists and is group-scoped before exposing it via G21's new route; `getDlr` UPDATE scoping (G29) |
| **Authorization/security** | Rate-limit enforcement reaches the trigger-engine spend path, not just the three routes (G12); campaign off-roster recipient rejected by membership check (G10) |
| **Regression** | Re-run this report's own "confirmed still fixed" table (§8) as an actual automated suite where it isn't already — several of those items (the parameter-type-inference class especially) have regressed silently before |

---

## 8. Confirmed Still Fixed — No Regression Found

Re-verified directly against current source this pass, not re-derived from memory of the prior reports:

- **2026-08-06 audit**: C1 (invalid `FOR UPDATE` SQL) — fixed, reservation atomicity re-confirmed sound with no new hazard introduced since. C2 (`"200"===200` string/number bug) — fixed, `toResponseCode()` coerces correctly, fails closed. C3 (DLR cross-tenant IDOR) — fixed and hardened further (ownership pre-check runs before any mutation, not just at the route layer).
- **2026-08-20 audit**: the DLR field-read fix (`delivery-description`, not `delivery-status`) — intact. HTTP 404 handling for "no report yet" — intact. H2 (job-sweep dedup key regenerating unboundedly) — intact, and confirmed not touched or undone by PR #126. M1 (low-balance alert never re-arming) — fixed and wired.
- **2026-08-08/09 fixes**: H3 (job-retry re-billing/re-sending, `dispatchBatchId` correlation) — intact for the unchunked path (broken for the chunked path by G1, a different bug in a newer code path). H6 (bulk response misattribution via `clientSmsId`) — intact.
- **The parameter-type-inference SQL bug class** (a `$n` used both as a typed-column value and inside a string-literal comparison in one statement) — **zero new instances found** across every raw SQL site read in this subsystem this pass, including all five previously-affected files. Every one now carries the explicit cast this project has learned to require.
- **The `'respose-code'` provider-field-spelling bug** — both spellings still accepted.
- **Migration 126's PostgREST exposure closure** — re-verified live: `reserve_sms_credits`, `settle_sms_credit_reservation`, `draw_sms_credit_lots`, `sms_ledger_append` all confirmed **not** executable by `anon` or `authenticated`. The broad table-level grants on every `sms_*` table to `anon`/`authenticated` (which look alarming in isolation) were traced end-to-end this pass — every one relies on a real, group-scoped RLS policy that resolves to deny for any connection outside the app's own pool (the `app.current_group_id`/`app.current_role` session variables these policies key on are never set by a raw PostgREST/Supabase-Auth request). This is Supabase's documented-safe default pattern for this schema, confirmed correct, not a new exposure.
- **Campaign `notification_type` attribution** (previously hardcoded to `'campaign'` regardless of real feature) — fixed, real category now written.
- **`ComposeTab`'s 500-recipient silent cap** (a schema mismatch that capped "send to all" at 20 for larger groups) — fixed; the client no longer enumerates and lets the server resolve recipients server-side.
- **The Sender ID** (`KITABU YETU`) — unchanged, correct.
- **`sms_allowance_monthly_reset` scheduling** — re-examined against the specific "1st of month / timezone" question this pass was asked to check: it is not calendar-fixed at all, it is a **daily, anniversary-derived** check per group, which is a stronger design than the "1st of month" framing assumed. No timezone concern.

---

## 9. Final Recommendation — Exact Sequence

1. **G1** (Critical — chunked bulk SMS is completely broken; fix the UUID type mismatch and add the missing no-`campaignId` chunk test, which is the case no existing test covered). **✅ DONE** — see `lib/utils/uuid.ts`, `sms-chunked-dispatch-key.test.ts`.
2. **G13** (rotate the leaked credential and fix the logging call site — cheap, and the exposure is standing).
3. **G9 + G10** (cap `/send`, validate `rawRecipients` — both are small, high-confidence input-validation fixes with real abuse/availability exposure).
4. **G2 + G3** (confirm the Vercel plan tier; restore job-worker headroom and DLR poll throughput — these two together are why half of all messages never resolve their delivery status, and why the timeout-double-bill risk is back).
5. **G4 + G7** (the two duplicate-send/duplicate-charge surfaces — close both before volume grows further).
6. **G8 + G11 + G12 + G20** (the welcome-SMS cluster — give it the opt-in/visibility scaffolding its own sibling feature already models, fix its idempotency key, route it through rate limiting, and close the consent-reachability gap it opened for phone-only members).
7. **G16 + G17 + G18 + G6** (build the reconciliation layer that has been structurally absent this whole time — fix the rounding mismatch first, then the internal job, then the provider-side check, then backfill the one campaign row already known wrong).
8. **G5** (segment-based billing — the largest single piece of work in this report; sequence after step 7 so its actual revenue impact can be measured before committing to a customer-facing rollout).
9. **Phase 3/4 remainder** (G14, G15, G19, G21, G22, G23, G24–G30) — real, but none is urgent enough to precede the above; work through the roadmap in §5 order.

---

*Produced 2026-08-31 via four parallel source-grounded research passes plus direct live-production verification (Postgres `qztcgryhoanennsizcll`). Findings labelled [PROVEN-PROD] were confirmed against live data, not inferred from source alone. One research-pass claim was corrected against live data (§Correction) before inclusion. Add this audit to the running log at [[project_kitabu_yetu_audits]] and update [[project_kitabu_yetu_sms_trigger_engine]] / [[project_kitabu_yetu_sms_audit_2026_08]] with the new open items once fixes begin shipping, per [[feedback_persist_completed_work_to_memory]].*
