/**
 * Posting templates (ACCOUNTING_ARCHITECTURE_AUDIT.md §29.9 — called out as
 * the single highest-leverage architectural change in the audit's target
 * architecture, and #2 in §29.13's foundational ordering): which accounts a
 * business event posts to becomes Configuration Service data instead of
 * hardcoded account-code pairs inside each module's service.
 *
 * First rollout: every postSystemJournal call site (the Shares / Welfare /
 * Dividends / Subscriptions / write-off postings wired into the GL when §7
 * was closed). Each event's template is seeded platform-wide (migration 090)
 * to EXACTLY the mapping previously hardcoded, so resolution changes zero
 * posting behavior until a tenant actually remaps an account.
 *
 * Overrides may only REMAP ACCOUNTS — the line structure (each line's side
 * and amount role) is locked to the platform default's shape. That's the
 * audit's actual ask ("organizations map these templates to the specific
 * accounts in their own chart of accounts"), and it's what keeps a template
 * override from ever unbalancing an entry: balance comes from the role
 * structure (e.g. gross = net + tax), which no override can touch.
 *
 * Second rollout: loan disbursement/repayment (postLoanDisbursementJournal/
 * postLoanRepaymentJournal, moved here from accounting.service.ts — they now
 * belong here, not in the lower-level posting primitive that file hosts).
 * These turned out to be bounded, conditional-shape (2-3 lines each), not
 * truly variable — unlike contribution splits (accounting.service.ts's
 * postContributionJournal), whose credit-line count is genuinely unbounded
 * (one per distinct account a group's active group_contribution_splits rows
 * resolve to). Contribution splits stay OUT of this engine deliberately:
 * group_contribution_splits already gives groups equivalent per-tenant
 * configurability today, just via its own dedicated table rather than this
 * generic one, and forcing an unbounded line count into this engine's fixed
 * (side, amount-role) shape would need new repeating-line-group machinery
 * this round doesn't build.
 *
 * Loan disbursement's one wrinkle: today, if a charge is passed but the fee
 * account doesn't exist in a group's chart, posting silently drops just the
 * fee and still posts principal/cash — this engine's postSystemJournal is
 * all-or-nothing (any missing referenced account aborts the whole entry).
 * postLoanDisbursementJournal below preserves the fallback itself (checking
 * the *resolved* charge-role account before deciding whether to pass a zero
 * charge amount) rather than adding an "optional line" concept to the core
 * engine — buildTemplateLines already drops zero-amount lines, so no engine
 * change was needed once the wrapper does that check tenant-aware.
 */
import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { resolvePolicy, resolvePolicyDetailed, setPolicy, type PolicySource } from './configuration.service';
import { postSystemJournal, DEFAULT_ACCOUNTS, type SystemJournalLine } from './accounting.service';
import { ValidationError } from '@/lib/utils/errors';

const DOMAIN = 'accounting';
const keyFor = (event: PostingEvent) => `posting_template.${event}`;

export type PostingEvent =
  | 'share_purchase'
  | 'share_redemption'
  | 'welfare_disbursement'
  | 'welfare_pool_contribution'
  | 'dividend_declaration'
  | 'dividend_payment'
  | 'subscription_payment'
  | 'loan_writeoff'
  | 'loan_disbursement'
  | 'loan_repayment'
  | 'settlement_sweep'
  | 'vendor_payment';

export interface TemplateLine {
  accountCode: string;
  side:        'debit' | 'credit';
  /** Which named amount this line posts — 'amount' for single-amount events. */
  amount:      string;
}

export interface PostingTemplate {
  lines: TemplateLine[];
}

