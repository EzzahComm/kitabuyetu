# SMS templates, personalization and payment context — implementation audit

Audit of the existing implementation against the "Sender Signature, Short Membership ID &
Payment Context" specification, carried out as that spec's own §12 requires **before** any code
is written.

**Headline: roughly two-thirds of the spec already exists under different names.** The largest
risk in implementing it as written is that §12's own instruction — *"do not create duplicate
fields or parallel identifiers if the required data already exists"* — would be violated by
adopting the spec's proposed variable names verbatim.

---

## §1 What already exists

| Spec asks for | Already present as | Where |
|---|---|---|
| `{{short_member_id}}` | **`{{membership_no}}`** | `resolveRecipientVars`, `DEFAULT_TEMPLATES.welcome` |
| `{{payment_account}}` → short member ID | **`account_number: r.membership_no`** | `contributions.service.ts` |
| `{{paybill_number}}` | **`{{paybill}}`** | contribution reminder, loan templates |
| Contribution reminder template | exists, but **inline, not in `DEFAULT_TEMPLATES`** | `contributions.service.ts:122` |
| Welcome / contribution received / loan repayment / payment confirmed | all present | `lib/sms/templates.ts` |
| Segment counting that includes everything | **`lib/sms/segments.ts`**, single shared counter | used by UI *and* billing |

### The short membership ID is stronger than the spec assumes

`group_members.membership_no` is `PP DDDDD C` — e.g. `BG102534` — where `PP` is the group's
immutable `payment_prefix`, `DDDDD` a per-prefix sequence, and `C` a **Damm check digit**. The
Damm quasigroup catches every single-character error and every adjacent transposition, so a
mistyped account fails validation instead of **paying a stranger in another group**. It is
mirrored by a DB CHECK constraint (migration 056).

It is per-group, deterministic, stable, and already the M-Pesa payment account. **§2 is satisfied
today.** What is missing is only a consistent *name* for it in templates.

---

## §2 Premises in the spec that do NOT hold

### PayBill is not group-configurable

`process.env.MPESA_WORKING_SHORTCODE ?? process.env.MPESA_SHORTCODE` — a **single platform
paybill** through which every group's money is pooled. The spec repeatedly implies groups
configure their own; they cannot. Per-group shortcodes are an unbuilt roadmap item with real
custody consequences, not a template concern.

**Implication:** `{{paybill_number}}` can be standardised as a variable, but it resolves to one
platform value for every group until that separate work happens.

### Welfare is a pool, and member-level welfare needs a decision

`welfare_pool_contributions` carries **both** `group_id` and `member_id`, so a per-member welfare
*contribution total* is derivable. But the group-level `poolBalance` in `analytics.service.ts` is
a **group** figure. The spec's own rule — *"do not expose financial information belonging to
another member"* — makes conflating them a real hazard: `{{welfare_balance}}` must mean "what
this member has contributed", never the group pool.

### There is no sender-identity concept at all

Zero occurrences of sender name/role anywhere in the SMS templates, and nothing in
`sms_group_settings` to hold them. **§1 is the single largest item in the spec** — new schema,
new configuration surface, new resolution logic — not an extension of something existing.

Note also that `TEXTSMS_SENDER_ID` (`KITABU YETU`) is the **gateway sender ID**, an unrelated
concept: it is who the message appears to come from at the network level, not a human signature
in the body. They must not be conflated.

---

## §3 Real defect found: the reminder logic is duplicated

The contribution-reminder body and the paybill lookup exist **twice**:

- `lib/services/contributions.service.ts:121-142`
- `lib/jobs/handlers.ts:499`

Both build `paybill` from the same env chain and render a near-identical body. A template change
today must be made in two places or they silently diverge. This is precisely the "duplicating
business logic" the spec's §13 end-goal exists to remove, and it is the thing every later item
would otherwise be built on top of twice.

---

## §4 Variable inventory as it stands

Counted across `lib/services`, `lib/sms`, `lib/jobs`:

```
14 {{first_name}}     3 {{receipt}}          1 {{penalty_amount}}   1 {{due_date}}
 7 {{group_name}}     3 {{paybill}}          1 {{month}}            1 {{balance}}
 5 {{amount}}         3 {{membership_no}}    1 {{loan_amount}}
                      3 {{account_number}}   1 {{meeting_date}}
```

Syntax is **consistent** — one `{{\w+}}` form, one renderer (`renderTemplate`), one
`stripUnresolved`, one `extractVars`. There is no competing syntax to reconcile, which removes a
risk the spec anticipated.

`{{balance}}` appears once, in `loan_repayment_due`, where it means loan outstanding. The spec's
§6 objection is fair in principle — the *name* is ambiguous even though its single use site is
not.

---

## §5 Recommended sequence

The ordering matters more than the individual items, because one of them removes duplication that
would otherwise be paid for repeatedly.

1. **De-duplicate first (§13).** Move the two inline reminder templates into `DEFAULT_TEMPLATES`
   and give the paybill lookup one home. Everything below is cheaper afterwards and doubly
   expensive before.
