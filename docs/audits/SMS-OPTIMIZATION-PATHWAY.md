# SMS-OPTIMIZATION-PATHWAY

**Companion to:** `SMS-AUDIT-v3-FINDINGS.md` (2026-08-31)
**Rule:** every item traces to at least one GAP-ID and carries a falsifiable closure test. An item tracing to no gap is scope creep and has been deleted.
**Bias:** PostgreSQL-enforced correctness over application-enforced, per brief §11. Where a constraint or lock closes a gap, no rewrite is proposed.

---

## T0 — CONTAINMENT (hours, no schema change)

Stops active bleeding. Every item here is reversible by reverting one commit or flipping one value.

### T0-1 · Fix the chunked-dispatch key → closes **G1** (CRITICAL)
**Deps:** none. **Mechanism:** derive a deterministic UUIDv5 from `${jobId}:chunk:${chunkIndex}` in `app/api/v1/workers/sms-dispatch-chunk/route.ts:111`, so the value is stable across QStash retries, distinct per chunk, and type-valid for the `uuid` column. Add a UUID-shape guard at the top of `sendBulkCampaign` that throws loudly rather than failing mid-transaction.
**Migration risk:** none — no schema change, and no historical rows exist to migrate (every such send has always failed).
**Rollback:** revert the commit; behaviour returns to today's (broken) state, no data to unwind.
**Closure test:** integration test — enqueue `sms_bulk_send` with 150 phones and **no** `campaignId`, QStash configured; assert exactly 150 `sms_usage_logs` rows across 3 chunks, each with a distinct valid-UUID `correlation_id`. *Currently this test fails with `22P02`; it must pass.*

### T0-2 · ~~Re-enable integration tests in CI~~ → **PREMISE WITHDRAWN; replaced by "cover the untested case"** → closes the meta-gap behind **G1**
**Correction (2026-08-31, during remediation).** This item was written on a false premise and is retained so the error is not silently repeated. Integration tests **already run in CI**, via `npm run test:integration` against a real `postgres:17-alpine` service container (`.github/workflows/ci.yml:388-390, 440`) using `jest.integration.config.ts`. The `testPathIgnorePatterns` entry in `jest.config.ts` merely keeps them out of the *unit* run, which is correct and deliberate. Nothing needed re-enabling.

**The actual meta-gap:** `sendBulkCampaign` resolves `dispatchKey = campaignId ?? dispatchBatchId`, and every existing test that used the malformed `${jobId}:chunk:N` string **also passed a `campaignId`**, which takes precedence — so the malformed key was never exercised as the key. The one test covering the no-campaign path used a valid uuid. The production combination was simply never written.

**Mechanism (done):** `__tests__/integration/sms-chunked-dispatch-key.test.ts` covers the real shape — chunk key, no campaign — plus retry dedup on a re-derived key, sibling-chunk independence, and boundary rejection of a non-uuid key.
**Closure test:** that file passes in CI. **Standing lesson:** auditing test *coverage* by filename is not auditing coverage — read what the test actually asserts and which branch its inputs select.

### T0-3 · Stop logging the provider credential → closes **G13**
**Deps:** none. **Mechanism:** at `lib/services/sms.service.ts:991` pass the error top-level instead of nesting it in a context object; and harden `lib/logger.ts:24-32` to reduce a nested `Error` value the same way it reduces a top-level one. Add a `JSON.stringify` replacer redacting keys matching `/apikey|api_key|token|secret|password|partnerid/i`.
**Rollback:** revert; no persisted state.
**Closure test:** unit test — construct an `AxiosError` carrying `config.params.apikey = 'SECRET'`, pass it **nested inside a context object** to `logger.error`, assert `'SECRET'` appears nowhere in captured output, under both `NODE_ENV` values.
**Operational follow-up (not code):** rotate `TEXTSMS_API_KEY`; assume it is already present in historical logs.