// Kept identical to migration 090's seed — each entry is the exact mapping
// the call sites hardcoded before templates existed.
export const DEFAULT_TEMPLATES: Record<PostingEvent, PostingTemplate> = {
  share_purchase: { lines: [
    { accountCode: '1001', side: 'debit',  amount: 'amount' },
    { accountCode: '3001', side: 'credit', amount: 'amount' },
  ]},
  share_redemption: { lines: [
    { accountCode: '3001', side: 'debit',  amount: 'amount' },
    { accountCode: '1001', side: 'credit', amount: 'amount' },
  ]},
  welfare_disbursement: { lines: [
    { accountCode: '2102', side: 'debit',  amount: 'amount' },
    { accountCode: '1001', side: 'credit', amount: 'amount' },
  ]},
  welfare_pool_contribution: { lines: [
    { accountCode: '1001', side: 'debit',  amount: 'amount' },
    { accountCode: '2102', side: 'credit', amount: 'amount' },
  ]},
  // gross = net + tax is guaranteed by the dividend computation itself; a
  // zero tax simply drops the 2104 line (see buildTemplateLines).
  dividend_declaration: { lines: [
    { accountCode: '3101', side: 'debit',  amount: 'gross' },
    { accountCode: '2103', side: 'credit', amount: 'net' },
    { accountCode: '2104', side: 'credit', amount: 'tax' },
  ]},
  dividend_payment: { lines: [
    { accountCode: '2103', side: 'debit',  amount: 'net' },
    { accountCode: '1001', side: 'credit', amount: 'net' },
  ]},
  subscription_payment: { lines: [
    { accountCode: '5003', side: 'debit',  amount: 'amount' },
    { accountCode: '1001', side: 'credit', amount: 'amount' },
  ]},
  loan_writeoff: { lines: [
    { accountCode: '5004', side: 'debit',  amount: 'outstanding' },
    { accountCode: '1101', side: 'credit', amount: 'outstanding' },
  ]},
  // Today's single combined "CR cash principal+charge" line becomes two
  // separate lines (principal-credit, charge-credit) here, both to 1001 —
  // legal (no per-entry uniqueness constraint on account) and nets to the
  // identical account balance, just one more row in the journal detail view.
  loan_disbursement: { lines: [
    { accountCode: '1101', side: 'debit',  amount: 'principal' },
    { accountCode: '1001', side: 'credit', amount: 'principal' },
    { accountCode: '5001', side: 'debit',  amount: 'charge' },
    { accountCode: '1001', side: 'credit', amount: 'charge' },
  ]},
  loan_repayment: { lines: [
    { accountCode: '1001', side: 'debit',  amount: 'principal' },
    { accountCode: '1101', side: 'credit', amount: 'principal' },
    { accountCode: '1001', side: 'debit',  amount: 'interest' },
    { accountCode: '4002', side: 'credit', amount: 'interest' },
  ]},
  // Bank Accounts / Settlements / Vendor Payments rebuild. Matches migration
  // 134's policies seed exactly — see postSettlementSweepJournal/
  // postVendorPaymentJournal below for the wrapper functions.
  settlement_sweep: { lines: [
    { accountCode: '1002', side: 'debit',  amount: 'amount' },
    { accountCode: '1001', side: 'credit', amount: 'amount' },
    { accountCode: '5001', side: 'debit',  amount: 'fee' },
    { accountCode: '1001', side: 'credit', amount: 'fee' },
  ]},
  // accountCode here is the *default* — postVendorPaymentJournal overrides
  // the resolved expense-role line's account with the payment row's own
  // expense_account_code before building lines (per-row, not per-tenant).
  vendor_payment: { lines: [
    { accountCode: '5001', side: 'debit',  amount: 'amount' },
    { accountCode: '1001', side: 'credit', amount: 'amount' },
    { accountCode: '5001', side: 'debit',  amount: 'fee' },
    { accountCode: '1001', side: 'credit', amount: 'fee' },
  ]},
};

export const POSTING_EVENTS = Object.keys(DEFAULT_TEMPLATES) as PostingEvent[];

/**
 * Pure line builder: applies named amounts to a template. Zero-valued lines
 * are dropped (a dividend declaration with no withholding tax posts two
 * lines, not three); a role the caller didn't supply is a programming error.
 * `invert` swaps every line's side — used by reversal postings so a reversal
 * always mirrors whatever mapping the original event resolves to.
 */
