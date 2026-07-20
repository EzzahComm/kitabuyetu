# B2C Disbursement Architecture — Production-Readiness Audit

**Subject:** Kitabu Yetu Business-to-Customer (money-out) payment module
**Scope:** B2C payout initiation, Daraja integration, callbacks, ledger posting, reconciliation
**Method:** Source-grounded static audit (no code modified)
**Verdict:** **Not production-ready** for real-money disbursement
**Production-readiness score:** **34 / 100**

> Findings cite `lib/services/mpesa.service.ts`, `lib/services/daraja.service.ts`,
> `lib/services/organization-finance.service.ts`, `app/api/v1/mpesa/b2c/route.ts`, and
> `supabase/migrations/*`.

**Severity tally:** 5 Critical · 6 High · 6 Medium · 3 Low

---

## 1. Executive Summary

Kitabu Yetu has **two disbursement code paths, and they are not the same path** — this is the
audit's central finding.

**Path A — the real payout.** `POST /api/v1/mpesa/b2c` → `initiateB2C()` → Daraja
`/mpesa/b2c/v1/paymentrequest`. This is the only code that actually sends money to a phone. It
requires the `treasurer` role plus a fresh auth token (`assertAuthFresh`), then fires the payment
**immediately**. It does **not** read any wallet balance, does **not** check a limit, does **not**
require a second approver, and writes **no ledger entry** until (and only if) a success callback
arrives.

**Path B — the controlled ledger move.** `organizationFinanceService.disburse()` locks the
organization wallet, enforces available balance, checks the funding-program budget, verifies the
group→org link, and posts a balanced double-entry journal. It is well built. It also **never
contacts Safaricom** — no shilling leaves M-Pesa; it moves numbers between an org wallet and a
group's books.

The consequence: every safeguard a regulator expects — balance enforcement, budget ceilings,
maker-checker, idempotency — sits on Path B, while the money leaves on Path A. Bridging the two,
and adding the outbound reconciliation neither path has, is the core of the work ahead.

The base is genuinely solid: a real double-entry ledger, callback-level idempotency via database
uniqueness, cached-and-retried Daraja OAuth, an encrypted `SecurityCredential`, and raw-callback
audit logging. **This is a controls-completion effort, not a rewrite** — but the missing controls
are exactly the ones that separate a demo from a licensed payout system.

---

## 2. Architecture Assessment

Serverless, callback-driven, single shared float.

- **Boundaries.** Daraja I/O is cleanly isolated in `daraja.service.ts`; domain effects live in
  `mpesa.service.ts`. Good separation — but **no orchestration layer** sequences
  *reserve → send → confirm → settle*, so state can diverge between "money sent" and "books updated".
- **Queueing.** Daraja's own async queue (Queue/Result URLs) is used, but there is **no internal
  outbox or job for outbound payments**. `event_outbox` and DLQ replay exist for *inbound* C2B/STK only.
- **Idempotency.** Strong at the callback layer (unique `originator_conversation_id`,
  `mpesa_receipt_number`, `FOR UPDATE`). **Absent at initiation** — the send has no idempotency key.
- **Failure recovery.** Inbound STK has a reconciliation job that fires `STK Query` on stuck rows.
  Outbound B2C has **no equivalent** — a dropped result callback strands the payment in `initiated`
  forever with its true state unknown.
- **Multi-tenant isolation & float.** All groups disburse from one platform B2C shortcode
  (`MPESA_B2C_SHORTCODE`). **No per-group float segregation and no per-group balance gate**, so one
  group's payouts draw down the shared float that funds every other group.
- **Scale / HA.** Stateless functions scale horizontally; OAuth is shared via Redis. The ungated
  shared float and the lack of outbound reconciliation are what break first under real volume — not compute.

---

## 3. End-to-End B2C Flow (stage map)

Legend: ✅ implemented & sound · ⚠️ present but weak · ❌ missing control on the real-money path