### T0-4 · Cap the send surfaces → closes **G9**, **G10**
**Deps:** none. **Mechanism:** add `.max(10)` to the array branch of `SendSmsSchema.phone` (`lib/validators/sms.schema.ts:7`); replace `rawRecipients: z.record(z.unknown())` (`:73`) with a discriminated union on `recipientType` — `custom_phones` requires `{ phones: z.array(phoneSchema).max(5000) }`, `selected` requires `{ memberIds: z.array(z.string().uuid()).max(5000) }`.
**Migration risk:** none. **Backward-compat:** existing `sms_schedules.raw_recipients` rows predate any schema — validate **on write only**, and add a non-throwing defensive filter on read so stored rows degrade rather than 500.
**Rollback:** revert the schema change.
**Closure test:** `POST /sms/send` with an 11-element array → 400; `POST /sms/campaign` with 50,000 `custom_phones` → 400; with a malformed phone → **400, not 500**, and assert **no orphan `sms_campaigns` row** is left behind.

### T0-5 · Ship a global SMS kill switch → closes **V3-05**
**Deps:** none. **Mechanism:** a single platform-level flag checked at the top of `smsService.send` and `sendBulkCampaign` (the two spend primitives, not the routes). Prefer a `feature_flags` row over an env var so it can be flipped without a redeploy — an incident switch that needs a deploy is not an incident switch.
**Migration risk:** trivial insert. **Rollback:** flag defaults to enabled; removing the check restores today's behaviour.
**Closure test:** with the flag off, every send path returns a distinct `halted` outcome, **reserves no credit**, and calls no provider; with it on, behaviour is byte-identical to before.

### T0-6 · Enforce `daily_send_limit` → closes **G25**, blunts **G9/G12**
**Deps:** T0-5 (same insertion point). **Mechanism:** count today's rows for the group and compare before reserving; treat `NULL` as unlimited so **no existing group's behaviour changes on deploy**. Add the field to `SmsGroupSettingsUpdateSchema` so it can actually be set.
**Migration risk:** none (column exists). **Rollback:** revert.
**Closure test:** set the limit to 5, send 5, assert the 6th is refused **before** reservation; assert `NULL` is unlimited; assert the day boundary is evaluated in Africa/Nairobi, not UTC (see T2-1).

---

## T1 — INTEGRITY (days)

Atomicity, idempotency, and the DB-level constraints that make a class of bug unrepresentable.

### T1-1 · Restore job-worker headroom → closes **G2**
**Deps:** resolve the INSUFFICIENT-EVIDENCE item on the Vercel plan tier first — it decides which branch applies.
**Mechanism (branch A, plan allows >60s):** raise `maxDuration` in `app/api/cron/route.ts:38` to 300, keeping `TIME_BUDGET_MS = 50_000`. One line; restores the ~250s of single-job slack PR #126's own reasoning assumed.
**Mechanism (branch B, plan caps at 60s):** bound the handlers instead — give `pollPendingDlrs` and `retryFailures` a per-iteration deadline check returning partial progress, and lower `retryFailures`' default limit from 100 to ~20. Partial progress is already safe for both (DLR re-polls next tick; `sms_failures` rows stay due).
**Rollback:** revert the constant. **Closure test:** a lint/unit assertion that `maxDuration > TIME_BUDGET_MS + worst_case_single_job_ms`, so the invariant cannot silently regress a third time; plus a load test of 100 due `sms_failures` against a 2s-latency stubbed provider asserting the handler returns inside the deadline with every row either resolved or cleanly still-due — never lost, never duplicated.

### T1-2 · One retry owner per message → closes **G7**, **H5**
**Deps:** none. **Mechanism:** give `smsService.send` the same `correlation_id` pre-flight exclusion `sendBulkCampaign` already has (the key is already populated at the trigger-engine call site). Back it with a **partial unique index** — `sms_usage_logs (group_id, recipient_phone, correlation_id) WHERE correlation_id IS NOT NULL` — so the guarantee is database-enforced, not application-enforced.
**Migration risk:** the index build must be preceded by a duplicate check; build `CONCURRENTLY`.
**Backward-compat:** dedup changes `send()`'s return shape for already-logged recipients. The trigger engine's "empty result ⇒ all opted out" branch must gain a distinct `dedupedAway` signal or a deduped retry will be misreported as mass opt-out.
**Closure test:** rule fires → provider rejects all → run **both** the trigger-level retry and the `sms_retry_failed` cron to completion → assert exactly **one** delivered message and **one** consumed credit.