export function buildTemplateLines(
  template: PostingTemplate,
  amounts:  Record<string, number>,
  opts?:    { invert?: boolean },
): SystemJournalLine[] {
  const lines: SystemJournalLine[] = [];
  for (const line of template.lines) {
    const value = amounts[line.amount];
    if (value === undefined) {
      throw new ValidationError(`Posting template references amount '${line.amount}' which was not supplied`);
    }
    if (!(value >= 0)) {
      throw new ValidationError(`Posting amount '${line.amount}' must be zero or positive`);
    }
    if (value === 0) continue;
    const side = opts?.invert
      ? (line.side === 'debit' ? 'credit' : 'debit')
      : line.side;
    lines.push({ accountCode: line.accountCode, [side]: value });
  }
  return lines;
}

/** Used inline by posting paths — resolves the group's effective template for an event. */
export async function resolvePostingTemplate(
  client: PoolClient,
  event:  PostingEvent,
  scope:  { organizationId?: string | null; groupId?: string | null },
): Promise<PostingTemplate> {
  return resolvePolicy<PostingTemplate>(client, DOMAIN, keyFor(event), scope, DEFAULT_TEMPLATES[event]);
}

/**
 * The template-driven replacement for calling postSystemJournal with
 * hardcoded lines: resolves the group's effective template for the event,
 * builds the lines from the named amounts, and posts within the caller's
 * transaction. Same missing-account tolerance as postSystemJournal (logs and
 * returns null rather than failing the business transaction).
 */
export async function postTemplatedJournal(
  client:      PoolClient,
  groupId:     string,
  userId:      string | null,
  event:       PostingEvent,
  description: string,
  amounts:     Record<string, number>,
  opts?: {
    reference?: string; memberId?: string; groupMembershipId?: string;
    entryDate?: string; isTest?: boolean; invert?: boolean;
  },
): Promise<string | null> {
  const template = await resolvePostingTemplate(client, event, { groupId });
  const lines = buildTemplateLines(template, amounts, { invert: opts?.invert });
  if (lines.length === 0) return null;
  const { invert: _invert, ...journalOpts } = opts ?? {};
  return postSystemJournal(client, groupId, userId, description, lines, journalOpts);
}

const toDateString = (d: string | Date): string => typeof d === 'string' ? d : d.toISOString().slice(0, 10);

/**
 * Posts a loan disbursement: DR Loans Receivable (principal) [+ DR fee
 * expense (Safaricom charge), when a charge is passed and the resolved
 * template's charge-role account exists] / CR Cash (principal [+ charge]).
 * Moved here from accounting.service.ts (§29.9 second rollout — see file
 * header) so the account mapping is template-driven rather than hardcoded.
 *
 * Preserves the pre-templating fallback: postSystemJournal is all-or-nothing
 * (any missing referenced account aborts the whole entry), which would turn
 * "posts principal-only when the fee account is missing" into "doesn't post
 * at all." Checking the resolved charge-role account here and zeroing the
 * charge amount when it's missing gets the same graceful degradation via
 * buildTemplateLines' existing zero-amount-drops-the-line behavior — no
 * change to the shared engine needed.
 */