| Stage | State | Detail |
| --- | --- | --- |
| Initiate | ✅ | Treasurer POST, role + `assertAuthFresh` epoch check |
| Balance / float check | ❌ | None before Daraja call |
| Limits | ❌ | No per-txn / daily / monthly / velocity |
| Approval | ❌ | No maker-checker |
| Reserve funds | ❌ | No hold / earmark |
| Daraja call | ✅ | OAuth cache, retry/backoff, E.164, integer shillings |
| Persist | ✅ | `mpesa_b2c_transactions`, unique conversation IDs |
| Callback auth | ⚠️ | IP advisory-only, no URL token/HMAC |
| Ledger post | ✅ | Balanced double-entry — **but only on success callback** |
| Notify | ❌ | No recipient / initiator alert |
| Reconcile (outbound) | ❌ | No Transaction Status sweep |
| Reversal | ⚠️ | Manual, not linked to lifecycle |
| Audit | ✅ | Raw callback + `failed_payment_logs` |
| DLQ / monitor | ❌ | None for outbound |
| Reporting | ❌ | No outbound B2C reports |

---

## 4. Current Strengths

- **Double-entry ledger** — disbursement journals post balanced DR/CR lines (loans receivable /
  cash / charges) with source-document attribution.
- **Callback idempotency** — unique `originator_conversation_id` + `mpesa_receipt_number` +
  `FOR UPDATE` make a replayed result callback a safe no-op.
- **Daraja client hygiene** — OAuth cached in Redis + memory, exponential backoff on 5xx/429,
  amounts coerced to integer shillings, phones normalised to E.164.
- **Encrypted credentials** — `SecurityCredential` generated from the Safaricom cert, not stored
  in plaintext; Daraja keys from env secrets.
- **Fee accounting** — Safaricom B2C fees looked up from a seeded tier table
  (`mpesa_charge_for_amount`) and posted as their own charge journal + `mpesa_charges` row, unique
  per transaction.
- **Controlled wallet path** — `organizationFinanceService.disburse()` already does atomic balance
  locking + budget-ceiling enforcement: a ready-made template for Path A's controls.

---

## 5. Critical Gaps (go-live blockers)

### C1 — No balance or float check before payout · Critical · Major refactor
`initiateB2C()` calls Daraja before reading any balance. Neither the platform M-Pesa float, the
group's cash account (1001), nor any wallet is consulted. Books can be driven negative and the
shared float overdrawn.
*Evidence:* `mpesa.service.ts` `initiateB2C` — no balance `SELECT` precedes `_b2c()`.

### C2 — No initiation idempotency → double disbursement · Critical · Medium
The payout POST carries **no idempotency key** (the STK-push route uses `withIdempotencyKey`; B2C
does not). A double-click, browser retry, or network re-send fires a second real payment — each
attempt mints a fresh `OriginatorConversationID`, so callback-layer uniqueness gives no protection.
The same `loanId` can also be paid by both `loans.disburse` (manual) and the B2C path.
*Evidence:* `app/api/v1/mpesa/b2c/route.ts` POST initiate branch — no idempotency guard.

### C3 — No maker-checker on outbound money · Critical · Large
A single `treasurer` initiates and completes a payout with no second approval. Payment
reallocations gained maker-checker in an earlier phase; disbursements — a larger loss vector — did
not. No approval table, threshold, or dual control exists for B2C.
*Evidence:* `withRole(req, 'treasurer', …)` is the only gate.

### C4 — Money path decoupled from wallet & budget controls · Critical · Major refactor
Wallet debit, insufficient-funds rejection, funding-program budget ceiling, and group-link
eligibility all live in `organizationFinanceService.disburse()`, which posts ledger entries but
**never calls Daraja**. The real B2C payout bypasses all of them. The two paths must become one.
*Evidence:* `organization-finance.service.ts` `disburse()` enforces balance + budget but issues no
M-Pesa request.

### C5 — No outbound reconciliation for stuck payments · Critical · Large
`runReconciliation()` only queries stale **STK** requests. A B2C row whose result callback is
dropped or delayed stays `initiated` indefinitely with no automated `Transaction Status Query` to
determine whether the money left. The true state of a real payment can remain permanently unknown.
*Evidence:* `runReconciliation()` selects from `mpesa_stk_requests` only; no B2C reconciliation job.