2. **Alias, do not duplicate (§12).** Accept the spec's names as *aliases* resolving to the
   existing values — `short_member_id` → `membership_no`, `payment_account` → `membership_no`,
   `paybill_number` → `paybill`. Legacy names keep working; historical messages are untouched.
3. **Sender identity (§1).** New columns on `sms_group_settings`, a configuration surface, and
   `{{sender_signature}}` composed from name + role + group. Must feed `segmentsOf()` so the
   signature is billed, not discovered at send time.
4. **Context-aware balances (§6).** `contribution_balance`, `loan_balance`,
   `share_capital_balance` map to `MemberWalletSummary`'s `savings` / `loanBalance` / `shares`.
   `welfare_balance` needs the member-vs-pool decision above before it is safe to expose.
5. **Validation before send (§10)**, then **preview (§11)**, then **the smart composer (§9)**,
   which depends on all of the above.

## §6 Backward-compatibility constraints that apply throughout

- Historical `sms_usage_logs` rows are an append-only billing and audit record — never rewritten.
- `sms_templates` rows already customised by groups must keep rendering; aliases are additive.
- Scheduled `sms_schedules` and trigger rules render at fire time, so a variable removed today
  breaks a schedule written weeks ago. **Add names; do not retire them.**
- Any new variable that lengthens a message changes its cost. `segmentsOf()` is the single
  counter for UI estimate and billing alike (V3-01 fixed a three-way divergence here) — anything
  new must go through it rather than beside it.

---

## §7 Correction (2026-09-03) — §4's inventory was drawn from one of two sources

**§4 above counts variables in code only.** Templates also live in the `sms_templates` **table**,
and §6's own third bullet says so — yet the inventory never queried it. Production holds four
rows:

| key | scope | active | in `DEFAULT_TEMPLATES`? |
|---|---|---|---|
| `payment_received` | platform, `is_system` | yes | **no** |
| `loan_disbursed` | platform, `is_system` | yes | yes |
| `welcome` | one group | yes | yes (group row overrides) |
| `onboarding` | one group | no | **no** |

### The consequence: §5 step 4 is already built and live

`payment_received` — a template with no code counterpart — reads:

```
KES {{amount}} {{product}} received for {{group_name}} (A/C {{membership_no}}).
Receipt: {{receipt}}. Balance: KES {{balance}}.
```

Its resolver is `mpesa-spine.service.ts:140-215`. A three-branch `UNION ALL` returns `product` as
`savings` / `loan repayment` / `welfare` and `balance` as, respectively, completed-contribution
total, `loans.outstanding_balance`, or welfare contributed — so **the spec's §6 context-aware
balances exist**, keyed off which table the payment landed in rather than off a variable name.
`membership_no` goes through `formatMembershipNo`. So §4's *"`{{balance}}` appears once, in
`loan_repayment_due`"* is wrong: its most significant use is in a template §4 never looked at.

Two things follow that change the plan in §5:

- **Step 4 is mostly done.** What remains is exposing these balances to *composed* messages, not
  building the resolution.
- **The welfare hazard §2 flagged is already handled correctly here.** The welfare branch sums
  `welfare_pool_contributions` **for that member** — "what you put in", never the group pool
  balance. That is the safe semantic §2 asked for, already in production. `{{welfare_balance}}`
  as a *name* should still be avoided; the value that exists is a contributed total.

### Production evidence

The `payment.received` trigger rule is active platform-wide: **15 executions, 9 sent, 6 failed**.
The failures are understood and none is open:

- **5** (07 Aug, one evening, one group) — `Insufficient SMS credits`, 4 attempts each. This is
  the exact incident already cited at `trigger-engine.ts:291`, and the fast-fail added there
  fixed it: 402-class errors no longer burn retries.
- **1** (31 Jul) — `FOR UPDATE cannot be applied to the nullable side of an outer join`. Not
  recurred in the 9 sends since; no `FOR UPDATE` remains in the trigger path.

No `payment.received` event has fired since 2026-08-21 because no C2B payment has arrived since.
The three contributions recorded after that date carry `payment_method='mpesa'` but **no
`payment_id`** — treasurer-entered records of money that never crossed the platform paybill, so
there is no receipt to confirm and no event to emit. Correct behaviour, but it does mean a
manually recorded payment sends the member nothing. Whether it should is a product question, not
a defect.

### One thing worth a decision (not a defect)

The group-scoped `welcome` row ends with a personal signature — a named individual and a job
title, authored into that group's own template. It is worth separating this from the **group name
only** decision taken for §1, which it does *not* contradict: that decision governs the signature
`buildSenderVars` **generates** for automated sends, so that a system-sent message never appears
to come from a person who did not write it. A group-authored template body is editorial content
belonging to whoever wrote it, and a human sign-off there is a legitimate choice.

The only reason to raise it at all: it is stored per-group, so it will not follow if that group's
templates are ever copied to another, and it will keep sending that individual's name after any
change of role. Both are arguments for composing it from a variable rather than literal text —
neither is an argument for removing it.
