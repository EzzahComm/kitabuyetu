# SMS Monetization — Architecture Audit

**2026-08-13.** Phase 1 of a pasted 22-section spec for restructuring SMS into a *Subscription + Prepaid Credits + Usage-Based Deduction* revenue model. The spec's own §20 mandates an audit before any code, and §21 warns against implementing blindly on a production system. This is that audit.

Every claim below is grounded in source or in a live query against production (`qztcgryhoanennsizcll`). Nothing is taken from the spec's own description of what a generic SaaS looks like.

**No code has been written.** The decisions in §3 need answering before schema work starts.

---

## 1. Headline verdict

**The spec is closer to a superset of what exists than a replacement of it.** The consumption half — reservation, settle/release, per-message attribution, allowance split, low-balance alerting — is already built, centralized, and production-proven. The *monetization* half — volume pricing, packages, purchase lots, margin — is genuinely absent.

The single biggest risk in the spec is not any of its new features. It is **§6's "1 SMS = 1 SMS Credit"**, which is a **unit change on a live balance**, not a relabelling. See §4.

| Spec requirement | Reality | Verdict |
|---|---|---|
| §5 Centralized wallet, all features | `billing_accounts` + `reserveCredits`/`settleReservation` | ✅ Exists |
| §7 Central consumption service | `lib/services/messaging-billing.ts` — the single earmark/charge/return point | ✅ Exists |
| §17 Reserve → reconcile → release | Exactly the implemented model, with a stale-reservation sweeper | ✅ Exists |
| §14 Consumption record | `sms_usage_logs` — richer than the spec asks | ✅ Exists |
| §9 Low-balance alerts | `low_balance_threshold`, `low_balance_notified_at`, 24h dedup, re-arms on top-up | ✅ Exists |
| §11 Chama Reminder on the shared wallet | Never had its own; Phase 4 shipped on the shared one | ✅ Already true |
| §14 Purchase record | `sms_credits` table — has `rate_applied` per purchase | 🟡 Partial |
| §4 Don't retroactively reprice | Per-purchase rate stored; **no lot consumption tracking** | 🟡 Partial |
| §5 Immutable ledger, never silently modify | Balance is a **mutable `NUMERIC`** column | ❌ Gap |
| §2 Volume pricing tiers | Exists **as a dead function signature** — see §2.2 | ❌ Gap |
| §3 Packages | Nothing | ❌ Gap |
| §12 Super-admin pricing/package controls | Nothing | ❌ Gap |
| §15 Provider cost & margin | Nothing — grepped, zero references | ❌ Gap |
| §6 1 SMS = 1 credit | Credits are **money**, not messages | ❌ Unit change |

---

## 2. What actually exists

### 2.1 The wallet — and there are already two of them

Two independent wallets, on two different tenancy axes:

| | `billing_accounts` | `organization_billing_accounts` |
|---|---|---|
| Keyed by | `group_id` | `organization_id` |
| Balance | `sms_credits NUMERIC(_,2)` | `sms_credits NUMERIC(_,2)` |
| Rate | from `subscriptions.sms_rate` | own `sms_rate NUMERIC(_,4)` default 0.90 |
| Reservation | `reserved_sms_credits` | `reserved_sms_credits` |
| Bundled allowance | `sms_allowance_used` / `_reserved` (INTEGER, message counts) | none — orgs get no allowance |
| Low balance | `low_balance_threshold`, `low_balance_notified_at` | same |
| Auto top-up | `auto_topup_enabled`, `auto_topup_amount` — **columns exist, dormant** | none |

`reserveCredits` already takes `payerType: 'group' | 'organization' | 'platform'` (`lib/services/messaging-billing.ts:37`), so a three-way payer axis is live today. **This is the decision the spec cannot answer for us — see §3, Decision A.**

Note `auto_topup_*` already exists and is unused. The spec (§9) defers auto top-up to a future phase; the columns are already there for it.

### 2.2 Pricing — volume tiers exist as a signature nothing calls