---

## 6. Security Findings

### H1 — Callback authenticity is advisory only · High · Medium
The Result/Timeout URLs carry no unguessable path token or HMAC. `assertSafaricomIp()` only **logs
a warning** on a non-Safaricom IP — it never rejects ("processing anyway"). Integrity leans on
matching a server-generated `OriginatorConversationID` + receipt uniqueness, which blocks blind
replay but not a crafted callback for a known conversation ID.
*Evidence:* `daraja.service.ts` `assertSafaricomIp`; B2C `ResultURL` has no secret token.

**Strong points:** outbound money POST behind role + `assertAuthFresh` epoch re-check; Daraja
secrets in env; `SecurityCredential` encrypted; proxy strips client-supplied claim headers.

**Gaps:** no dual control (C3); no signed callbacks (H1); raw callback bodies (recipient PII) stored
without stated retention; no payout-specific rate limit; certificate/credential rotation procedure
not evidenced in code.

---

## 7. Financial Integrity Findings

- **Post-hoc ledger (High).** The journal is written only inside the *success* callback. If the
  callback is dropped (C5), the money can be gone with no ledger entry — a true off-book payment.
- **No reservation / committed balance (High).** `organization_wallets.committed_balance` exists but
  the payout path never reserves into it. Concurrent payouts can each pass a (non-existent) balance
  check and collectively overspend.
- **Cash can go negative (Medium).** The disbursement journal credits cash 1001 with no guard that
  1001 holds the funds — the books can represent an impossible negative float.
- **Loan double-post guard is partial (Medium).** `applyLoanDisbursement` is idempotent on
  `status='approved'`, but the real payment is not gated by loan status at all — a rejected or
  already-disbursed loan can still trigger a live payout with no journal (F11).

---

## 8. Daraja Integration Findings

**Done well:** OAuth caching, retry/backoff, integer amounts, E.164 phones, Queue + Result URLs
wired, encrypted `SecurityCredential`, production/sandbox host switch, `is_test` tagging.

**Missing / weak:** no `Transaction Status Query` recovery for B2C (C5); timeout callback parsed by
the same success/fail handler despite a different body shape (F18); no certificate-rotation path;
callback origin unverified (H1); no circuit-breaker distinct from the generic 3-try backoff.

---

## 9. Database Findings

- **Good:** `mpesa_b2c_transactions` has unique constraints on both conversation IDs and the receipt,
  an index on the originator ID; `failed_payment_logs` + `mpesa_callbacks` capture raw payloads.
- **Missing:** no disbursement-approval table; no payout-reservation/hold table; no outbound
  dead-letter or retry-log table; no per-group float ledger. No partitioning/archival for the
  high-growth `mpesa_callbacks` / `payments` tables ahead of "millions annually".

---

## 10. Approval Workflow Findings

| Capability | State | Note |
| --- | --- | --- |
| Single approval | Partial | Treasurer role gates initiation; it is also the execution |
| Maker-checker | **Absent** | No second approver on B2C |
| Threshold / tiered approval | **Absent** | No amount-based escalation |
| Approval expiry / revocation | **Absent** | No approval object exists |
| Loan approve → disburse | Present | Exists for loans, but B2C payout is not bound to it (F11) |
| Reallocation maker-checker | Present | Proof the pattern is already in the codebase — reuse it |

---

## 11. Ledger & Reconciliation Findings

- Inbound STK/C2B: stale-row status queries + nightly charge backfill + daily report exist.
- Outbound B2C: **no** Safaricom-statement diff, **no** status-query sweep, **no** float
  reconciliation. The account-balance snapshot job records a balance but never gates or reconciles
  against payouts.
- **Required:** a daily three-way tie-out — internal ledger ↔ `mpesa_b2c_transactions` ↔ Safaricom
  B2C statement — with a one-sided-entry alert, mirroring the inbound reconciliation already in place.

---

## 12. Fraud & Abuse Risks

A codebase grep returns **zero** limit or velocity logic. For an outbound money rail this is the
exposure that scales fastest with volume.