### T1-3 · Compensate orphaned reservations → closes **G19**
**Deps:** none. **Mechanism:** when `insertSmsLog` returns `null`, immediately release the just-taken aggregate reservation rather than proceeding with an unauditable send. Add a second arm to `sms_release_stale_reservations` reconciling `billing_accounts.reserved_sms_credits` against `SUM(credits_reserved) WHERE billing_state='reserved'`, clamping drift past a grace window.
**Migration risk:** new SQL function; no table change. **Rollback:** drop the function, revert the handler.
**Closure test:** force `insertSmsLog` to return `null`; assert `reserved_sms_credits` returns to its pre-send value. Run the new sweeper arm in **report-only mode first** against production — it will surface any drift already accrued.

### T1-4 · Harden the ledger's append-only posture → closes **V3-06**
**Deps:** none. **Mechanism:** `REVOKE UPDATE, DELETE ON sms_credit_ledger FROM app_tenant`. The immutability trigger already blocks these; the grants are a redundant second door. Belt and braces, one line.
**Migration risk:** nil — confirmed no code path performs either operation (they would already be raising `42501`).
**Closure test:** as `app_tenant`, assert `UPDATE`/`DELETE` on the ledger fail with a **permission** error rather than reaching the trigger.

### T1-5 · Fix numeric scale before building reconciliation → closes **G18**, unblocks **T1-6**
**Deps:** none, but **must precede T1-6** or the new job alerts on every payer from day one.
**Mechanism:** round once at source — compute credits to the balance column's own 2dp scale in `addSmsCredits` and write that single value to balance, lot, **and** ledger. Do not widen columns.
**Migration risk:** existing accrued drift must be absorbed by an explicit `adjustment` ledger entry — **never** an in-place edit of an append-only table.
**Closure test:** after N top-ups at a rate with a non-terminating reciprocal (0.90), assert `drift` and `lot_drift` in `vw_sms_credit_reconciliation` are **exactly 0**.

### T1-6 · Make reconciliation a control, not an artifact → closes **G16**, **G6**
**Deps:** T1-5. **Mechanism:** a daily `sms_credit_reconciliation` job modelled on the existing `gl_cash_reconciliation` handler (the pattern is already in the repo). Alert past tolerance; surface a drift table on `/admin/sms-pricing`. Extend the same job to flag any `sms_campaigns` row whose stored counters disagree with the `sms_usage_logs` aggregate — that is G6's structural fix.
**One-off alongside it:** backfill the single known-inverted campaign row (`sent_count=0/failed_count=8` vs real `8/0`).
**Closure test:** seed a known drift → job reports it; clean tenant → reports exactly zero; assert `count(*)` of campaigns whose counters disagree with their logs is 0 after backfill.

### T1-7 · Close the residual isolation gaps → closes **G29**, **G24**
**Deps:** none. **Mechanism:** thread the group scope into `getDlr`'s UPDATE statements (`AND ($2::uuid IS NULL OR group_id = $2)` — note the explicit cast, per this codebase's thrice-learned parameter-type lesson), and add a partial unique index on `sms_usage_logs (provider_msg_id)` so the uniqueness the code assumes is enforced. Re-gate `GET /sms/balance` (the **platform** provider float, not tenant credits) behind `super_admin`.
**Closure test:** two groups holding rows with the same `provider_msg_id` → a group-scoped `getDlr` updates only its own; `secretary`/`treasurer`/`chairperson` receive 403 from `/sms/balance`, `super_admin` 200.

---

## T2 — CORRECTNESS (days–weeks)

Behaviour that is wrong rather than unsafe.

