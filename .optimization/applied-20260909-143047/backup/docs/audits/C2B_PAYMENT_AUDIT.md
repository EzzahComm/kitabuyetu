# C2B Payment Architecture Audit — Kitabu Yetu

**Subject:** Customer-to-Business (money-in) payment module — PayBill, STK Push, C2B
validation/confirmation, payment resolution, ledger posting, reconciliation
**Scope:** Every inbound M-Pesa path: STK Push, direct PayBill, the membership-number
registry, the allocation engine, and their interaction with the B2C disbursement spine
and org dual-control shipped in this session (commit `d719b41`, not yet pushed)
**Method:** Source-grounded static audit. Every finding below was verified against the
current file contents in this session — not restated from memory of earlier work.
**Date:** 2026-07-15

> Findings cite `lib/services/mpesa.service.ts`, `lib/services/daraja.service.ts`,
> `lib/utils/allocation-engine.ts`, `lib/utils/membership-no.ts`,
> `lib/services/payment-requests.service.ts`, `lib/services/reallocations.service.ts`,
> `app/api/v1/mpesa/{c2b,stk-push,unrouted}/route.ts`, `lib/utils/idempotency.ts`,
> and `supabase/migrations/056-063,066-068`.

**Severity tally:** 0 Critical · 4 High · 6 Medium · 4 Low

---

## Executive Summary

C2B is the platform's most mature payment path — and it should be, since this is where
member money actually enters the system. Unlike the B2C audit (34/100, five Critical
blockers), C2B has **no Critical findings**: there is no equivalent of "the real payout
has no balance check." The registry-based routing, deterministic allocation engine
(A1–A9), payment spine, and reallocation maker-checker built earlier this session are
real, live in production, and collectively answer most of what an inbound-payment audit
looks for.

What remains are precise, verifiable gaps, not architectural flaws:

1. **Invoice payments never reach the registry at confirmation time.** The
   `payment_accounts` registry has a `kind='invoice'` row type and a trigger
   (`register_invoice_account`) that populates it — but
   `handleC2BConfirmation()`'s registry-first branch only proceeds for
   `kind IN ('membership_no', 'legacy_code')` (`mpesa.service.ts:1513`). A registry hit
   for an invoice is silently discarded, and the code falls through to the *old*
   `KYT-…` regex parser (`fulfilC2B`, same file, ~1718) to resolve invoices instead. The
   registry's invoice support is currently dead code on the confirmation path.
2. **STK Push idempotency is optional, client-supplied, and Redis-only.** Contrast
   with the disbursement spine just shipped: `withIdempotencyKey()` (`lib/utils/
   idempotency.ts:37`) reads the `Idempotency-Key` header **if present** — if a client
   simply omits it, the call proceeds with zero duplicate protection, and there is no
   database-level backstop (no unique constraint) the way `disbursement_requests` now
   has. STK's only hard guarantee against a double-charge is Safaricom's own
   `mpesa_stk_requests.checkout_request_id UNIQUE` — which prevents duplicate
   *callbacks*, not duplicate *prompts*.