- No per-transaction, daily, monthly, per-member, or per-group ceilings (F6).
- No recipient validation beyond phone format — the payee need not be a member; no
  frozen/blacklisted/eligibility check runs (F7).
- No velocity, round-number, dormant-activation, new-recipient, or geo-anomaly signals; no risk
  score gates a payout.
- **Insider vector wide open:** with no maker-checker and no limits, one compromised or malicious
  treasurer credential can drain the shared float in a rapid sequence of payouts.

---

## 13. Operational Readiness Assessment

**Present:** cron-driven jobs, inbound orphan monitor, callback audit log, daily M-Pesa report,
balance snapshot, structured logging.

**Absent for outbound:** stuck-payout monitor, DLQ, float-low alert, payout dashboard, runbook for
"money left but no callback", reversal-trigger tooling, DR drill for the payout path.

---

## 14. Compliance Assessment

| Area | Status | Gap |
| --- | --- | --- |
| Dual control (CBK DFS) | **Fail** | No maker-checker on payouts |
| Transaction limits (AML) | **Fail** | No ceilings or velocity monitoring |
| Recipient KYC | Weak | Arbitrary phone; no identity binding on payee |
| Audit retention | Unclear | Raw callbacks stored; retention/immutability not stated |
| Data protection (DPA 2019) | Partial | PII in raw logs; consent & minimisation not evidenced |
| Reconciliation of client funds | **Fail** | No outbound float reconciliation |

---

## 15. Scalability Assessment

- **Fine to mid-scale:** stateless functions, shared OAuth, indexed lookups by conversation ID.
- **Breaks first:** the single shared float with no per-tenant segregation or gate (contention +
  blast radius); absence of outbound reconciliation (manual recovery cost grows with dropped callbacks).
- **Ahead of "millions annually":** partition/archive `mpesa_callbacks` and `payments`; add a
  bulk/batch payout worker with concurrency control; move outbound events onto the existing outbox
  once a second consumer appears.

---

## 16. Prioritised Hardening Roadmap

### First 30 days — go-live blockers ("make the payout safe")
1. Unify Path A + Path B: reserve funds and check balance **before** calling Daraja (C1, C4).
2. Idempotency key on the payout POST; bind loan payouts to `status='approved'` (C2, F11).
3. Maker-checker + amount threshold for B2C, reusing the reallocation pattern (C3).
4. Outbound reconciliation job: `Transaction Status Query` sweep of stale `initiated` rows (C5).
5. Reject non-Safaricom callbacks via a signed Result-URL token (H1).

### Days 31–60 — controls & limits ("contain the blast radius")
6. Per-transaction / daily / monthly / velocity limits at member, group, and org tiers (F6).
7. Recipient eligibility: membership, frozen/blacklist, KYC binding (F7).
8. Per-group float segregation or a gated shared-float ledger (F9).
9. Disbursement notifications to recipient + initiator; failure alerts (F10).
10. Full B2C state machine incl. `timed_out`, `reversed`, `reconciled` (F12).

### Days 61–90 — scale & assurance ("operate & prove it")
11. Outbound DLQ + stuck-payout monitor + float-low alerting (F13).
12. Daily three-way float reconciliation vs Safaricom statement (§11).
13. Fraud scoring on payouts; auto-reversal tooling wired to lifecycle (F14, F16).
14. Table partitioning/archival; batch payout worker (§15).
15. Compliance pack: retention policy, DPA minimisation, audit immutability (§14).

---

## 17. Recommended Target Architecture

**One orchestrated, reservation-based payout spine** — collapse the two paths into a single state
machine that reserves before it sends and reconciles what it cannot confirm.

```
REQUEST (validated · limit-checked · eligibility-checked)
  → APPROVE (maker-checker over threshold)
  → RESERVE (atomic hold on float / wallet)
  → DISPATCH (idempotency-keyed Daraja call)
  → PENDING (outbox event · status-query timer)
  → CONFIRM (signed callback · settle reservation → ledger)
  → RECONCILE (daily 3-way float tie-out)
  → NOTIFY (recipient + initiator + audit)
```