`SMS_RATES` in `types/enums.ts` is typed `Record<SubscriptionProduct, Record<PlanType, (volume: number) => number>>` — a function *of volume*. Only the `enterprise` cell branches on it (0.90 / 0.75 above 10k / 0.60 above 50k).

**Every call site passes `0`:**
- `billing.service.ts:102` — `SMS_RATES[product].starter(0)`
- `billing.service.ts:186`, `:231` — `SMS_RATES[product][planType](0)`
- `app/api/v1/billing/plans/route.ts:31` — `SMS_RATES[product][plan](0)`

So the volume argument is dead in all four callers, and the tiers it encodes (0.60/0.75/0.90) don't match the spec's proposed table anyway.

**It is doubly dead**: the rate used at *send* time doesn't come from this function at all. `reserve_sms_credits` reads `MIN(sms_rate)` across the group's active `subscriptions` rows — a scalar frozen onto the subscription at purchase time. `SMS_RATES` only ever *seeds* that scalar.

Practical consequence: **every group in production pays a flat 0.90**, and the volume machinery has never priced anything.

### 2.3 Consumption — already better than §14 asks

`sms_usage_logs` carries: `credits_deducted`, `credits_reserved`, `credits_from_allowance`, `billing_state` (`reserved`/`consumed`/`released`/`none`), `reserved_at`, `settled_at`, `payer_type`, `payer_organization_id`, `provider`, `provider_msg_id`, `network_id`, `reference_type`/`reference_id`, `notification_type`, `campaign_id`, `correlation_id`, `member_id`.

The spec's §14 consumption list is a strict subset. **Nothing needs adding here** except possibly a package/lot reference (§4).

### 2.4 Purchases — closer to §4 than expected

`sms_credits` stores one row per purchase: `amount_paid`, `credits_added`, **`rate_applied`**, `payment_id`, `added_by`, `notes`, plus `UNIQUE(payment_id)` (migration 137, idempotency).

`rate_applied` is per-purchase, which already satisfies the *spirit* of §4 — the price paid for a batch is preserved and never recalculated. What's missing for §4's full model: `package_id`, `remaining_balance` (lot-level consumption), `currency`, and expiry.

**Important**: because the balance is a single pooled `NUMERIC`, credits are not consumed lot-by-lot today. Implementing §4's "remaining balance per purchase" means moving to lot consumption (FIFO or similar), which is a genuine behavioural change, not a schema addition.

---

## 3. Decisions — RESOLVED 2026-08-13 (A–C), D pending a provider number

### Decision A — is the wallet per group, or per organization?

The spec says "**Organization** SMS Wallet" throughout (§5, §7, §11, §14). In this codebase those are different things:

- `groups` is the real tenant. Every data row belongs to a group. It owns `billing_accounts`.
- `organizations` is a **separate, thinner oversight/funding layer** (NGO-style) with its own `organization_billing_accounts` and its own separately-negotiated `sms_rate`. It is not the tenant.

Three options:

1. **Keep both wallets, formalise the existing 3-way payer axis.** Lowest risk; matches what's live; `reserveCredits` already models it. Cost: "one wallet" in the spec becomes "one *service*, two payer types" — the spec's §7 diagram is satisfied by the service, not by a single table.
2. **Consolidate onto a single wallet table with a polymorphic owner.** Closest to the spec's literal wording. Cost: a real migration of two live balances, and it flattens a distinction the org-funding feature depends on (orgs negotiate their own rate).
3. Organization-only wallet. **Rejected outright** — most groups have no organization, so this would leave the majority of tenants with nowhere to hold credits.

> **DECIDED: option 1** — groups keep their own wallet, organizations keep theirs. The spec's actual requirement is "do not build a second billing implementation per feature", and that is already satisfied. Two *payer types* is not the fragmentation §1 warns about; two *billing implementations* would be, and there aren't any. No migration of live balances; the existing 3-way payer axis gets formalised rather than replaced.

### Decision B — do credits become message counts (§6)?

Today `billing_accounts.sms_credits` is **money**. Live example: group `KY0000001` holds `111.11` at a rate of `0.90` — that is 123 messages' worth, displayed as "111.11 credits".

Under §6 the same wallet must read "123 SMS Credits".