### T2-1 · Timezone correctness and quiet hours → closes **H8(a)**, **INV-16**
**Deps:** none. **Mechanism:** derive scheduling hour/date in **Africa/Nairobi** rather than `getUTCHours()`/`getUTCDate()` (`lib/jobs/index.ts:29,31`), so a schedule authored as "08:00" means 08:00 EAT. Either honour `sms_schedules.timezone` in the due-check or drop the column — a decorative column is worse than none. Add a quiet-hours guard (no non-OTP sends 21:00–07:00 EAT) — currently no such control exists anywhere.
**Backward-compat:** **this shifts every existing schedule by 3 hours.** It is a deliberate, announced change, not a silent one. Kenya has no DST, so the shift is a constant.
**Closure test:** a schedule authored for 08:00 fires at 08:00 EAT (05:00 UTC); a send attempted at 23:00 EAT is deferred, not dropped; OTP is exempt.

### T2-2 · Catch-up must not burst → closes **V3-02**
**Deps:** T2-1. **Mechanism:** when advancing `next_run_at`, if the computed next occurrence is still in the past (post-outage), fast-forward to the next **future** occurrence and record the skip, rather than firing once per missed period. Reminders are periodic notifications, not a queue to drain — a member should not receive five identical reminders after a five-day outage.
**Rollback:** revert to `occurrence + INTERVAL`. **Closure test:** a daily schedule with `next_run_at` 5 days stale fires **once**, advances to tomorrow, and logs 4 skipped occurrences.