export async function postLoanDisbursementJournal(
  client: PoolClient,
  args: {
    groupId: string; loanId: string; principal: number; charge?: number;
    entryDate: string | Date; reference?: string | null; createdBy: string | null; isTest?: boolean;
  },
): Promise<{ journalEntryId: string; chargePosted: boolean } | null> {
  const charge = args.charge ?? 0;
  const template = await resolvePostingTemplate(client, 'loan_disbursement', { groupId: args.groupId });

  let postCharge = charge > 0;
  if (postCharge) {
    const chargeCodes = [...new Set(
      template.lines.filter((l) => l.amount === 'charge').map((l) => l.accountCode),
    )];
    const { rows } = await client.query<{ account_code: string }>(
      `SELECT account_code FROM accounts WHERE group_id = $1 AND account_code = ANY($2) AND is_active = true`,
      [args.groupId, chargeCodes],
    );
    postCharge = rows.length === chargeCodes.length;
  }

  const lines = buildTemplateLines(template, { principal: args.principal, charge: postCharge ? charge : 0 });
  if (lines.length === 0) return null;

  const { rows: loanRows } = await client.query<{ member_id: string | null; group_membership_id: string | null }>(
    `SELECT member_id, group_membership_id FROM loans WHERE id = $1`, [args.loanId],
  );

  const jeId = await postSystemJournal(
    client, args.groupId, args.createdBy, `Loan disbursement — ${args.loanId}`, lines,
    {
      reference:         args.reference ?? undefined,
      memberId:          loanRows[0]?.member_id ?? undefined,
      groupMembershipId: loanRows[0]?.group_membership_id ?? undefined,
      entryDate:         toDateString(args.entryDate),
      isTest:            args.isTest,
    },
  );
  if (!jeId) return null;

  await client.query(`UPDATE loans SET journal_entry_id = $1 WHERE id = $2`, [jeId, args.loanId]);
  return { journalEntryId: jeId, chargePosted: postCharge };
}

/**
 * Posts a loan repayment: DR Cash (full amount received) / CR Loans
 * Receivable (principal portion) + CR Interest Income (interest portion,
 * omitted when zero). Moved here from accounting.service.ts (§29.9 second
 * rollout). Needs no fallback wrinkle like disbursement's: today, a missing
 * interest account with a nonzero interest portion already aborts the whole
 * entry, which is exactly postSystemJournal's default all-or-nothing
 * behavior — a clean drop-in.
 */
export async function postLoanRepaymentJournal(
  client: PoolClient,
  args: {
    groupId: string; repaymentId: string; loanId: string;
    principalPortion: number; interestPortion: number;
    entryDate: string | Date; reference?: string | null; createdBy: string | null; isTest?: boolean;
  },
): Promise<string | null> {
  const template = await resolvePostingTemplate(client, 'loan_repayment', { groupId: args.groupId });
  const lines = buildTemplateLines(template, { principal: args.principalPortion, interest: args.interestPortion });
  if (lines.length === 0) return null;

  const { rows: repaymentRows } = await client.query<{ member_id: string | null; group_membership_id: string | null }>(
    `SELECT member_id, group_membership_id FROM loan_repayments WHERE id = $1`, [args.repaymentId],
  );

  const jeId = await postSystemJournal(
    client, args.groupId, args.createdBy, `Loan repayment — ${args.loanId} #${args.repaymentId}`, lines,
    {
      reference:         args.reference ?? undefined,
      memberId:          repaymentRows[0]?.member_id ?? undefined,
      groupMembershipId: repaymentRows[0]?.group_membership_id ?? undefined,
      entryDate:         toDateString(args.entryDate),
      isTest:            args.isTest,
    },
  );
  if (!jeId) return null;

  await client.query(`UPDATE loan_repayments SET journal_entry_id = $1 WHERE id = $2`, [jeId, args.repaymentId]);
  return jeId;
}

/**
 * Posts a settlement sweep: DR Bank Account (1002) / CR Cash (1001), plus
 * the Safaricom B2B fee (DR expense / CR cash), when a fee is passed and the
 * resolved fee-role account exists — same graceful-degradation shape as
 * postLoanDisbursementJournal's charge handling.
 */