3. **No monitor for aging unrouted receipts.** `payment_orphan_monitor` (this
   session's earlier work) catches spine rows stuck at `allocation_status='received'`
   — genuinely stuck money. It does **not** cover `allocation_status='unrouted'` or
   `mpesa_unrouted` rows, which are a *resolved* terminal state (the system correctly
   decided it can't auto-route) but can sit for weeks with no alert if a treasurer
   doesn't check the queue.
4. Fraud/velocity/limits, observability (correlation IDs, dashboards), and formal
   compliance posture are largely unbuilt — the same categories flagged in both prior
   audits, for the same underlying reason (no product decisions have been made yet on
   thresholds, vendors, or a compliance program).

**Verdict, upfront:** C2B is **materially production-ready for real-money collection**
at current or near-term scale, with the four High findings below as the priority
follow-up — none of which risk double-posting or misdirected funds today.

---

## 1. Overall C2B Architecture

- **Service boundaries:** clean. `daraja.service.ts` is pure Safaricom I/O;
  `mpesa.service.ts` owns domain routing/dispatch; `allocation-engine.ts` is a pure,
  I/O-free decision function (unit-tested, 13 tests). This is the right shape.
- **Event-driven:** the payment spine (`payments.allocation_status`) plus
  `payment_events` (append-only) plus `event_outbox` give every inbound payment a
  proper state trail and a broker-ready outbox — confirmed live (migration 057).
- **Idempotency:** strong at the *money* layer (receipt uniqueness, `FOR UPDATE`
  locks, `ON CONFLICT DO NOTHING` throughout) — weak at the *request* layer for STK
  (finding above).
- **Multi-tenancy:** `payment_accounts`, `payment_requests`, `disbursement_requests`,
  `organization_disbursements` all carry group/org scoping enforced by RLS
  (`FORCE ROW LEVEL SECURITY`, verified in migrations 059, 066, 067). No shared-float
  contamination risk exists on the *inbound* side the way it did for B2C's shared
  shortcode, because C2B money always lands against a specific membership's group.
- **Retry / failure recovery:** `runReconciliation()` sweeps stale STK requests via
  `STK Query` — genuinely good, and something B2C never had until this session's
  spine shipped its own (weaker, observability-only) equivalent.

---

## 2. End-to-End Payment Flow

```
Customer → M-Pesa (STK or PayBill) → Validation → Confirmation → Callback
  → Registry lookup (membership_no | legacy_code) ──┐
  → [registry miss] Legacy grammar fallback ─────────┼──→ Product resolution (A1-A9)
                                                       │
  → Eligibility gate (§4.1 state machine) ────────────┤
  → Dispatch to owning table (never a blanket INSERT) ┤
  → Spine: received → allocated | unrouted ───────────┤
  → Ledger (double-entry journal) ─────────────────────┤
  → Receipt SMS (product-aware, membership-tagged) ────┤
  → Reconciliation (STK only) ──────────────────────────┘
```

**Missing/duplicated stages found:**
- **Duplication:** invoice resolution logic exists in *two* places conceptually —
  the registry (`payment_accounts.kind='invoice'`, populated by trigger, never read at
  confirmation) and the legacy parser (`fulfilC2B`'s `route.kind === 'invoice'`
  branch, actually used). One is dead weight.
- **Missing stage:** no automated "unrouted aging" check (see Exec Summary #3).
- **No race condition found** in the registry-lookup → dispatch path: every dispatch
  function re-validates state under `FOR UPDATE` (e.g., `applyLoanRepayment`,
  `hasDueInstallments` checks), consistent with the "recheck under lock" pattern
  documented in the payment architecture doc.

---

## 3. Payment Resolution Engine

**Can one payment be posted twice?** No — `payments.mpesa_receipt_number UNIQUE` plus
the confirmation handler's early-return on an existing receipt (`mpesa.service.ts:
1500`) makes this structurally impossible for a replayed Safaricom callback.

**Can one payment post to the wrong member?** Only via the pre-existing, documented,
*accepted* risk: a member routes by account number, not phone — a third party paying
on a member's behalf is flagged (`is_third_party`) but always lands correctly. The
registry lookup is a single indexed query, not a heuristic.

**Can one payment resolve to multiple members?** No — `payment_accounts.identifier`
is a primary key; the lookup is exact-match, not fuzzy.

**Ambiguous payments:** land in `mpesa_unrouted` with a `reason` code
(`unknown_member`, `bad_account`, `membership_inactive`, etc.) — never guessed at.
This is a real strength; the routing decision table (R1–R10) in the architecture doc
matches the actual `dispatchProduct`/`fulfilC2B` code precisely, which is not always
true of architecture docs.

**Invalid payments:** a malformed or check-digit-failing membership number is
rejected *before money moves* via `validateC2BAccount()` (fail-open only on internal
error, verified at `mpesa.service.ts:1462`).

---

## 4. Membership Number Architecture

Already audited implicitly by this session's earlier work (migrations 056–058) and
re-verified here: fixed 8-char format with a Damm check digit
(`lib/utils/membership-no.ts`), immutable once assigned (DB trigger), unique platform-
wide, group-scoped prefixes with a reserved-pair mechanism (`ZZ` for sandbox). This is
production-ready — the one caveat is capacity governance (67M ceiling, documented
exhaustion strategy) is a paper plan, not code, which is appropriate at current scale.

---

## 5. STK Push

| Capability | State |
| --- | --- |
| Initiation / auth | ✅ `withAuth`, Zod-validated |
| Idempotency | ⚠️ Optional header, Redis-only, no DB backstop (finding #2) |
| Duplicate callback | ✅ `checkout_request_id UNIQUE` |
| Late callback / stuck request | ✅ `runReconciliation()` sweeps `status='pending'` >5 min via STK Query |
| Timeout / cancellation | ✅ handled as a distinct terminal state |
| Purpose-aware payment_requests | ✅ pre-creates a request so a member who pays via PayBill instead still lands on the right product (A2/A4) |

---

## 6. C2B Validation & Confirmation

- **Validation:** real, pre-payment, deterministic (§3.2 implemented exactly as
  documented). Fail-open on internal error — a conscious, documented tradeoff.
- **Confirmation authenticity:** `assertSafaricomIp()` is **advisory-only** — logs a
  warning on a non-Safaricom IP but never rejects (same pattern flagged as B2C
  finding H1). C2B confirmation has **no signed-token protection** analogous to what
  was just added for B2C Result/Timeout URLs. Given confirmation only *records*
  money that (per Safaricom) already moved — a forged confirmation can't steal funds,
  but it *can* falsely credit a member's account from a fabricated payload. This is a
  real gap, not yet covered by any prior session's work.
- **Replay / duplicate / out-of-order:** handled by receipt uniqueness + idempotent
  `ON CONFLICT DO NOTHING` throughout `recordC2BInbound`.
- **Malformed payloads:** `try { JSON.parse } catch { return ack() }` at the route
  layer — never crashes, never loses the callback (Safaricom gets a 200 either way,
  matching the documented "never lose money to our own parsing" stance).

---

## 7. Business Rules

Per-membership-state eligibility (§4.1) is enforced **identically** at validation
(pre-payment) and confirmation (`eligibilityGate`) — verified as the same rule set in
both places, which is the correct design (a status change mid-flight can't slip
through, since confirmation re-reads state under lock). Suspended/inactive members
are correctly forced to loan repayment only, never savings. No group-membership limit
config (min/max contribution) was found anywhere in the schema — this may be
intentional (member-driven savings has no natural ceiling) but is worth a product
decision if regulatory minimums/maximums ever apply.

---

## 8. Ledger Integrity

Double-entry, immutable-once-posted (spine write-once trigger from migration 060),
source-document attribution (`group_membership_id`, `member_id` on `journal_entries`,
enforced NOT NULL since migration 061), corrections via `payment_reallocations` with
maker-checker (migration 063) rather than mutation. This is the strongest section of
the whole platform — no findings.

---

## 9. Wallet Architecture

Group-level accounts (double-entry chart) are mature. Organization wallets
(`available_balance`/`committed_balance`) were hardened for dual control this session
(migration 067) — `committed_balance` is now a real reservation, not dead schema.
No member-level wallet exists (by design — members hold balances via product tables,
not a wallet abstraction), which is consistent with the platform's model.

---

## 10. Reconciliation

| Direction | Coverage |
| --- | --- |
| STK (inbound) | ✅ Stale-row sweep via STK Query, nightly charge backfill, daily report |
| C2B PayBill (inbound) | ⚠️ No sweep needed (synchronous confirm/validate) — but **no aging-unrouted alert** (finding #3) |
| B2C (outbound) | ✅ (this session) stuck-payout monitor; ❌ still no Safaricom-statement-level tie-out (flagged in the B2C audit, unchanged) |
| Org wallet ↔ group ledger | ✅ cross-linked via `ledger_entry_id`/`group_journal_entry_id` |

---

## 11. Security

- Rate limiting on C2B validation: 20/60s per MSISDN/IP (`checkRateLimit`, verified).
- Auth/authz on all treasurer-facing routes (`withRole`, `assertAuthFresh` epoch
  re-check) — consistent with this session's Phase 3.2 hardening.
- **Gap:** C2B confirmation has no callback-authenticity token (see §6) — the one
  place this audit found a real, addressable security gap that mirrors a fix already
  shipped for B2C.
- PII: raw callback bodies (`mpesa_callbacks`) retain phone numbers/names
  indefinitely with no stated retention policy — same finding as both prior audits.

---

## 12. Fraud & Abuse Risks

Structurally, C2B fraud surface is narrow: the worst a bad actor can do is *donate*
to a stranger's real membership number (accepted low risk, documented). No velocity
limits, round-number detection, or dormant-account monitoring exist for inbound
payments — lower priority than the B2C equivalent (there's no way to *extract* money
via a fraudulent C2B), but worth building once volume justifies it.

---

## 13. Operational Readiness

Cron-driven jobs, structured logging, and the payment-events audit trail are solid.
Missing: an unrouted-aging alert (§10), a payment-lifecycle dashboard, and DLQ
tooling specific to inbound callbacks (the outbox has DLQ replay; raw C2B/STK
callback processing does not).

---

## 14. Compliance

Same posture as both prior audits: RLS + audit trail exist; SOC2/ISO/PCI, formal
KYC/AML thresholds, and data-retention policy are unaddressed by code (require
policy/legal work, not implementation).

---

## 15. Scalability

The registry lookup is a single indexed query (`payment_accounts.identifier` PK) —
this scales to the stated "millions of transactions" without redesign. The one
identified risk is unbounded growth of `mpesa_callbacks`/`payment_events` with no
partitioning — same finding as the B2C audit, not C2B-specific.

---

## 16. Database Design

`payment_accounts`, `payment_requests`, `mpesa_unrouted`, `mpesa_stk_requests` all
have appropriate uniqueness (receipt, conversation ID, idempotency key where
applicable) and RLS. No findings beyond the invoice-kind dead-code path (§2).

---

## 17. Observability

No correlation ID threading through the C2B pipeline (each stage logs independently
with its own context) — a stuck-payment investigation requires manually joining
`mpesa_callbacks` → `payments` → `payment_events` by receipt number, which works but
isn't instrumented for fast tracing. Same gap as B2C.

---

## 18. Hardening Opportunities — Prioritized

### High
1. **Wire the registry's invoice kind into confirmation routing** (or delete the
   dead trigger/kind if invoices are intentionally staying on the legacy parser) —
   remove the duplication identified in §2/§16.
2. **Require Idempotency-Key on STK initiation** (mirror the B2C route's now-
   mandatory header) and add a DB-level backstop
   (`mpesa_stk_requests` already has a natural key via `checkout_request_id`, but that
   only protects the *callback*, not a client-side double-submit before Safaricom
   assigns one — a request-scoped idempotency key closes that window).
3. **Add signed-token verification to the C2B confirmation callback**, extending the
   `MPESA_CALLBACK_TOKEN` mechanism shipped for B2C this session to
   `/api/v1/mpesa/c2b?type=confirmation`.
4. **Unrouted-aging monitor** — mirror `payment_orphan_monitor`/
   `disbursement_orphan_monitor` for `mpesa_unrouted`/`allocation_status='unrouted'`
   rows past a threshold (e.g., 24h), alerting treasurers directly rather than relying
   on someone checking the queue.

### Medium
5. Correlation IDs threaded through `payment_events`/logs for faster tracing.
6. Partitioning plan for `mpesa_callbacks`/`payment_events` ahead of high volume.
7. PII retention policy for raw callback storage.
8. Inbound-specific DLQ tooling (today only the outbox has replay).
9. A payment-lifecycle operator dashboard (STK/C2B success rates, unrouted age,
   reconciliation status) — currently these live only as raw tables.
10. Fraud/velocity signals for inbound payments (lower priority than outbound).

### Low
11. Group-level min/max contribution limits (only if a product/regulatory need exists).
12. Legacy `KYT-…` grammar retirement plan once print materials are confirmed cycled out.
13. Formalize the invoice registry-vs-legacy decision in the architecture doc once #1 is resolved.
14. Structured metrics (success rate, p99 latency) beyond log lines.

---

## 19. Risk Matrix (Likelihood × Impact)

| Likelihood ↓ / Impact → | Moderate | Major |
| --- | --- | --- |
| **Likely** | Correlation-ID gap, retention policy | — |
| **Possible** | Unrouted-aging blind spot | STK idempotency gap |
| **Rare** | Invoice dead-code duplication | Forged C2B confirmation (no signed token) |

No finding reaches "Severe × Likely" — consistent with the "no Critical" verdict.

---

## 20. Production Readiness Score & Verdict

**Score: 78 / 100.** The registry, allocation engine, spine, and reallocation
maker-checker are genuinely production-grade. The deficit is entirely in the four
High findings above plus the observability/compliance items shared with the other
two audits — none of which represent a live money-safety defect today.

**Verdict:** the C2B implementation **is suitable for production handling of
real-money collections** at current scale. It is the most mature of the three audited
surfaces (C2B, B2C, B2B) precisely because most of the payment-architecture redesign
work already landed here. The four High findings should be closed before scaling to
"millions of transactions annually" — none of them block continued operation at
today's volume.

**Recommended sequencing:** close High #3 (signed C2B confirmation token) alongside
any future B2C work since it reuses the exact mechanism just shipped; #2 (STK
idempotency) is a small, isolated change; #4 (unrouted-aging monitor) is a copy of the
existing orphan-monitor pattern; #1 (invoice routing) is a product decision (fix the
registry path, or formally retire it) before it's worth the engineering time.

---

*Source-grounded audit. No code was modified to produce this report. Companion
documents: `B2C_DISBURSEMENT_AUDIT.md`, `B2B_ENTERPRISE_AUDIT.md`.*
