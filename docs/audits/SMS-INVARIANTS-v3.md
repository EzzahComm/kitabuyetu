# SMS-INVARIANTS-v3

**Status:** first formal invariant set for this subsystem. **Date:** 2026-08-31.
**Key words** MUST, MUST NOT, SHOULD, SHOULD NOT, MAY are to be interpreted per RFC 2119.

> **This document supersedes nothing.** The brief that commissioned it assumed a prior RFC 2119 invariant set existed. It does not — `docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md` and `docs/chama-reminder/CHAMA_REMINDER_ARCHITECTURE_INTEGRATION.md` contain **zero** MUST/SHOULD/SHALL occurrences, and no file in `docs/` matches RFC 2119 phrasing. Prior SMS documents are *audits* and *architecture narratives*, not invariant sets. This is v3 only because it accompanies the third audit.

**Enforcement legend** — `ENFORCED` requires a mechanism that a second code path or a direct database write **cannot bypass**. A comment, a TypeScript type, or a happy-path check is **not** enforcement. Database-level mechanisms outrank application-level ones and are marked **[DB]**.

---

## A. Billing and credit integrity

**INV-01 — Credit MUST be reserved before dispatch and settled after.**
No send path may debit on attempt. `ENFORCED` **[DB]** — `reserve_sms_credits` (SECURITY DEFINER) is the sole mutator of `reserved_sms_credits`; all five provider-client callers pass through it.

**INV-02 — One credit MUST equal one billable provider segment.**
`PARTIAL` — one credit currently equals one *recipient*, irrespective of length or encoding (`sms.service.ts:176`). The rate-vs-count half is correct (migration 144); the length half is not. → **G5**, pathway **T2-3**.

**INV-03 — A single counter MUST serve both the quoted estimate and the billed amount.**
`NOT-ENFORCED` — two independent counters exist and both are wrong: the UI divides by 160 with no encoding detection (`components/sms/tabs.tsx:122-123`), billing charges a flat 1. → **V3-01**, **T2-3**.

**INV-04 — A group without an active subscription MUST NOT reserve credit.**
`ENFORCED` **[DB]** — `reserve_sms_credits` raises `42501` before taking any lock.

**INV-05 — A reservation MUST NOT succeed when available paid credit is insufficient.**
`ENFORCED` **[DB]** — raises `22003` under the row lock.

**INV-06 — Concurrent sends MUST NOT overdraw a balance.**
`ENFORCED` **[DB]** — `SELECT … FOR UPDATE` on `billing_accounts` / `organization_billing_accounts` precedes the availability check and the update, inside one function, inside a caller transaction. Verified H3.

**INV-07 — `sms_credit_ledger` MUST be append-only.**
`ENFORCED` **[DB]** — trigger `sms_ledger_no_update` (BEFORE DELETE OR UPDATE) raises `42501` unconditionally. *Caveat:* `app_tenant` still holds redundant UPDATE/DELETE grants; the trigger is the only barrier. → **V3-06**, **T1-4**.

**INV-08 — Balance MUST reconcile against the ledger, and the reconciliation MUST be exercised.**
`DOC-ONLY` — `vw_sms_credit_reconciliation` computes drift correctly and has **zero consumers**. An instrument with no reader is not a control. → **G16**, **T1-6**.

**INV-09 — Ledger, balance, and lot MUST share one numeric scale.**
`NOT-ENFORCED` — `NUMERIC(14,4)` vs `NUMERIC(15,2)`; every top-up injects same-sign drift, so reconciliation can never read exactly zero. → **G18**, **T1-5**.

**INV-10 — A reservation MUST NOT outlive its message.**
`PARTIAL` — the stale-reservation sweeper is the crash backstop, but it scans only `sms_usage_logs`, so a reservation taken without a ticket row is invisible to it forever. → **G19**, **T1-3**.

**INV-11 — A failed or rejected send MUST release its reservation.**
`ENFORCED` — every dispatch catch path releases; verified across provider 4xx/5xx/timeout.

**INV-12 — Displayed campaign counters MUST agree with the message log.**
`PARTIAL` — correct going forward (`syncCampaignCompletion`), no retroactive path; one live campaign still reads `0 sent / 8 failed` against a real `8 sent / 0 failed`. → **G6**, **T1-6**.

---

## B. Delivery and idempotency

**INV-13 — A retried job MUST NOT re-bill or re-send an already-dispatched recipient.**
`PARTIAL` — enforced in `sendBulkCampaign` by correlation-id exclusion; **absent** in `smsService.send`; two uncoordinated retry owners exist. → **G7**, **T1-2** (proposes a partial unique index so this becomes **[DB]**).

**INV-14 — Every dispatch MUST carry an idempotency key that survives process restart.**
`NOT-ENFORCED` — no key is sent to the provider; internal dedup is by convention, not constraint. → **T1-2**.