export async function postSettlementSweepJournal(
  client: PoolClient,
  args: {
    groupId: string; settlementId: string; amount: number; fee?: number;
    entryDate: string | Date; reference?: string | null; createdBy: string | null; isTest?: boolean;
  },
): Promise<string | null> {
  const fee = args.fee ?? 0;
  const template = await resolvePostingTemplate(client, 'settlement_sweep', { groupId: args.groupId });

  let postFee = fee > 0;
  if (postFee) {
    const feeCodes = [...new Set(template.lines.filter((l) => l.amount === 'fee').map((l) => l.accountCode))];
    const { rows } = await client.query<{ account_code: string }>(
      `SELECT account_code FROM accounts WHERE group_id = $1 AND account_code = ANY($2) AND is_active = true`,
      [args.groupId, feeCodes],
    );
    postFee = rows.length === feeCodes.length;
  }

  const lines = buildTemplateLines(template, { amount: args.amount, fee: postFee ? fee : 0 });
  if (lines.length === 0) return null;

  const jeId = await postSystemJournal(
    client, args.groupId, args.createdBy, `Settlement sweep — ${args.settlementId}`, lines,
    {
      reference:  args.reference ?? undefined,
      entryDate:  toDateString(args.entryDate),
      isTest:     args.isTest,
    },
  );
  if (!jeId) return null;

  await client.query(`UPDATE settlement_requests SET journal_entry_id = $1 WHERE id = $2`, [jeId, args.settlementId]);
  return jeId;
}

/**
 * Posts a vendor payment: DR the row's own expense_account_code (per-row
 * override, not a tenant-level template remap — resolved into the
 * template's 'amount'-role line before building) / CR Cash, plus the same
 * graceful-degradation fee handling as postSettlementSweepJournal.
 *
 * The override account was already validated to exist in the group's active
 * chart at payment-creation time (vendor-payments.service.ts) — never
 * deferred to here. If it was deactivated in between, postSystemJournal's
 * all-or-nothing behavior drops the whole entry (not just the fee line,
 * since expense is the main line) and this returns null; the caller logs
 * that as a reconciliation gap rather than treating it as the payment
 * itself failing (the money already moved via Daraja by the time this runs).
 */
export async function postVendorPaymentJournal(
  client: PoolClient,
  args: {
    groupId: string; vendorPaymentId: string; amount: number; fee?: number;
    expenseAccountCode: string;
    entryDate: string | Date; reference?: string | null; createdBy: string | null; isTest?: boolean;
  },
): Promise<string | null> {
  const fee = args.fee ?? 0;
  const template = await resolvePostingTemplate(client, 'vendor_payment', { groupId: args.groupId });
  const overriddenLines = template.lines.map((l) =>
    l.amount === 'amount' && l.side === 'debit' ? { ...l, accountCode: args.expenseAccountCode } : l,
  );

  let postFee = fee > 0;
  if (postFee) {
    const feeCodes = [...new Set(overriddenLines.filter((l) => l.amount === 'fee').map((l) => l.accountCode))];
    const { rows } = await client.query<{ account_code: string }>(
      `SELECT account_code FROM accounts WHERE group_id = $1 AND account_code = ANY($2) AND is_active = true`,
      [args.groupId, feeCodes],
    );
    postFee = rows.length === feeCodes.length;
  }

  const lines = buildTemplateLines({ lines: overriddenLines }, { amount: args.amount, fee: postFee ? fee : 0 });
  if (lines.length === 0) return null;

  const jeId = await postSystemJournal(
    client, args.groupId, args.createdBy, `Vendor payment — ${args.vendorPaymentId}`, lines,
    {
      reference:  args.reference ?? undefined,
      entryDate:  toDateString(args.entryDate),
      isTest:     args.isTest,
    },
  );
  if (!jeId) return null;

  await client.query(`UPDATE vendor_payments SET journal_entry_id = $1 WHERE id = $2`, [jeId, args.vendorPaymentId]);
  return jeId;
}

/**
 * Structure lock: an override must keep the default's exact multiset of
 * (side, amount-role) pairs — only account codes may change. This is what
 * makes overrides safe to expose to tenants: they can redirect an event to a
 * different account, never restructure the entry.
 */
