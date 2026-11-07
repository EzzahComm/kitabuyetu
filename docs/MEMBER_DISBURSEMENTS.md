# Member disbursements (migration 218)

Group → member payouts with separation of duties, Kitabu Yetu sign-off and automatic reconciliation of the
group ledger and the member ledger.

## Investigation summary — what existed, what was reused

| Concern           | Existing implementation (authoritative)                                                                                                                          | Used how                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Moving money out  | `disbursement_requests` + `disbursements.service.ts` (B2C spine, migration 066): balance lock, `reserved_amount`, idempotency key, dispatch, callback settlement | Extended — member disbursements are rows on the same table       |
| M-Pesa B2C        | `mpesa-b2c.service.ts` `initiateB2C` / `handleB2CResult`                                                                                                         | Unchanged path; callback now also posts the member journal       |
| Group ledger      | `journal_entries` / `journal_lines` via `postSystemJournal`, posting templates (`posting-templates.service.ts`)                                                  | New `member_payout` template, remappable per group               |
| Member ledger     | No separate table: member balances are derived (`computeMemberFinancialSnapshot`), history is the passbook union (`member-passbook.service.ts`)                  | Both now read the disbursement row — no second ledger introduced |
| Approvals ledger  | `settlement_approvals` (vendor payments, settlements, Changi$ha)                                                                                                 | Treasurer and Kitabu Yetu decisions recorded here                |
| Office check      | `group_members.role` via `getOfficerRole` (Changi$ha, migration 212)                                                                                             | Same live office lookup                                          |
| Platform sign-off | Changi$ha `awaiting_platform` stage + `/api/admin/*` super-admin routes                                                                                          | Same pattern                                                     |
| Notifications     | SMS trigger engine (`emitBusinessEvent`, deduplicated per rule + event id)                                                                                       | Three new events, emitted only after commit                      |
| Audit             | `audit_logs`                                                                                                                                                     | Every transition                                                 |