**INV-15 — A bulk send above the chunk threshold MUST fan out and deliver.**
`NOT-ENFORCED` — a non-UUID key is written to a `uuid` column; every such send fails, writes zero rows, and reports success to the caller. → **G1 (CRITICAL)**, **T0-1**.

**INV-16 — A partially-accepted batch MUST preserve the accepted portion.**
`NOT-ENFORCED` — a mid-batch chunk failure discards already-accepted, already-provider-billed responses and schedules the whole batch for retry. → **G4**, **T3-2**.

**INV-17 — Every sent message MUST reach a terminal delivery state.**
`NOT-ENFORCED` — 175 of 353 lifetime messages (≈50%) are stuck `sent`, oldest 2026-07-01; the poll budget (15/tick) is below arrival rate and messages age out of the 7-day window unchecked. → **G3**, **T3-1**.

**INV-18 — A trigger execution marked `sent` MUST have had at least one non-failed dispatch.**
`ENFORCED` — PR #124 guard. Load-bearing, because `sms_trigger_executions` is append-only and a wrong terminal status is unrecoverable.

**INV-19 — A scheduled occurrence MUST NOT be claimed by two workers.**
`ENFORCED` **[DB]** — `FOR UPDATE SKIP LOCKED`, with claim and enqueue in one transaction.

**INV-20 — A scheduled occurrence MUST NOT fire more than once per period, including after downtime.**
`NOT-ENFORCED` — `next_run_at` advances from the previous occurrence, so a multi-day outage produces a burst of identical messages. → **V3-02**, **T2-2**.

---

## C. Consent and data protection (Kenya DPA 2019)

**INV-21 — An opt-out MUST suppress delivery on every send path, before any charge.**
`ENFORCED` — checked on all paths; `notifications.service.ts:168` runs it **before** reservation and returns a distinct `suppressed` outcome. One of the best-built parts of the subsystem.

**INV-22 — Opt-out matching MUST be insensitive to phone formatting.**
`ENFORCED` — comparison is against `normalizePhone` output on every path; no divergent normalizer exists.

**INV-23 — Every recipient MUST have a reachable way to opt out.**
`NOT-ENFORCED` — self-service requires an authenticated app session; there is no STOP handling and no officer-managed list. `sms_group_settings` has **0 rows in production** — no opt-out has ever been recorded. → **G20**, **T2-5**.

**INV-24 — Consent MUST be recorded with timestamp, source, and actor.**
`NOT-ENFORCED` — no consent record of any kind exists; only a negative `text[]`, which structurally cannot carry those fields. → **INV-09 (findings)**, **T2-5**.

**INV-25 — Message bodies and MSISDNs MUST NOT reach logs or client error payloads.**
`ENFORCED` — SMS-subsystem logging carries counts and rule names only; no error-tracking SDK is configured, so no third-party exfiltration path exists. *Separate credential leak tracked as G13.*

**INV-26 — Personal data MUST have a retention limit.**
`NOT-ENFORCED` — `sms_usage_logs` retains `message_text` and `recipient_phone` indefinitely; no purge job or migration exists. → **V3-04**, **T2-5**.

**INV-27 — A data-subject access request MUST be answerable from the product.**
`NOT-ENFORCED` — `reminder_dispatch_log` has no read surface; suppression events are invisible. → **G21**, **T3-5**.

**INV-28 — A billed automation MUST be opt-in per group.**
`PARTIAL` — honoured for birthday SMS (DEFAULT false, with an explicit in-code rationale); violated by welcome SMS, which is a global rule billing all 8 groups with no toggle and no UI. → **G8**, **T2-6**.

---

## D. Tenancy and security

**INV-29 — Every `sms_*` table MUST enforce tenant isolation.**
`ENFORCED` **[DB]** — RLS enabled on all; forced on four; policies verified live against production.

**INV-30 — SMS RPCs MUST NOT be executable by `anon` or `authenticated`.**
`ENFORCED` **[DB]** — verified live for all four SECURITY DEFINER functions. **Any migration using `CREATE OR REPLACE` on these MUST re-apply the REVOKE** — this exposure has been re-opened twice by exactly that omission.

**INV-31 — Admin-pool queries MUST carry an explicit tenant predicate.**
`PARTIAL` — every tenant-facing route does; `getDlr`'s UPDATE does not, though its preceding ownership check does. → **G29**, **T1-7**.

**INV-32 — Tenant surfaces MUST NOT expose platform-level financials.**
`NOT-ENFORCED` — `GET /sms/balance` returns the platform's own provider float to all three officer roles. → **G24**, **T1-7**.

**INV-33 — Provider credentials MUST NOT reach any log sink.**
`NOT-ENFORCED` — a nested axios error serializes `config`, carrying `apikey`, whenever a DLR poll errors. → **G13**, **T0-3**.

