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