Defect found while investigating: a non-loan B2C payout (the spine's documented "any future group→member payout")
posted **no** group journal — cash left 1001 with only the Safaricom fee booked — and never touched the
recipient's balance. Member disbursements close that gap.

## Workflow

```text
Chairperson | Secretary   initiate        → pending_approval   funds reserved on 1001 (1002 for bank)
Treasurer (≠ initiator)   approve         → awaiting_platform
                          reject (reason) → rejected            reservation released, initiator notified
Kitabu Yetu (super_admin) sign off        → M-Pesa: approved → dispatched → completed (B2C callback)
                                          → legacy cash / bank rows: sign-off blocked; decline and resubmit via M-Pesa
                          decline         → rejected            reservation released, initiator notified
Initiator                 cancel          → cancelled           (before money moves)
```

Enforced three times: route permission `member_payouts.manage` (re-read live, not from the token), office checks in
`member-payouts.service.ts`, and the `enforce_member_payout_workflow` trigger (an initiator must hold the
chairperson/secretary office; leaving `pending_approval` needs a treasurer approval by someone other than the
initiator; money can only move after Kitabu Yetu's approval). The generic `/api/v1/mpesa/disbursements/:id`
approve/reject refuses member disbursements.

## Accounting

`member_payout` template (default): `DR 4001 Member Contributions / CR 1001 Cash` for the amount, plus
`DR 5001 / CR 1001` for the M-Pesa fee. 4001 is where `postContributionJournal` books contributions by default, so a
payout reverses the same account. A group that routes savings to `2101 Member Savings` remaps the debit line via the
posting-template override. Bank transfers credit 1002.

- **Atomicity.** Cash/bank: journal, `journal_entry_id`, reservation release and `completed` commit together; any
  failure (e.g. a missing account) rolls all of it back and the row stays `awaiting_platform`. M-Pesa: journal and
  `completed` are written in the result callback's transaction.
- **One reference.** `KY-DIS-000123` is on the disbursement, the journal entry, and the member passbook row.
- **Member balance.** Savings = completed contributions − completed `savings_withdrawal` disbursements.
  Withdrawable savings also subtracts in-flight ones, so the same savings can't be paid twice.
- **Concurrency.** Initiation locks the source account (`lock_group_cash_account`) and reserves the amount, so
  concurrent requests can't jointly exceed available funds; approvals lock the row (`FOR UPDATE` + status check), so
  a double or concurrent approval executes once.
- **Idempotency.** `Idempotency-Key` header on submit; callback replays and reposts are no-ops
  (`journal_entry_id` check); notifications are deduplicated by the trigger engine.

## Reconciliation

`GET /api/v1/member-payouts/reconciliation` checks every completed disbursement has a posted journal for the same
member whose amount lines equal what was paid. Issues: `missing_journal`, `journal_voided`, `amount_mismatch`,
`outcome_unknown` (M-Pesa timed out). `POST` re-posts missing journals (M-Pesa only — money already left).
The only way to get `missing_journal` is an M-Pesa payout whose group chart lacks a template account; the money has
left, so the row is marked completed and flagged rather than lost.

## API

| Route                                                                      | Who                                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `GET/POST /api/v1/member-payouts`                                          | officers (`member_payouts.manage`); POST: chairperson/secretary  |
| `GET/POST /api/v1/member-payouts/:id`                                      | detail + audit; `approve`/`reject` treasurer, `cancel` initiator |
| `GET /api/v1/member-payouts/eligibility?memberId=`                         | form pre-flight                                                  |
| `GET/POST /api/v1/member-payouts/reconciliation`                           | officers                                                         |
| `GET /api/admin/member-payouts`, `POST …/:id/approve`, `POST …/:id/reject` | super_admin                                                      |

UI: `/payouts` (group), `/admin/disbursements` (Kitabu Yetu). Members see completed and in-progress disbursements
in their passbook.

## Cashless rollout status

- **New member payout requests are M-Pesa-only.** The server schema rejects `cash` and `bank_transfer` for new submissions; the form does not offer those methods.
- Historical cash and bank-transfer rows remain readable and auditable. They are not deleted or rewritten. Any legacy request still awaiting platform sign-off is blocked and should be declined; ask the group to resubmit via M-Pesa.
- Bank-transfer automation through KCB Buni is a separate integration phase. Do not mark a new bank payout complete until the provider confirms the transfer and reconciliation is in place.

## Known limits / follow-ups

- Legacy cash and bank rows were recorded as paid at Kitabu Yetu's sign-off; this historic behavior is retained for audit display, not offered for new requests.
- Supporting documents: the codebase has no document-attachment store for group transactions; minutes or
  references go in **notes** / **payment reference**.
- "Request correction" is reject-with-reason followed by a new submission.
- A failed M-Pesa dispatch (Daraja refused the POST) releases the funds and shows as failed; no SMS is sent for it.


## Cashless inflows and outflows (PR #245)

- New member payout requests are M-Pesa only; platform sign-off for legacy cash/bank payouts is blocked.
- Manual contribution entry creates pending obligations only; manual contribution CSV import/preview/commit is disabled.
- Contribution entry creates a pending obligation only. A client cannot submit an M-Pesa receipt or mark a contribution completed; only a verified provider callback/status confirmation can settle it.
- Existing historical cash records are preserved for audit/reporting and are not automatically rewritten or deleted.
- Manually typed M-Pesa receipt/reference values are rejected by the contribution, welfare, loan, share, dividend, billing, payout, and reconciliation entry points; a reference is not proof of settlement.

- Manual journal creation and draft posting reject account 1001 (the legacy Cash/M-Pesa combined account) and accounts named Cash, Petty Cash, or Cash on Hand. Posting revalidates older drafts, so a draft created before the guard cannot be posted into a cash account. Historical posted journals remain unchanged.


## Group-wide mobile-money-only payment entry

New group-member financial payment records must not be entered or marked paid as cash, cheque, bank transfer, standing order, or other offline method. This applies to contributions, welfare pool payments and welfare disbursements, loan repayments and disbursements, share purchases/redemptions, dividend allocations, member payouts, and invoice payments. Historical cash/bank records remain readable and are not rewritten.

**No manual M-Pesa receipt entry is permitted.** A group leader, treasurer, platform administrator, or other client must not type a receipt/reference to create, complete, reconcile, or post a payment. Contribution forms can create pending obligations only. Completed inflows/outflows are created by verified M-Pesa provider callbacks or an equivalent provider status confirmation. Manual contribution CSV imports and manual invoice-payment entry are disabled.

The only human correction path is the existing audited reallocation workflow for an already-recorded provider-confirmed M-Pesa payment. It requires the immutable payment ID and verifies completed status, M-Pesa method, matching receipt, group, and amount. The original provider evidence is preserved; corrections are audited, idempotent, and subject to maker-checker approval above the configured threshold. This workflow currently covers M-Pesa-linked savings contributions only.

Unrouted receipts cannot be manually allocated to a member or used to activate a subscription. They may only be dismissed after review; a correction must use the eligible audited reallocation path. Manual share purchases/redemptions and dividend payment posting remain disabled until provider-backed allocation/disbursement flows are implemented. This phase does not implement KCB Buni transfer execution.