This is not a display change. It changes what the column *means*, and §21 forbids silently resetting balances. Options:

1. **Add `sms_credit_balance INTEGER` alongside the money column**, backfill as `floor(money / effective_rate)`, migrate readers, retire the money column later. Reversible, auditable, no customer sees a balance move.
2. Convert in place. Cheaper, but irreversible and momentarily wrong for anyone mid-send.
3. Keep money internally, divide for display only. Cheapest — but §4's per-lot pricing then has no integer quantity to attach to, so it blocks the package model.

> **DECIDED: option 1.** Add `sms_credit_balance INTEGER` alongside the money column and migrate readers. The conversion factor is treated as a **per-lot fact** — each `sms_credits` row already stores its own `rate_applied` — not a global constant, so a group that bought at two different rates converts correctly. Two real balances are affected today (111.11 and 0.00); the migration will not be this small later.

### Decision C — how far does the immutable ledger go (§5)?

The spec says "never silently modify the balance; every change must have an immutable transaction record."

Today: purchases are recorded (`sms_credits`), consumption is recorded (`sms_usage_logs`), but the balance itself is a mutable column updated by `UPDATE billing_accounts SET sms_credits = sms_credits + $1`.

1. **Derive the balance from the ledger** (sum of entries), keep the column as a cached projection with a reconciliation check. True to §5.
2. Keep the mutable balance, add an append-only `sms_credit_ledger` alongside it for audit only.
3. Status quo.

> **DECIDED: option 2 first, option 1 later.** The balance column is read on the hot path by `reserve_sms_credits` under `FOR UPDATE`; making it a live aggregate is a performance and correctness change to the most concurrency-sensitive code in the SMS stack. Ship the append-only ledger plus a reconciliation job first, and move the source of truth only once the two are proven to agree in production.

### Decision D — is 0.50 sustainable? (§15, §19)

**Cannot be answered from this codebase**: provider cost appears nowhere. Grepped `provider_cost`, `gross_margin`, `margin` across `lib/`, `app/`, `types/`, `supabase/migrations/` — zero hits.

The spec itself says not to assume 0.50 works. **Someone has to supply the actual TextSMS per-message cost before the bottom tier can be approved.** Until then, margin reporting can be built with a configurable cost, but the tier table should not go live below a rate we know is profitable.

> **STILL OPEN — the only decision code cannot supply.** Provider cost will be modelled as an admin-configurable value from the start (§15 requires that anyway, since provider pricing changes). Phases 1–2 proceed without it. What it gates is narrow and specific: **which tiers may be activated**, and whether §15's margin reporting shows real numbers or a placeholder. The KES 0.50 tier stays inactive until a real figure confirms it.

---

## 4. §16's bug list — most of it is already closed

The spec asks for particular attention to a list of SMS billing bugs. Checked each against this repo's history; **six are already fixed**, and re-"fixing" them risks reintroducing them:

| §16 item | Status |
|---|---|
| Incorrect interpretation of provider response types | ✅ Fixed — PR #54, TextSMS returns two spellings of the response-code key |
| Successful SMS recorded as failed | ✅ Same fix (#54) |
| Failed SMS being charged | ✅ Fixed — reservation model; `failed` releases rather than consumes |
| Duplicate deductions | ✅ Fixed — PR #41 (retry idempotency), #57 (chunked dispatch), migration 137 (`UNIQUE(payment_id)`) |
| Refund/reversal logic | ✅ Fixed — PR #47, refund on dispatch exception |
| Partial bulk-send failures | ✅ Fixed — PR #40, `clientSmsId` response alignment; #57 chunking |
| Race conditions / concurrent consumption | ✅ `reserve_sms_credits` uses `FOR UPDATE`; settle claims only `billing_state='reserved'` rows |
| Numeric values returned as strings | 🟡 **Real and current** — `pg` returns `NUMERIC` as string; the code converts at boundaries (`Number(r.rate)`), but this is convention, not enforcement |
| Invalid SQL in billing/locking queries | 🟡 **Has bitten twice** — an untyped `$2` broke `reminder.service.settle()` in production (PR #44); migration 127 fixed a `SELECT INTO` that silently took an arbitrary subscription row |
| Provider timeout handling | 🟡 Partial — stale-reservation sweeper is the backstop |

**Do not treat §16 as a fresh bug list.** It is largely a description of problems this codebase has already lived through and fixed; the audit trail is in `docs/audits/SMS_MESSAGING_AUDIT_2026-08.md`.

---

## 5. Production reality — the new path is barely exercised

Queried live, 2026-08-13. All-time SMS across production: **286 messages**.

| `notification_type` | `billing_state` | messages | credits charged |
|---|---|---:|---:|
| *(null)* | `none` | 270 | 100.80 |
| `campaign` | `released` | 5 | 0 |
| `contribution_nudge` | `released` | 4 | 0 |
| `stk_fallback` | `none` | 3 | 0 |
| `payment.received` | `released` | 2 | 0 |
| `payment.received` | `consumed` | 2 | 1.80 |

Three things follow, and they matter for planning:

1. **Only 4 messages have ever been charged through the reservation path** (KES 1.80). The other KES 100.80 went through the legacy pre-migration-123 path. The current billing code is correct but has almost no production mileage — treat volume behaviour as unproven, not as regression risk.
2. **§8's "usage by feature" is ~5% populated.** 270 of 286 rows have `notification_type = NULL`. The column exists and newer sends populate it; historical analytics will be mostly "unattributed" and the UI must say so rather than implying zero.
3. **Customer base is 2 paying groups** (`Joka Ezra`, `THE FIONA'S`, both kitabu_yetu starter at KES 150), 1 locked (`CAPITAL POINT`), 2 test artifacts. Balances affected by any credit migration: **111.11 and 0.00**.

The last point is the most useful fact in this document: **this is the cheapest moment this migration will ever be.** Two real balances, 286 historical messages. Every month of growth makes Decision B harder.

---

## 6. Recommended phasing

Ordered so nothing destructive happens before the decisions land, and so each phase is shippable alone.

**Phase 0 — Decisions.** A, B, C above. D needs a number from the SMS provider.

**Phase 1 — Ledger, additive and inert.** `sms_credit_ledger` append-only table; write to it from every existing balance mutation; reconcile against `billing_accounts.sms_credits` in a job. Changes no behaviour, proves the ledger agrees before anything depends on it.

**Phase 2 — Pricing engine.** `sms_pricing_tiers` + `sms_packages` tables, configurable per §2/§3, plus super-admin CRUD (§12). Seeded with **today's flat 0.90** so nothing reprices on deploy. Kill `SMS_RATES`' dead volume signature in the same pass.

**Phase 3 — Credit unit conversion (Decision B).** The riskiest phase; do it while the balance count is 2.

**Phase 4 — Purchase lots.** `package_id`, `remaining_balance`, lot consumption per §4.

**Phase 5 — Analytics & margin.** §8 org dashboard, §15 margin reporting with configurable provider cost. Depends on Phase 4 for revenue-by-package.

**Phase 6 — UX.** Org SMS page (§13) and super-admin billing dashboard (§12).

**Explicitly deferred**: auto top-up (§9 says future; columns already exist), credit expiry (§4 "if applicable" — no policy decided).

---

## 7. What this audit recommends *against*

- **Do not rebuild the consumption path.** Reservation, settle/release, the sweeper, allowance splitting and low-balance alerting are all live and were hardened across ~10 PRs in August 2026. §7's `SMSCreditService.consume(...)` already exists as `reserveCredits` + `settleReservation`.
- **Do not create the seven services in §20's Phase 4 as separate modules.** `SMSCreditService`/`SMSWalletService`/`SMSReservationService`/`SMSBillingService` all describe `messaging-billing.ts`, which is deliberately one module because the SQLSTATE mapping has to live in one place. Splitting it would fragment exactly what §1 asks to centralize. `SMSPricingService`, `SMSUsageService` and `SMSMarginService` are genuinely new.
- **Do not treat Chama Reminder as needing integration work (§11).** It has never had its own SMS accounting; Phase 4 shipped it on the shared wallet by construction.