### T2-3 · Unify segment counting → closes **G5**, **V3-01**
**Deps:** T1-6 (so the revenue impact can be measured before repricing). **This is a price change, not a bug fix — sequence it deliberately.**
**Mechanism:** one module, `lib/sms/segments.ts`, exporting `countSegments(body) → { encoding, segments }` (GSM-7 160/153, UCS-2 70/67, extended-GSM escapes counting double). **The same function must feed both the UI estimate and the billing reservation** — a single counter is the whole point, since today there are two and both are wrong. Reserve/consume `sum(segments)`; persist `sms_usage_logs.segments`.
**Migration risk:** `ADD COLUMN segments SMALLINT NOT NULL DEFAULT 1` is additive and safe. **The trap:** `settle_sms_credit_reservation` currently derives the allowance decrement from a **row count** while `reserve_sms_credits` increments it by a **message count** — these agree today only because `credits_from_allowance` is always 0 or 1. Multi-segment rows break the identity; **both sides must change together** or allowance reservations strand. Both functions are `CREATE OR REPLACE` SECURITY DEFINER — **the migration MUST re-apply `REVOKE ALL … FROM PUBLIC, anon, authenticated`**, the exposure pattern this codebase has re-opened twice.
**Backward-compat:** historical rows keep `segments = 1` — correct, that is what was charged. **Do not backfill.** Land the UI counter first, communicate, then flip billing.
**Closure test:** table-driven unit tests at 160/161, 306/307, 70/71 and the escape set (`€ { } [ ] ~ ^ | \`); integration test — a 200-char body to 3 recipients reserves and consumes **6**, not 3; UI estimate and billed amount are computed by the **same** function and cannot disagree.

### T2-4 · Tighten phone validation → closes **V3-03**
**Deps:** none. **Mechanism:** narrow the `0`+10-digit rule to Kenyan **mobile** prefixes (`07…`, `01…`) so landlines (`020…`, `041…`, `051…`) are rejected at the boundary instead of being reserved, dispatched, failed and retried. Make the `null`/non-string input throw the documented `Error` rather than a `TypeError`.
**Backward-compat:** check for already-stored landline numbers before enforcing, or member records with one become unsaveable on next edit.
**Closure test:** the H9 table in the findings doc becomes an executable test — `020 1234567` and `+254 (0)722123456` rejected, all six valid mobile formats accepted and normalizing to one identical string, `null` throwing `Error`.

### T2-5 · Consent, opt-out reachability, and retention → closes **G20**, **INV-09**, **V3-04** (all three DPA-floor HIGH)
**Deps:** none for the first two sub-items.
**Mechanism:**
1. **Officer-managed opt-out list** in group SMS settings (view/add/remove). Immediate, unblocks the human workflow, restores a capability the architecture lost. `sms_group_settings` has **0 production rows** — nobody can currently record an opt-out at all.
2. **Consent record:** replace the `text[]` with a real `sms_opt_outs (group_id, phone, opted_out_at, source, actor_id)` table — the array cannot carry timestamp, source, or actor, which is precisely what a DPA audit asks for. Keep the array trigger-synced during transition; four read sites migrate.
3. **Inbound STOP** — gated on the INSUFFICIENT-EVIDENCE question of whether TextSMS supports two-way SMS. If yes, this is the real fix and closes the gap structurally; if no, document that the officer list is the compensating control.
4. **Retention:** a purge job for `sms_usage_logs.message_text` past a defined window (retain the metadata row for billing/audit, null the body). Indefinite retention of message content is the DPA exposure, not the log row itself.
**Closure test:** an opt-out recorded through **any** entry point suppresses across all four send paths and **costs no credit**; a `message_text` older than the retention window is null while its billing row survives; a DSAR for one member can be answered from the product.

### T2-6 · Make automations opt-in and visible → closes **G8**, **G11**, **G12**
**Deps:** none. **Requires a product decision before coding** (see Backward-compat).
**Mechanism:** add `sms_group_settings.auto_send_welcome BOOLEAN NOT NULL DEFAULT false` and gate the `member_welcome` rule on it, mirroring `auto_send_birthday` — the codebase already states this principle for the sibling feature. Fix the idempotency key to the **membership** (`group_members.id`), not the member. Move the SMS rate-limit check from the three routes into the spend primitive so every trigger path inherits it.
**Backward-compat — the decision:** defaulting to `false` **turns welcome SMS off for every group currently receiving it**. The alternative is backfilling `true` only for groups that have customised a `welcome` template (one such group exists). Either is defensible; **choosing silently is not**. Separately, changing the idempotency key gives already-welcomed members a **second** welcome for their first group unless existing rows are backfilled to membership ids first.
**Closure test:** member added to a group with the flag off → no SMS, no credit; member M joining a **second** group → a distinct execution row and a real second SMS; 300 rapid member-creates → rate-limited, not 300 messages.

---

## T3 — STRUCTURAL (weeks)

### T3-1 · DLR throughput and fairness → closes **G3**
**Deps:** T1-1. **Mechanism:** raise `pollPendingDlrs`' limit in step with the budget PR #126 already raised (15 → ~100; the current value's own comment cites the *old* 7s budget as its justification and is now actively misleading — update it). Add `sms_delivery_reports.poll_count` and order **least-recently-polled first with exponential backoff**, so a handful of never-reportable messages cannot monopolise every slot. Mark messages terminally-unknown past ~48h so they stop consuming budget.
**Migration risk:** additive column, default 0. **Closure test:** seed 20 `sent` messages, stub the provider to answer `"No dlr"` for the 15 oldest and `"DeliveredToTerminal"` for the 5 newest; run the poller twice; assert the newest 5 reach `delivered` — **today they never would**. Then assert the live count of rows stuck `sent` >7 days trends to 0 (baseline: 175 of 353).
**Structural alternative:** if TextSMS supports DLR webhooks (INSUFFICIENT-EVIDENCE), `sms_poll_dlr` can be **deleted outright**, removing the largest single source of job-queue pressure. Resolve that question before investing in the polling rewrite.

### T3-2 · Partial-batch integrity → closes **G4**
**Deps:** none. **Mechanism:** `sendBulkSmsChunked` must return partial results (`{ responses, sent, failed, chunkErrors }`) instead of rethrowing and discarding chunks the provider already accepted and billed. Synthesize failure entries only for the chunk that actually failed, so `alignBulkResponses` maps by `clientSmsId` correctly.
**Backward-compat:** `BulkSmsResult` gains an optional field; existing consumers unaffected. Behaviour differs only on the multi-chunk-partial-failure path, which is currently wrong.
**Closure test:** stub chunk 0 success / chunk 1 rejection across 150 items → assert 100 rows end `sent`/`consumed` with **no** `sms_failures` rows, and only the true 50 are `failed`/`released`.

### T3-3 · Provider abstraction and outage posture → closes **G15/V3-07**, **INV-17**
**Deps:** T3-2. **Mechanism:** extract a provider interface; move the 12 hardcoded `'textsms'` literals behind it; honour `sms_usage_logs.provider` on retry so a message retries on the provider that accepted it. Add a circuit breaker (consecutive-failure counter, fail-fast while open, half-open probe) and gate `retryFailures` on provider health — during an outage the queue currently does maximum work at maximum latency for guaranteed-zero delivery. **Model it on `lib/email/provider`'s existing `sendEmailWithFallback`** — the pattern is already in this repo and does not need inventing.
**Closure test:** N consecutive rejections open the circuit; a successful half-open probe closes it; **an outage does not exhaust a message's `max_retries` budget while the circuit is open**; adding a second provider requires changing only the adapter directory (re-run the H14 file count — it must drop to 1 directory).

### T3-4 · Observability → closes **G14**, and is what makes every future instance of this audit self-reporting
**Deps:** none, but lands best after T1 so there is something meaningful to alert on.
**Mechanism:** route `logger.error` to a real sink (Sentry is lowest-friction on this stack — currently **no** error-tracking SDK exists at all). Add an `sms_provider_health` job sampling recent failure rate and raising the same in-app+email staff notification the low-balance alert already uses (**never** via SMS). Emit job-queue depth and oldest-pending age per tick. Extend `/status` with provider reachability and queue depth.
**Closure test:** simulate 100% provider failure → **exactly one** alert raised, not one per message, and never over SMS. *Reference case: the 401 outage that corrupted 8 welcome executions was found by a human reading the database days later — that must page instead.*

### T3-5 · Operational surfaces → closes **G21**, **G22**, **G28**, **G26**, **G27**, **G30**
**Deps:** T2-5 (suppression events must exist before they can be displayed).
**Mechanism:** a group-scoped reminder/automation history endpoint over `reminder_dispatch_log` **including suppressed outcomes** (verify an RLS policy exists before exposing — the table is currently admin-pool-only); a manual retry action on failed messages reusing `retryFailures`' safe path (must not re-bill, must honour opt-out); a recipient-count and credit-cost preview before any bulk send, with a confirmation step above a threshold; a member-level send cooldown so the day-1-of-month duplicate cannot recur; `ON CONFLICT (payment_id) DO NOTHING` + unique index on the org top-up **before** any callback-driven org path ships; thread `package_id` through top-ups or retire the misleading "revenue by package" report; correct the stale `organization_sms_credits` comment.
**Closure test:** a DSAR for one member is answerable from the UI; a manual retry of an opted-out number resolves `suppressed` and bills nothing; two `sendOnce` calls for one member across different stages inside the cooldown → the second returns `cooldown`, no provider call, no charge.

---

## Sequencing summary

```
T0 (hours)    G1 → CI → G13 → G9/G10 → kill switch → daily cap
T1 (days)     G2 → G7 → G19 → ledger grants → G18 → G16/G6 → G29/G24
T2 (days-wks) timezone → catch-up → SEGMENTS (price change) → phone → CONSENT/DPA → automations
T3 (weeks)    DLR throughput → partial-batch → provider abstraction → observability → ops surfaces
```

**Two items gate on answers this audit could not obtain** (see findings §5): T1-1 branches on the Vercel plan tier, and T3-1's structural option plus T2-5's STOP handling both depend on what TextSMS supports for two-way SMS and DLR webhooks. **Ask the provider before building either** — a webhook answer deletes an entire job type.

**One item is a business decision, not an engineering one:** T2-3 (segment billing) changes what customers pay. It is sequenced after T1-6 deliberately so the real exposure can be measured before anyone commits to a repricing.

**Superseded documents:** none are recommended for deletion. `SMS_SYSTEM_AUDIT_2026-08-31.md` remains the narrative companion to this register (its G-IDs are load-bearing here); the 2026-08-06 and 2026-08-20 audits remain the historical record of fixes whose non-regression §2 of the findings doc verifies.
