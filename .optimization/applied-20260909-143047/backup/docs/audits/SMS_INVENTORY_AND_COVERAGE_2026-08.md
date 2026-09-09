# SMS Inventory & Notification Coverage Audit

**Date:** 2026-08-06
**Companion to:** [`SMS_MESSAGING_AUDIT_2026-08.md`](./SMS_MESSAGING_AUDIT_2026-08.md) (defects, 38/100) and [`docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md`](../messaging/UNIFIED_MESSAGING_ARCHITECTURE.md) (roadmap)
**Scope of this pass:** complete message inventory, event-to-SMS matrix, duplicates, dead code, and — the largest finding — **missing notifications**.

---

## Why this audit is scoped the way it is

The requesting brief asked for a full-system SMS audit ending in a plan to "consolidate all SMS into a single centralized notification service with idempotent delivery, retry handling, audit logging, tenant-aware billing, and support for future channels."

**That consolidation was designed and built earlier today** (PR #35, migration 123). Re-deriving it would repeat this audit series' most-repeated mistake — the capital-layer spec duplicated four live subsystems; the RBAC spec's "proposed" roles were already the live ones. The architecture questions the brief asks (§ *Architecture Analysis*, items 1-13) are answered in the two companion documents and are summarised in §6 rather than re-investigated.

What those documents do **not** contain, and what this pass adds:

1. A complete inventory of every message body the system can produce (§1).
2. Every trigger, with recipient and timing (§2).
3. Dead and unreachable messaging code (§3).
4. Duplicates (§4).
5. **Missing notifications (§5)** — the headline. This is where the real product gap is.

---

## Headline finding

**The notification engine is built, wired to almost nothing, and the templates for the missing messages already exist.**

- `lib/sms/events.ts` defines **15 business event types**. **Only 2 are ever emitted** — `payment.received` and `loan.disbursed`, both from M-Pesa paths. Verified: the only `emitBusinessEvent(` call sites in the entire repo are `mpesa-b2c.service.ts:226` and `mpesa-spine.service.ts:173`.
- **13 of 15 event constants are unreachable**, including `loan.approved`, `loan.declined`, `contribution.recorded`, `member.registered`, `meeting.scheduled` and `approval.requested`.
- **21 message templates are seeded or built in; 4 are ever rendered.**
- Entire modules — **Loans, Welfare, Shares, Dividends, Meetings, Fines, Billing** — contain **zero** notification calls of any kind. `loans.service.ts` approves, rejects and disburses loans without telling anyone.

The single cleanest example: a member added to a group is **never welcomed**. A `welcome` SMS template exists (`lib/sms/templates.ts:66`), a seeded DB row exists (migration 013:95), and `sendWelcomeEmail` exists (`member-email.service.ts:5`) — **all three have zero callers** (verified by grep). Three independent implementations of a message nobody receives.

---

## 1. Message inventory

### 1a. Seeded `sms_templates` (platform-wide, `group_id IS NULL`)

| template_key | Body | Rendered today? |
|---|---|---|
| `payment_received` | `KitabuYetu: KES {{amount}} {{product}} received for {{group_name}} (A/C {{membership_no}}). Receipt: {{receipt}}. Balance: KES {{balance}}.` | **Yes** — rule `payment_received_receipt` |
| `loan_disbursed` | `Dear {{first_name}}, KES {{amount}} has been disbursed to your M-Pesa. Receipt: {{receipt}}.` | **Yes** — rule `loan_disbursed_notice` (B2C only) |
| `contribution_received` | `Dear {{first_name}}, your contribution of KES {{amount}} has been received. Receipt: {{receipt}}. Thank you.` | No |
| `loan_approved` | `Dear {{first_name}}, your loan of KES {{loan_amount}} has been approved. Disbursement is in progress.` | No |
| `loan_repayment_due` | `…repayment of KES {{amount}} is due on {{due_date}}. Outstanding: KES {{balance}}.` | No — cron renders the *built-in* copy instead |
| `loan_overdue` | `…repayment of KES {{amount}} is OVERDUE. Penalty: KES {{penalty_amount}}…` | No — same |
| `meeting_reminder` | `…{{group_name}} meeting is scheduled for {{meeting_date}} at {{meeting_location}}…` | No |
| `birthday` | `Happy Birthday {{first_name}}! …` | No |
| `payment_confirmed` | `…payment of KES {{amount}} confirmed. Receipt: {{receipt}}.` | No |
| `welcome` | `Welcome to {{group_name}} on KitabuYetu! …` | No |
| `otp` | `Your KitabuYetu verification code is {{otp}}…` | No — the 3 OTP paths use inline literals |
| `group_announcement` | `{{group_name}}: {{message}}` | No |

Source: migration `013:67-100`, plus `052:154-163`, `064:18-22`, `068:11-15`. Groups may also author unbounded custom templates via `POST /api/v1/sms/templates`.

### 1b. Built-in templates — `lib/sms/templates.ts:49-74`

Twelve keys. **Only two are ever rendered**: `loan_repayment_due` and `loan_overdue`, both by `lib/jobs/handlers.ts:414-424`. The other ten (`contribution_received`, `loan_approved`, `loan_disbursed`, `meeting_reminder`, `birthday`, `payment_confirmed`, `welcome`, `otp`, `group_announcement`, `group_verification_otp`) are reachable only via `sendTemplated` — which is dead code — or a trigger rule naming them, of which only two exist.

### 1c. Inline message bodies

| Body | Where | Path |
|---|---|---|
| `Dear {{first_name}}, our records show no contribution for {{group_name}} in {{last_month}}…` | `handlers.ts:498` | cron → `notifyMember` |
| `KitabuYetu: Your M-Pesa payment of KES ${amount} ${reason}…` (5 reason variants) | `mpesa-stk.service.ts:549` | STK callback → `notifyMember` |
| `KitabuYetu: Your role in ${group} is now ${role}.` | `member-roles.service.ts:209` | immediate → `notifyMember` |
| `Your Kitabu Yetu password reset code is ${otp}…` | `password-reset.service.ts:60` | → `sendServiceSms` |
| `Your Kitabu Yetu verification code is ${secret}…` | `group-verification.service.ts:89` | → `sendServiceSms` |
| `Your Kitabu Yetu staff invite code is ${otp}…` | `organization-members.service.ts:345` | → `sendServiceSms` |
| Operator free text | `/sms/send`, `/sms/bulk`, `/sms/campaign` | manual |

---

## 2. Trigger inventory

Seventeen triggers exist. Condensed by module:

| Module | Trigger | Recipient | Timing | Source |
|---|---|---|---|---|
| Loans | Installment due/overdue (5 stages: −3d, day-of, +3, +7, +14) | Borrower | **Cron** daily 06:00 UTC | `handlers.ts:348` |
| Loans | B2C disbursement succeeded | Borrower | Event-driven | `mpesa-b2c.service.ts:226` |
| Contributions | No completed contribution last calendar month | Member | **Cron** monthly 08:00 | `handlers.ts:447` |
| Payments | C2B/STK payment received & allocated | Payer (raw phone) | Event-driven | `mpesa-spine.service.ts:173` |
| Payments | STK failed/cancelled/timed out | Paying member | Immediate | `mpesa-stk.service.ts:531` |
| Governance | Role changed **via the admin route only** | The member | Immediate | `member-roles.service.ts:206` |
| Messaging | Operator send / bulk / campaign | Chosen recipients | Immediate + queue | `app/api/v1/sms/*` |
| Messaging | Due schedules & scheduled campaigns | Resolved recipients | **Cron** 5 min | `sms-scheduler.service.ts` |
| Messaging | Failed-SMS retry (no re-billing) | Original phone | **Cron** 5 min | `sms.service.ts:622` |
| Auth | Password reset / group verification / staff invite OTP | Raw phone | Immediate, platform-funded | 3 OTP paths |

**Coverage reality:** of ~13 business modules, only **4** (Loans-partial, Contributions-partial, Payments, Auth) send anything at all.

---

## 3. Dead / unreachable messaging code

| Item | Location | Evidence |
|---|---|---|
| `sendWelcomeEmail` | `member-email.service.ts:5` | **Zero callers** (verified) |
| `smsService.sendTemplated` | `sms.service.ts:279` | Zero callers |
| `smsService.optOut` | `sms.service.ts:735` | Zero callers — **and its SQL is a no-op**: both `CASE` branches return the same array. Combined with `sms_group_settings` having 0 production rows, members have no way to opt out |
| `notifyMany` | `notifications.service.ts:279` | Zero callers |
| `TextSmsError` | `textsms.service.ts:88` | Never thrown |
| `deduct_sms_credits()` | migration `009:233` | No TS call site |
| 13 of 15 `SMS_EVENTS` | `lib/sms/events.ts:16-35` | Never emitted |
| 10 of 12 built-in templates | `templates.ts:50-73` | Never rendered |
| 10 of 12 seeded templates | migration `013` | No rule references them |
| `schedule_type` `'birthday'` / `'loan_due'` | migration `013:171` | Accepted by the API, **filtered out by the scheduler** (`sms-scheduler.service.ts:73`) — a group can create one and it silently never fires |
| `recipient_type='roles'` | `sms.service.ts:185` | Campaign CHECK forbids it; no seeded rule uses it |

---

## 4. Duplicates

| # | Duplicate | Why it matters |
|---|---|---|
| D1 | `loan_repayment_due` / `loan_overdue` exist as **both** a DB template and a built-in, with different wording | The cron renders the built-in, so **editing the DB template — or a group overriding it — has no effect**. A tenant customisation silently does nothing. |
| D2 | `payment_received` vs `payment_confirmed` vs `contribution_received` | Three templates meaning "we got your money"; one is wired |
| D3 | OTP wording exists **5 ways** for one concept | 3 inline literals + 2 unused built-ins + 1 seeded row, across two brand spellings (`Kitabu Yetu` vs `KitabuYetu`) |
| D4 | `loan_disbursed_notice` rule seeded by **two** migrations (066 and 068) | Idempotent via `WHERE NOT EXISTS` + unique index, but two migrations own one object |
| D5 | Two `payment.received` emit sites for one payment | Deduped by the `UNIQUE (rule_id, event_id)` claim — safe, but two independent triggers for one message |
| D6 | Two role-change code paths | `app/api/admin/…/role` → `assignGroupMemberRole` **notifies**; `app/api/v1/members/[id]` → `updateRole` **does not**. Same business event, different outcome depending on which UI was used. Verified. |

---

## 5. Missing notifications — the main finding

Classified as **(a) pure wiring** — the event constant and template already exist, so one `emitBusinessEvent` call would fire it — or **(b) needs a new constant + template**.

### 5a. Pure wiring (the cheap, high-value tier)

| Business event | Where it happens | What already exists |
|---|---|---|
| **Member added to group** | `members.service.ts:115` | `MEMBER_REGISTERED` + `welcome` template + `sendWelcomeEmail` — **all three dead** |
| **Loan approved** | `loans.service.ts:138` | `LOAN_APPROVED` + built-in template |
| **Loan disbursed (cash/bank/manual)** | `loans.service.ts:177` | `LOAN_DISBURSED` + **a rule already seeded in the DB**. Only the B2C branch emits, so non-M-Pesa disbursements skip a fully-configured pipeline |
| **Loan rejected** | `loans.service.ts:157` | `LOAN_DECLINED` (needs a template row) |
| **Contribution recorded** | `contributions.service.ts:88` and `:213` | `CONTRIBUTION_RECORDED` + built-in template. Today: email only on create, **nothing at all** on the pending→completed update |
| **Meeting scheduled** | `meetings.service.ts:146` | `MEETING_SCHEDULED` + `meeting_reminder` template |
| **Approval requested** | 5 maker-checker flows: `loans:90`, `welfare:119`, `organization-finance:973`, `dividends:255`, `reallocations:53` | `APPROVAL_REQUESTED` — never emitted. **No approver is ever told work is waiting** |
| **Payment allocated from unrouted** | `mpesa-unrouted.service.ts:46` | `PAYMENT_RECEIVED` fits verbatim; `emitPaymentReceiptEvent` simply isn't called on this branch |
| **Reconciliation outcome** | `mpesa-reconciliation.service.ts` | `MPESA_RECONCILED` / `MPESA_RECONCILE_FAILED`, both dead |

### 5b. Money moves, nobody is told (needs new constants)

Every one of these transfers real value and sends nothing on any channel:

| Event | Location |
|---|---|
| Welfare payout disbursed | `welfare.service.ts:172` |
| Dividend approved (every shareholder now has a payable) | `dividends.service.ts:277` |
| Dividend paid | `dividends.service.ts:407` / `:461` |
| Share purchase / redemption / **transfer** (neither party told) | `shares.service.ts:219` |
| Loan repayment recorded; loan fully paid off | `loans.service.ts:237` / `:284` |
| Org disbursement approved / rejected / settled | `organization-finance.service.ts:1011` / `:1039` |
| Member funds reallocated between products | `reallocations.service.ts:134` |
| Fine issued (via meeting attendance) | `meetings.service.ts:213` |
| SMS credits topped up | `billing.service.ts:197` — asymmetric: exhaustion **is** alerted, recovery is not |

### 5c. Security events with no notification anywhere

| Event | Location |
|---|---|
| **Password changed** | `members.service.ts:376` — no SMS, no email, no in-app |
| **New-device login** | `app/api/v1/auth/login` — nothing |
| Member blacklisted / exited (a reason is required, the member is never told) | `members.service.ts:281` |
| Temp password issued to a new member | `members.service.ts:154` — the member never receives the credential |

### 5d. Officer-facing operational gaps

Unrouted payment received (`mpesa-unrouted.service.ts`) — money sits unallocated and a treasurer must happen to notice it in the UI.

---

## 6. Architecture answers (from the companion documents)

| Question | Answer |
|---|---|
| How does SMS flow? | Trigger → `smsService.send` / `notifyMember` / `sendServiceSms` → `textsms.service` → TextSMS Kenya |
| Sync or async? | Hybrid, by decision: OTP and interactive are synchronous; triggered/bulk/scheduled go through `lib/jobs` |
| Retries? | Yes — `sms_failures` with exponential backoff, plus job-level retry (now bounded, PR #34) |
| Idempotency? | Yes for triggers (`UNIQUE (rule_id, event_id)`), reminders (`reminder_dispatch_log`) and campaigns (job `dedup_key`). **No** request-level idempotency on `/sms/bulk` |
| Rate limiting? | Yes, per-group per-surface (PR #33) |
| Opt-out? | Checked on every path, but **nothing can write the list** — `optOut` is dead and its SQL is a no-op |
| Delivery receipts? | Polled (`sms_poll_dlr`), not pushed. No inbound webhook exists |
| Billing correct? | Reservation model as of PR #35; previously the working path billed nothing |
| Tenant isolation? | RLS enforced under `app_tenant`; one IDOR fixed in PR #33 |
| Audited? | `sms_usage_logs`, now with member/type/correlation attribution |

---

## 7. Statistics

| Metric | Count |
|---|---|
| Distinct message templates (seeded + built-in + inline) | **~30**, of which **4** are ever rendered |
| Business event constants defined / emitted | **15 / 2** |
| Triggers that actually send | 17 |
| Modules that send anything | **4 of ~13** |
| Scheduled SMS jobs | 5 (`retry_failed`, `process_schedules`, `poll_dlr`, `release_stale_reservations`, plus 2 notify crons) |
| Providers | 1 (TextSMS Kenya) |
| Dead/unreachable messaging items | **13** |
| Duplicate template families | 6 |
| Missing notifications identified | **~35** (9 pure wiring, ~9 money-movement, 4 security, rest operational) |

---

## 8. Recommendations

### Critical

1. **Make opt-out possible.** `optOut` is dead *and* its SQL is a no-op, and `sms_group_settings` has 0 production rows — so every consent check reads a permanently empty list. This is a compliance exposure, not a feature gap.
2. **Reconcile the two role-change paths** (D6). The same business event notifies or doesn't depending on which route the caller used.

### High

3. **Wire the 9 pure-wiring events (§5a).** Each is one `emitBusinessEvent` call against an engine, constants and templates that already exist. Start with member-welcome, loan approved/rejected, manual loan disbursement, and `APPROVAL_REQUESTED` — the last means no approver is currently told that work is waiting, across five maker-checker flows.
4. **Fix the template-override illusion (D1).** A group overriding `loan_repayment_due` today changes nothing, because the cron renders the built-in. Either resolve from the DB or delete the built-in.
5. **Notify on money movement (§5b)** — welfare payouts, dividends and share transfers move real value silently.

### Medium

6. Password-change and new-device notifications (§5c).
7. Consolidate the 5 OTP wordings and fix the `Kitabu Yetu` / `KitabuYetu` split.
8. Delete or wire the 13 dead items (§3); remove the `birthday`/`loan_due` schedule types the API accepts but the scheduler silently drops.

### Low

9. Collapse the duplicate `loan_disbursed_notice` seed across migrations 066/068.
10. Template variable naming is inconsistent (`{{amount}}` vs `{{loan_amount}}`).

---

## 9. Suggested sequencing

The consolidation the brief asks for is largely done; the gap is **coverage**, and it is cheap:

- **Phase A (days)** — the 9 pure-wiring events. No new infrastructure; each is an emit call plus, in two cases, a template row. Seed new rules **disabled** and enable per group rather than switching ~9 message types on for 5 live groups at once.
- **Phase B** — opt-out write path + the two Critical items.
- **Phase C** — new constants/templates for money-movement and security events (§5b, §5c).
- **Phase D** — template consolidation and dead-code removal.

Phase A should not begin until **Phase 2b** (bundled allowance, then billing on) lands, or turning on ~9 new message types will multiply SMS volume for groups whose billing model is still mid-change.

---

## Caveats

- Findings are grep- and read-derived from source. The three highest-consequence claims (`sendWelcomeEmail` zero callers, only 2 `emitBusinessEvent` sites, the two divergent role paths) were **independently re-verified** before write-up; the rest are single-pass and should be confirmed before acting.
- "Missing" here means *no notification fires*, not that one is definitely wanted. Which of §5b/§5c to build is a product decision — a member may not want an SMS for every share transaction.
- No code was changed in this pass.