function validateOverrideStructure(event: PostingEvent, lines: TemplateLine[]): void {
  const shape = (ls: TemplateLine[]) =>
    ls.map((l) => `${l.side}:${l.amount}`).sort().join('|');
  const expected = DEFAULT_TEMPLATES[event].lines;
  if (lines.length !== expected.length || shape(lines) !== shape(expected)) {
    throw new ValidationError(
      'A posting-template override may only remap accounts — the entry structure (sides and amount roles) is fixed',
    );
  }
  for (const l of lines) {
    if (!/^\d{4}$/.test(l.accountCode)) {
      throw new ValidationError(`'${l.accountCode}' is not a valid 4-digit account code`);
    }
  }
}

async function assertCodesExistInGroupCoa(client: PoolClient, groupId: string, lines: TemplateLine[]): Promise<void> {
  const codes = [...new Set(lines.map((l) => l.accountCode))];
  const { rows } = await client.query<{ account_code: string }>(
    `SELECT account_code FROM accounts WHERE group_id = $1 AND account_code = ANY($2) AND is_active = true`,
    [groupId, codes],
  );
  const found = new Set(rows.map((r) => r.account_code));
  const missing = codes.filter((c) => !found.has(c));
  if (missing.length > 0) {
    throw new ValidationError(`Account code(s) not in your chart of accounts: ${missing.join(', ')}`);
  }
}

export interface EffectiveTemplate {
  event:  PostingEvent;
  lines:  TemplateLine[];
  source: PolicySource;
}

export const postingTemplatesService = {
  /** Every event's effective template for the caller's group, with provenance. */
  async getGroupTemplates(ctx: TenantContext): Promise<EffectiveTemplate[]> {
    return withDb(ctx, async (client) => {
      const results: EffectiveTemplate[] = [];
      for (const event of POSTING_EVENTS) {
        const resolved = await resolvePolicyDetailed<PostingTemplate>(
          client, DOMAIN, keyFor(event), { groupId: ctx.groupId }, DEFAULT_TEMPLATES[event],
        );
        results.push({ event, lines: resolved.value.lines, source: resolved.source });
      }
      return results;
    });
  },

  /** Access gated at the route (withRole(req, 'treasurer', ...)) — same bar as the chart of accounts itself. */
  async setGroupOverride(ctx: TenantContext, event: PostingEvent, lines: TemplateLine[]): Promise<void> {
    validateOverrideStructure(event, lines);
    await withTransaction(ctx, async (client) => {
      await assertCodesExistInGroupCoa(client, ctx.groupId, lines);
      await setPolicy(client, DOMAIN, keyFor(event), { groupId: ctx.groupId }, { lines }, ctx.userId);
    });
  },

  /** Platform-wide defaults — super_admin only (enforced at the route via withPlatformRole). */
  async getPlatformTemplates(client: PoolClient): Promise<EffectiveTemplate[]> {
    const results: EffectiveTemplate[] = [];
    for (const event of POSTING_EVENTS) {
      const resolved = await resolvePolicyDetailed<PostingTemplate>(
        client, DOMAIN, keyFor(event), {}, DEFAULT_TEMPLATES[event],
      );
      results.push({ event, lines: resolved.value.lines, source: resolved.source });
    }
    return results;
  },

  async setPlatformDefault(userId: string, client: PoolClient, event: PostingEvent, lines: TemplateLine[]): Promise<void> {
    validateOverrideStructure(event, lines);
    // Platform templates must stick to the standard seeded chart — every
    // group is guaranteed those codes, anything else would silently skip
    // posting (postSystemJournal's missing-account tolerance) somewhere.
    const standard = new Set(DEFAULT_ACCOUNTS.map((a) => a.code));
    const offenders = lines.filter((l) => !standard.has(l.accountCode));
    if (offenders.length > 0) {
      throw new ValidationError(
        `Platform-wide templates may only use standard chart codes; not standard: ${offenders.map((l) => l.accountCode).join(', ')}`,
      );
    }
    await setPolicy(client, DOMAIN, keyFor(event), {}, { lines }, userId);
  },
};