- A dedicated `disbursements` aggregate as the single source of truth, states:
  `draft → pending_approval → approved → reserved → dispatched → pending → completed | failed | timed_out → reconciled → reversed`.
- Reservation-based accounting: hold on request, settle on confirm, release on fail — cash never
  goes negative.
- Transaction-status sweep as the safety net for every non-terminal row; reconciliation as ultimate
  arbiter.
- Per-tenant float sub-ledgers over the shared shortcode, so one group cannot spend another's funds.

---

## 18. Risk Matrix (Likelihood × Impact)

| Likelihood ↓ / Impact → | Moderate | Major | Severe |
| --- | --- | --- | --- |
| **Likely** | — | H1 | **C1, C2** |
| **Possible** | F18 | F6, F10 | **C3, C4, C5** |
| **Rare** | F19, F20 | F13, F15, F17 | F7, F9, F11, F12 |

---

## 19. Implementation Backlog

| ID | Task | Sev | Effort | Risk if unresolved |
| --- | --- | --- | --- | --- |
| C1 | Reserve + balance-check before Daraja call | Critical | Major | Overdrawn float; off-book payments |
| C2 | Idempotency key on payout initiation | Critical | Medium | Duplicate real payments |
| C3 | Maker-checker + threshold for B2C | Critical | Large | Insider / single-actor fraud |
| C4 | Unify money path with wallet/budget controls | Critical | Major | All controls bypassed |
| C5 | Outbound status-query reconciliation job | Critical | Large | Unknown payment state; manual loss |
| H1 | Signed Result-URL token; reject bad callbacks | High | Medium | Forged callback flips payment state |
| F6 | Tiered disbursement limits + velocity | High | Large | Rapid drain; AML failure |
| F7 | Recipient eligibility / KYC / blacklist | High | Medium | Payout to non-member / bad actor |
| F9 | Per-tenant float segregation | High | Large | Cross-group fund spend |
| F10 | Disbursement notifications | High | Small | Silent failures; disputes |
| F11 | Gate loan payout on approval status | High | Small | Payout on rejected/paid loan |
| F12 | Full B2C state machine | Medium | Medium | Ambiguous terminal states |
| F13 | Outbound DLQ + stuck-payout monitor | Medium | Medium | Slow incident detection |
| F14 | Reversal wired to lifecycle | Medium | Medium | Manual, error-prone refunds |
| F15 | PII retention / DPA minimisation | Medium | Medium | Regulatory exposure |
| F16 | Payout fraud scoring | Medium | Large | Undetected abuse patterns |
| F17 | Certificate / credential rotation | Medium | Small | Outage on cert expiry |
| F18 | Distinct timeout-callback handling | Low | Small | Misclassified timeouts |
| F19 | Surface silent remarks/occasion truncation | Low | Small | Confusing statements |
| F20 | Outbound B2C reporting surface | Low | Medium | No operator visibility |

---

## 20. Production Readiness Score & Verdict

**Score: 34 / 100.** A competent accounting and integration base (double-entry ledger, idempotent
callbacks, Daraja hygiene) held down by the absence of every control that gates the money itself.

**Verdict:** the B2C module is **not** suitable for production handling of real-money disbursements.
It is safe to keep running in **sandbox** and to build against. The blockers are specific and
closeable — this is a controls-completion effort on a sound base, not a rewrite.

**Go-live blockers (all five must close):**

- **C1** — Balance/float reservation before the Daraja call.
- **C2** — Idempotency on payout initiation (stop double-pay).
- **C3** — Maker-checker on outbound money.
- **C4** — Merge the real payout with the wallet/budget controls.
- **C5** — Outbound reconciliation so no payment's state is ever unknown.

Close these five and readiness moves into the **70s** — enough to launch a controlled pilot while
the 60- and 90-day limit, isolation, and assurance work lands. The target architecture in §17 is the
destination: one reservation-based, maker-checked, reconciled payout spine with per-tenant float
segregation, capable of the nationwide multi-tenant volume the platform is aiming for.

---

*Source-grounded audit. No code was modified to produce this report.*