**INV-34 — Every credit-spending path MUST pass a rate limit.**
`NOT-ENFORCED` — the limiter is attached to three HTTP routes, not to the spend primitive, so the trigger/automation path bypasses it entirely. → **G12**, **T2-6**.

**INV-35 — Recipient input MUST be validated and bounded on every surface.**
`NOT-ENFORCED` — `/sms/send` accepts an unbounded array; campaign `rawRecipients` is `z.record(z.unknown())` with no format check or cap. → **G9**, **G10**, **T0-4**.

**INV-36 — A phone number accepted as an SMS destination MUST be a valid Kenyan mobile MSISDN.**
`PARTIAL` — normalization is consistent and single-sited (good), but the `0`+10-digit rule admits landlines, which then reserve, dispatch, fail, and retry. → **V3-03**, **T2-4**.

---

## E. Operability

**INV-37 — There MUST be a way to halt all SMS without a redeploy.**
`NOT-ENFORCED` — no kill switch of any kind exists. → **V3-05**, **T0-5**.

**INV-38 — There MUST be a per-tenant spend ceiling.**
`DOC-ONLY` — `daily_send_limit` is returned to clients and read by no send path, and cannot even be set through the API. → **G25**, **T0-6**.

**INV-39 — Sustained provider failure MUST raise an alert.**
`NOT-ENFORCED` — no alerting sink exists. The reference incident (every send returning 401, corrupting 8 welcome executions permanently) was found by a human reading the database days later. → **G14**, **T3-4**.

**INV-40 — The job worker's time budget MUST be provably below the function ceiling, including the longest single job.**
`NOT-ENFORCED` — `maxDuration = 60` against a 50s budget leaves ~10s, below the worst case of three SMS job types. → **G2**, **T1-1**.

**INV-41 — Scheduling MUST be expressed in Africa/Nairobi.**
`NOT-ENFORCED` — hour/date derive from `getUTCHours()`/`getUTCDate()`, so every schedule fires 3 hours late in local terms; `sms_schedules.timezone` is written and never read. → **H8(a)**, **INV-16 (findings)**, **T2-1**.

**INV-42 — Non-urgent SMS SHOULD NOT be delivered during quiet hours (21:00–07:00 EAT).**
`NOT-ENFORCED` — no quiet-hours control exists anywhere. → **T2-1**.

**INV-43 — The provider MUST be replaceable without touching business logic.**
`NOT-ENFORCED` — `'textsms'` is hardcoded in ≥12 sites across 6 files including pricing and margin logic; the `provider` column is written as a literal and never read for routing. → **G15/V3-07**, **T3-3**.

---

## Scorecard

| Status | Count | Of which **[DB]**-enforced |
|---|---|---|
| ENFORCED | 13 | 9 |
| PARTIAL | 8 | — |
| DOC-ONLY | 2 | — |
| NOT-ENFORCED | 20 | — |
| **Total** | **43** | |

**Reading of this scorecard.** Nine of the thirteen enforced invariants are enforced by PostgreSQL — locks, triggers, CHECK constraints, RLS policies, and function-level privilege. That is the subsystem's real strength and the reason the money core survived three audits without a loss event: where this codebase pushes correctness into the database, it holds.

Every one of the twenty NOT-ENFORCED invariants is a place where correctness was left in application code, in a comment, in a column nobody reads, or nowhere at all. **The pathway's ordering principle follows directly: prefer a constraint, a trigger, a lock, or a revoke over a code change wherever one will close the gap.**

---

## Naming convention (establishing, not preserving)

The commissioning brief mandated preserving a distinction between **"Account Credit"** (money) and **"SMS balance"** (sends). **"Account Credit" appears nowhere in this codebase** — zero occurrences across all source and SQL. The distinction it describes is nonetheless real and worth having, because conflating the two units caused a live revenue leak (migration 144) that took months to surface.

The vocabulary that actually exists, and which new work SHOULD use consistently:

| Concept | Canonical name | Unit | Where it lives |
|---|---|---|---|
| Money paid by a tenant | **purchase / top-up** | KES | `sms_credits.amount_paid`, `organization_sms_credits.amount_paid` |
| Spendable send capacity | **SMS credits** | **messages** (see INV-02) | `billing_accounts.sms_credits` |
| Earmarked capacity | **reserved SMS credits** | messages | `billing_accounts.reserved_sms_credits` |
| Bundled monthly grant | **SMS allowance** | messages | `subscriptions.sms_allowance_included` |
| Immutable movement record | **SMS credit ledger** | messages | `sms_credit_ledger` |
| Platform's own float with TextSMS | **provider balance** | provider units | `sms_provider_balances` |

Anything introduced as "Account Credit" MUST be mapped onto one of the above rather than added as a seventh term. Note that `billing_accounts.sms_credits` is `NUMERIC` and *looks* like money while *meaning* messages — the single most dangerous naming artifact in the subsystem, and the reason INV-02 and INV-09 are worth enforcing at the database level rather than by convention.
