import { PoolClient } from 'pg';
import { withDb, withTransaction, withAdminDb, type TenantContext } from '@/lib/db';
import { logger } from '@/lib/logger';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';
import type { Account, JournalEntry, JournalLine } from '@/types/db.types';
import type { CreateAccountInput, UpdateAccountInput, CreateJournalInput, VoidJournalInput } from '@/lib/validators/accounting.schema';
import type { TrialBalanceLine, ProfitAndLoss, BalanceSheet } from '@/types/api.types';
import { loadActiveSplitRules } from './contribution-splits.service';
import { allocateSplit } from '@/lib/utils/split-allocator';
import { getEffectiveThreshold } from './approval-policy.service';

// Standard chart of accounts seeded for every new group. Exported so the
// posting-template engine can validate platform-wide templates against the
// codes every group is guaranteed to have.
export const DEFAULT_ACCOUNTS = [
  { code: '1001', name: 'Cash and M-Pesa',          type: 'asset' },
  { code: '1002', name: 'Bank Account',              type: 'asset' },
  { code: '1101', name: 'Loans Receivable',          type: 'asset' },
  { code: '1201', name: 'Fixed Assets',              type: 'asset' },
  { code: '2001', name: 'Accounts Payable',          type: 'liability' },
  { code: '2101', name: 'Member Savings',            type: 'liability' },
  { code: '2102', name: 'Welfare Fund',               type: 'liability' },
  { code: '2103', name: 'Dividends Payable',          type: 'liability' },
  { code: '2104', name: 'Withholding Tax Payable',    type: 'liability' },
  { code: '3001', name: 'Member Equity',             type: 'equity' },
  { code: '3101', name: 'Retained Surplus',          type: 'equity' },
  { code: '4001', name: 'Member Contributions',      type: 'income' },
  { code: '4002', name: 'Interest Income — Loans',   type: 'income' },
  { code: '4003', name: 'Registration Fees',         type: 'income' },
  { code: '4004', name: 'Other Income',              type: 'income' },
  { code: '4005', name: 'External Funding',          type: 'income' },
  { code: '5001', name: 'Administrative Expenses',   type: 'expense' },
  { code: '5002', name: 'SMS Expenses',              type: 'expense' },
  { code: '5003', name: 'Platform Subscription',     type: 'expense' },
  { code: '5004', name: 'Loan Write-offs',           type: 'expense' },
];

export interface SystemJournalLine {
  accountCode: string;
  debit?:      number;
  credit?:     number;
}

/**
 * Posts a balanced system-generated journal entry within the CALLER's own
 * transaction — takes an existing PoolClient rather than opening a new one,
 * so it participates atomically in whatever business transaction triggered
 * it (a share purchase, a welfare disbursement, …). Mirrors the direct
 * status='posted' insert pattern already used by contributions/loans/mpesa
 * services: relies on the migration-027 deferred constraint trigger to
 * validate the balance at COMMIT, since inserting already-posted bypasses
 * the draft→posted BEFORE UPDATE trigger (migration 009).
 *
 * ACCOUNTING_ARCHITECTURE_AUDIT.md §7/§10/§29.9: this is the shared posting
 * point for the modules the audit found were bypassing accounting entirely
 * (Shares, Welfare, Dividends, Subscriptions) — a lightweight stand-in for
 * the full posting-template engine §29.9 describes, scoped to what's needed
 * to close that specific finding without a larger architecture change.
 *
 * Missing chart-of-accounts rows are tolerated (logs a warning, posts
 * nothing, returns null) rather than failing the caller's real business
 * transaction — matches the existing settleOrgDisbursement() precedent for
 * the same reason.
 */
export async function postSystemJournal(
  client:      PoolClient,
  groupId:     string,
  userId:      string | null,
  description: string,
  lines:       SystemJournalLine[],
  opts?: {
    reference?: string; memberId?: string; groupMembershipId?: string;
    /** Defaults to CURRENT_DATE. Pass the source transaction's own date when it has one (e.g. a contribution's contribution_date). */
    entryDate?: string;
    /** Tags the entry so sandbox activity never mixes into production reports. Defaults to false. */
    isTest?: boolean;
  },
): Promise<string | null> {
  const codes = [...new Set(lines.map((l) => l.accountCode))];
  const { rows: accts } = await client.query<{ id: string; account_code: string }>(
    `SELECT id, account_code FROM accounts WHERE group_id = $1 AND account_code = ANY($2) AND is_active = true`,
    [groupId, codes],
  );
  const byCode = new Map(accts.map((a) => [a.account_code, a.id]));
  if (byCode.size !== codes.length) {
    logger.warn('[accounting] postSystemJournal: missing chart-of-accounts row(s), skipping posting', {
      groupId, description, missing: codes.filter((c) => !byCode.has(c)),
    });
    return null;
  }

  const { rows: je } = await client.query<{ id: string }>(
    `INSERT INTO journal_entries
       (group_id, entry_date, reference, description, status, created_by, member_id, group_membership_id, is_test, posted_via)
     VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, 'posted', $5, $6, $7, $8, $9) RETURNING id`,
    [
      groupId, opts?.entryDate ?? null, opts?.reference ?? null, description, userId,
      opts?.memberId ?? null, opts?.groupMembershipId ?? null,
      opts?.isTest ?? false, userId ? 'user' : 'system',
    ],
  );
  const jeId = je[0].id;

  for (const line of lines) {
    await client.query(
      `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit)
       VALUES ($1, $2, $3, $4, $5)`,
      [groupId, jeId, byCode.get(line.accountCode), (line.debit ?? 0).toFixed(2), (line.credit ?? 0).toFixed(2)],
    );
  }

  return jeId;
}

// ─── Unified contribution/loan posting (§6/§7 consolidation) ────────────────

/**
 * Posts a contribution's journal entry, splitting the credit side across
 * whatever income accounts the group has configured (group_contribution_splits)
 * — falling back to 100% Member Contributions (4001) when none are set.
 * Used by BOTH the manual entry path (contributions.service.ts) and every
 * M-Pesa-driven path (mpesa.service.ts) — previously two independently
 * written functions of the same name with different behavior (only the
 * M-Pesa one ran the split engine); this is the single implementation both
 * now share.
 *
 * Bespoke rather than built on postSystemJournal: a missing split-target
 * account falls back to the default account rather than aborting the whole
 * posting, which postSystemJournal's all-or-nothing missing-account check
 * doesn't support.
 */
export async function postContributionJournal(
  client: PoolClient,
  args: {
    groupId: string; contributionId: string; amount: number; entryDate: string | Date;
    reference?: string | null; createdBy: string | null; isTest?: boolean;
  },
): Promise<string | null> {
  const cashCode      = '1001';
  const defaultIncome = '4001';

  const rules       = await loadActiveSplitRules(client, args.groupId);
  const allocations = allocateSplit(args.amount, rules, defaultIncome);
  if (allocations.length === 0) return null; // amount <= 0 guard

  const neededCodes = Array.from(new Set([cashCode, ...allocations.map((a) => a.account_code)]));
  const { rows: accts } = await client.query<{ code: string; id: string }>(
    `SELECT account_code AS code, id FROM accounts WHERE group_id = $1 AND is_active = true AND account_code = ANY($2)`,
    [args.groupId, neededCodes],
  );
  const idByCode = new Map(accts.map((a) => [a.code, a.id]));

  const cashId = idByCode.get(cashCode);
  if (!cashId) {
    logger.warn('[accounting] skipped contribution journal — missing cash account 1001', { groupId: args.groupId });
    return null;
  }

  const creditByAccountId = new Map<string, number>();
  const defaultId = idByCode.get(defaultIncome);
  for (const alloc of allocations) {
    const targetId = idByCode.get(alloc.account_code) ?? defaultId;
    if (!targetId) {
      logger.warn('[accounting] skipped contribution journal — split target + default both missing', {
        groupId: args.groupId, code: alloc.account_code,
      });
      return null;
    }
    creditByAccountId.set(targetId, (creditByAccountId.get(targetId) ?? 0) + alloc.amount_cents);
  }

  // Ledger attribution (§6e): member + membership from the source document.
  const { rows: jeRows } = await client.query<{ id: string }>(
    `INSERT INTO journal_entries
       (group_id, entry_date, reference, description, status, created_by, posted_at, is_test,
        posted_via, member_id, group_membership_id)
     SELECT $1, $2, $3, $4, 'posted', $5, NOW(), $6, $7, c.member_id, c.group_membership_id
     FROM   contributions c WHERE c.id = $8
     RETURNING id`,
    [
      args.groupId, args.entryDate, args.reference ?? null,
      `Contribution — ${args.contributionId}`,
      args.createdBy, args.isTest ?? false, args.createdBy ? 'user' : 'system',
      args.contributionId,
    ],
  );
  const jeId = jeRows[0]?.id;
  if (!jeId) return null;

  await client.query(
    `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit) VALUES ($1,$2,$3,$4,0)`,
    [args.groupId, jeId, cashId, args.amount.toFixed(2)],
  );
  for (const [accountId, cents] of creditByAccountId) {
    await client.query(
      `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit) VALUES ($1,$2,$3,0,$4)`,
      [args.groupId, jeId, accountId, (cents / 100).toFixed(2)],
    );
  }

  await client.query(`UPDATE contributions SET journal_entry_id = $1 WHERE id = $2`, [jeId, args.contributionId]);
  return jeId;
}

/**
 * Posts a loan disbursement: DR Loans Receivable (principal) [+ DR Admin
 * Expense (Safaricom fee), when a charge is passed and the expense account
 * exists] / CR Cash (principal + fee). The manual (cash/bank) path passes no
 * charge; the B2C path folds in the real Safaricom fee — same posting
 * mechanics either way, so this is shared rather than duplicated per channel.
 */
export async function postLoanDisbursementJournal(
  client: PoolClient,
  args: {
    groupId: string; loanId: string; principal: number; charge?: number;
    entryDate: string | Date; reference?: string | null; createdBy: string | null; isTest?: boolean;
  },
): Promise<{ journalEntryId: string; chargePosted: boolean } | null> {
  const charge = args.charge ?? 0;
  const codes  = charge > 0 ? ['1001', '1101', '5001'] : ['1001', '1101'];
  const { rows: accts } = await client.query<{ code: string; id: string }>(
    `SELECT account_code AS code, id FROM accounts WHERE group_id = $1 AND is_active = true AND account_code = ANY($2)`,
    [args.groupId, codes],
  );
  const idByCode  = new Map(accts.map((a) => [a.code, a.id]));
  const cashId    = idByCode.get('1001');
  const recvId    = idByCode.get('1101');
  const expenseId = idByCode.get('5001');
  if (!cashId || !recvId) {
    logger.warn('[accounting] skipped loan disbursement journal — chart of accounts missing 1001/1101', { groupId: args.groupId });
    return null;
  }
  const postCharge = charge > 0 && !!expenseId;
  const cashCredit  = postCharge ? args.principal + charge : args.principal;

  const { rows: je } = await client.query<{ id: string }>(
    `INSERT INTO journal_entries
       (group_id, entry_date, reference, description, status, created_by, posted_at, is_test, posted_via, member_id, group_membership_id)
     SELECT $1, $2, $3, $4, 'posted', $5, NOW(), $6, $7, l.member_id, l.group_membership_id
     FROM   loans l WHERE l.id = $8
     RETURNING id`,
    [
      args.groupId, args.entryDate, args.reference ?? null, `Loan disbursement — ${args.loanId}`,
      args.createdBy, args.isTest ?? false, args.createdBy ? 'user' : 'system', args.loanId,
    ],
  );
  const jeId = je[0]?.id;
  if (!jeId) return null;

  await client.query(
    `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit)
     VALUES ($1,$2,$3,$4,0), ($1,$2,$5,0,$6)`,
    [args.groupId, jeId, recvId, args.principal.toFixed(2), cashId, cashCredit.toFixed(2)],
  );
  if (postCharge) {
    await client.query(
      `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit) VALUES ($1,$2,$3,$4,0)`,
      [args.groupId, jeId, expenseId, charge.toFixed(2)],
    );
  }

  await client.query(`UPDATE loans SET journal_entry_id = $1 WHERE id = $2`, [jeId, args.loanId]);
  return { journalEntryId: jeId, chargePosted: postCharge };
}

/**
 * Posts a loan repayment: DR Cash (full amount received) / CR Loans
 * Receivable (principal portion) + CR Interest Income (interest portion,
 * omitted when zero). Callers supply the principal/interest split already
 * computed — the manual path uses the installment's full scheduled split;
 * the M-Pesa waterfall path (which can apply a partial amount to an
 * installment) computes a proportional split so the entry always balances
 * against the actual cash amount applied.
 */
export async function postLoanRepaymentJournal(
  client: PoolClient,
  args: {
    groupId: string; repaymentId: string; loanId: string;
    principalPortion: number; interestPortion: number;
    entryDate: string | Date; reference?: string | null; createdBy: string | null; isTest?: boolean;
  },
): Promise<string | null> {
  const cashAmount = args.principalPortion + args.interestPortion;
  const codes = args.interestPortion > 0 ? ['1001', '1101', '4002'] : ['1001', '1101'];
  const { rows: accts } = await client.query<{ code: string; id: string }>(
    `SELECT account_code AS code, id FROM accounts WHERE group_id = $1 AND is_active = true AND account_code = ANY($2)`,
    [args.groupId, codes],
  );
  const idByCode = new Map(accts.map((a) => [a.code, a.id]));
  const cashId   = idByCode.get('1001');
  const recvId   = idByCode.get('1101');
  const intId    = idByCode.get('4002');
  if (!cashId || !recvId || (args.interestPortion > 0 && !intId)) {
    logger.warn('[accounting] skipped loan repayment journal — chart of accounts missing 1001/1101/4002', { groupId: args.groupId });
    return null;
  }

  const { rows: je } = await client.query<{ id: string }>(
    `INSERT INTO journal_entries
       (group_id, entry_date, reference, description, status, created_by, posted_at, is_test, posted_via, member_id, group_membership_id)
     SELECT $1, $2, $3, $4, 'posted', $5, NOW(), $6, $7, lr.member_id, lr.group_membership_id
     FROM   loan_repayments lr WHERE lr.id = $8
     RETURNING id`,
    [
      args.groupId, args.entryDate, args.reference ?? null,
      `Loan repayment — ${args.loanId} #${args.repaymentId}`,
      args.createdBy, args.isTest ?? false, args.createdBy ? 'user' : 'system', args.repaymentId,
    ],
  );
  const jeId = je[0]?.id;
  if (!jeId) return null;

  const lines: { accountId: string; debit: number; credit: number }[] = [
    { accountId: cashId, debit: cashAmount, credit: 0 },
    { accountId: recvId, debit: 0, credit: args.principalPortion },
  ];
  if (args.interestPortion > 0 && intId) {
    lines.push({ accountId: intId, debit: 0, credit: args.interestPortion });
  }
  for (const line of lines) {
    await client.query(
      `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit) VALUES ($1,$2,$3,$4,$5)`,
      [args.groupId, jeId, line.accountId, line.debit.toFixed(2), line.credit.toFixed(2)],
    );
  }

  await client.query(`UPDATE loan_repayments SET journal_entry_id = $1 WHERE id = $2`, [jeId, args.repaymentId]);
  return jeId;
}

async function writeJournalAuditLog(
  client: PoolClient,
  ctx:    TenantContext,
  action: string,
  journalEntryId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
     VALUES ($1, $2, $3, 'journal_entry', $4, $5::jsonb)`,
    [ctx.groupId, ctx.userId, action, journalEntryId, JSON.stringify(payload)],
  );
}

export const accountingService = {

  async seedDefaultAccounts(ctx: TenantContext): Promise<void> {
    return withTransaction(ctx, async (client) => {
      await accountingService.seedDefaultAccountsInTx(client, ctx.groupId);
    });
  },

  // Same as seedDefaultAccounts but participates in a caller-supplied transaction.
  // Used by the registration endpoint to keep onboarding atomic.
  async seedDefaultAccountsInTx(client: PoolClient, groupId: string): Promise<void> {
    for (const acct of DEFAULT_ACCOUNTS) {
      await client.query(
        `INSERT INTO accounts (group_id, account_code, name, type, is_system)
         VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (group_id, account_code) DO NOTHING`,
        [groupId, acct.code, acct.name, acct.type],
      );
    }
  },

  async listAccounts(ctx: TenantContext): Promise<Account[]> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<Account>(
        `SELECT * FROM accounts WHERE group_id = $1 ORDER BY account_code`,
        [ctx.groupId],
      );
      return rows;
    });
  },

  async createAccount(ctx: TenantContext, data: CreateAccountInput): Promise<Account> {
    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query<Account>(
        `INSERT INTO accounts (group_id, account_code, name, type, parent_id, description)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [ctx.groupId, data.accountCode, data.name, data.type, data.parentId ?? null, data.description ?? null],
      );
      return rows[0];
    });
  },

  async updateAccount(ctx: TenantContext, id: string, data: UpdateAccountInput): Promise<Account> {
    return withTransaction(ctx, async (client) => {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let   idx = 1;
      if (data.name        !== undefined) { sets.push(`name = $${idx++}`);       vals.push(data.name); }
      if (data.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(data.description); }
      if (data.isActive    !== undefined) { sets.push(`is_active = $${idx++}`);  vals.push(data.isActive); }
      if (!sets.length) throw new ValidationError('No fields to update');
      vals.push(id, ctx.groupId);
      const { rows } = await client.query<Account>(
        `UPDATE accounts SET ${sets.join(',')} WHERE id = $${idx} AND group_id = $${idx+1} AND is_system = false RETURNING *`,
        vals,
      );
      if (!rows[0]) throw new NotFoundError('Account', id);
      return rows[0];
    });
  },

  async createJournalEntry(ctx: TenantContext, data: CreateJournalInput): Promise<JournalEntry & { lines: JournalLine[] }> {
    return withTransaction(ctx, async (client) => {
      const { rows: jeRows } = await client.query<JournalEntry>(
        `INSERT INTO journal_entries (group_id, entry_date, reference, description, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [ctx.groupId, data.entryDate, data.reference ?? null, data.description, ctx.userId],
      );
      const je = jeRows[0];

      const lineRows: JournalLine[] = [];
      for (const line of data.lines) {
        const { rows } = await client.query<JournalLine>(
          `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit, description)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [ctx.groupId, je.id, line.accountId, line.debit.toFixed(2), line.credit.toFixed(2), line.description ?? null],
        );
        lineRows.push(rows[0]);
      }
      await writeJournalAuditLog(client, ctx, 'journal.created', je.id, {
        entryDate: data.entryDate, reference: data.reference ?? null, description: data.description,
        lineCount: lineRows.length,
      });
      return { ...je, lines: lineRows };
    });
  },

  async postJournalEntry(ctx: TenantContext, id: string): Promise<JournalEntry> {
    return withTransaction(ctx, async (client) => {
      const { rows: draftRows } = await client.query<JournalEntry>(
        `SELECT * FROM journal_entries WHERE id = $1 AND group_id = $2 AND status = 'draft' FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!draftRows[0]) throw new NotFoundError('Draft journal entry', id);

      // Maker-checker (ACCOUNTING_ARCHITECTURE_AUDIT.md §15): above the
      // group's threshold, the poster must differ from the creator. The DB
      // trigger (migration 081) is the authoritative backstop; this check
      // exists to surface a clean error instead of a raw constraint failure.
      if (draftRows[0].created_by === ctx.userId) {
        const threshold = await getEffectiveThreshold(client, 'journal_threshold', { groupId: ctx.groupId });
        const { rows: lineRows } = await client.query<{ total: string }>(
          `SELECT COALESCE(SUM(debit), 0)::text AS total FROM journal_lines WHERE journal_entry_id = $1`,
          [id],
        );
        const total = parseFloat(lineRows[0]?.total ?? '0');
        if (total > threshold) {
          throw new ForbiddenError(
            `Maker-checker: entries above KES ${threshold.toFixed(2)} must be posted by someone other than the creator`,
          );
        }
      }

      const { rows } = await client.query<JournalEntry>(
        `UPDATE journal_entries
         SET status = 'posted', posted_by = $1, posted_at = NOW()
         WHERE id = $2 AND group_id = $3 AND status = 'draft'
         RETURNING *`,
        [ctx.userId, id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Draft journal entry', id);
      await writeJournalAuditLog(client, ctx, 'journal.posted', id, { createdBy: draftRows[0].created_by });
      return rows[0];
    });
  },

  async voidJournalEntry(ctx: TenantContext, id: string, data: VoidJournalInput): Promise<JournalEntry> {
    return withTransaction(ctx, async (client) => {
      const { rows: postedRows } = await client.query<JournalEntry>(
        `SELECT * FROM journal_entries WHERE id = $1 AND group_id = $2 AND status = 'posted' FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!postedRows[0]) throw new NotFoundError('Posted journal entry', id);

      // Maker-checker: above the group's threshold, the voider must differ
      // from the poster — same reasoning and DB backstop as posting above.
      if (postedRows[0].posted_by === ctx.userId) {
        const threshold = await getEffectiveThreshold(client, 'journal_threshold', { groupId: ctx.groupId });
        const { rows: lineRows } = await client.query<{ total: string }>(
          `SELECT COALESCE(SUM(debit), 0)::text AS total FROM journal_lines WHERE journal_entry_id = $1`,
          [id],
        );
        const total = parseFloat(lineRows[0]?.total ?? '0');
        if (total > threshold) {
          throw new ForbiddenError(
            `Maker-checker: entries above KES ${threshold.toFixed(2)} must be voided by someone other than the poster`,
          );
        }
      }

      const { rows } = await client.query<JournalEntry>(
        `UPDATE journal_entries
         SET status = 'void', voided_by = $1, voided_at = NOW(), void_reason = $2
         WHERE id = $3 AND group_id = $4 AND status = 'posted'
         RETURNING *`,
        [ctx.userId, data.reason, id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Posted journal entry', id);
      await writeJournalAuditLog(client, ctx, 'journal.voided', id, { reason: data.reason, postedBy: postedRows[0].posted_by });
      return rows[0];
    });
  },

  async getTrialBalance(ctx: TenantContext): Promise<TrialBalanceLine[]> {
    return withDb(ctx, async (client) => {
      // netBalance: asset/expense accounts are debit-normal (positive balance stored as-is).
      // Credit-normal accounts (liability, equity, income) are stored as negative; negate for display.
      const { rows } = await client.query<TrialBalanceLine>(
        `SELECT
           a.account_code  AS "accountCode",
           a.name          AS "accountName",
           a.type          AS "accountType",
           COALESCE(SUM(jl.debit),  0)::text AS "totalDebits",
           COALESCE(SUM(jl.credit), 0)::text AS "totalCredits",
           CASE WHEN a.type IN ('asset','expense')
             THEN a.balance
             ELSE -a.balance
           END::text AS "netBalance"
         FROM accounts a
         LEFT JOIN journal_lines jl ON jl.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted'
         WHERE a.group_id = $1 AND a.is_active = true
         GROUP BY a.account_code, a.name, a.type, a.balance
         ORDER BY a.account_code`,
        [ctx.groupId],
      );
      return rows;
    });
  },

  async getProfitAndLoss(ctx: TenantContext, from: string, to: string): Promise<ProfitAndLoss> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<{
        account_code: string; account_name: string; type: string; total: string;
      }>(
        `SELECT
           a.account_code,
           a.name AS account_name,
           a.type,
           -- Income accounts are credit-normal: credit - debit gives positive balance.
           -- Expense accounts are debit-normal: debit - credit gives positive balance.
           -- Using the correct sign per account type so both totals are positive numbers,
           -- and netProfit = totalIncome - totalExpenses is computed correctly.
           CASE WHEN a.type = 'expense'
             THEN COALESCE(SUM(jl.debit) - SUM(jl.credit), 0)
             ELSE COALESCE(SUM(jl.credit) - SUM(jl.debit), 0)
           END::text AS total
         FROM accounts a
         LEFT JOIN journal_lines jl ON jl.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
           AND je.status = 'posted'
           AND je.entry_date BETWEEN $2 AND $3
         WHERE a.group_id = $1 AND a.type IN ('income','expense') AND a.is_active = true
         GROUP BY a.account_code, a.name, a.type
         ORDER BY a.account_code`,
        [ctx.groupId, from, to],
      );

      const income   = rows.filter(r => r.type === 'income').map(r => ({ accountCode: r.account_code, accountName: r.account_name, amount: r.total }));
      const expenses = rows.filter(r => r.type === 'expense').map(r => ({ accountCode: r.account_code, accountName: r.account_name, amount: r.total }));
      const totalIncome   = income.reduce((s, r)   => s + parseFloat(r.amount), 0);
      const totalExpenses = expenses.reduce((s, r) => s + parseFloat(r.amount), 0);

      return {
        period: { from, to },
        income, expenses,
        totalIncome:   totalIncome.toFixed(2),
        totalExpenses: totalExpenses.toFixed(2),
        netProfit:     (totalIncome - totalExpenses).toFixed(2),
      };
    });
  },

  async getBalanceSheet(ctx: TenantContext, asOf: string): Promise<BalanceSheet> {
    return withDb(ctx, async (client) => {
      // Computed from journal_lines as of the requested date — NOT the
      // denormalized accounts.balance column, which is always the *current*
      // running total and has no notion of "as of a past date". Same
      // debit-minus-credit convention the update_account_balance trigger
      // uses: assets (debit-normal) are positive as-is; liabilities/equity
      // (credit-normal) are negated for display.
      const { rows } = await client.query<{
        account_code: string; account_name: string; type: string; balance: string;
      }>(
        `SELECT
           a.account_code,
           a.name AS account_name,
           a.type,
           CASE WHEN a.type = 'asset'
             THEN COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE je.status = 'posted' AND je.entry_date <= $2), 0)
             ELSE -COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE je.status = 'posted' AND je.entry_date <= $2), 0)
           END::text AS balance
         FROM accounts a
         LEFT JOIN journal_lines jl ON jl.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE a.group_id = $1 AND a.type IN ('asset','liability','equity') AND a.is_active = true
         GROUP BY a.account_code, a.name, a.type
         ORDER BY a.account_code`,
        [ctx.groupId, asOf],
      );

      const toLine = (r: typeof rows[0]) => ({ accountCode: r.account_code, accountName: r.account_name, balance: r.balance });
      const assets      = rows.filter(r => r.type === 'asset').map(toLine);
      const liabilities = rows.filter(r => r.type === 'liability').map(toLine);
      const equity      = rows.filter(r => r.type === 'equity').map(toLine);

      return {
        asOf,
        assets, liabilities, equity,
        totalAssets:      assets.reduce((s, r)      => s + parseFloat(r.balance), 0).toFixed(2),
        totalLiabilities: liabilities.reduce((s, r) => s + parseFloat(r.balance), 0).toFixed(2),
        totalEquity:      equity.reduce((s, r)       => s + parseFloat(r.balance), 0).toFixed(2),
      };
    });
  },
};

// ─── Balance drift reconciliation (platform-wide scheduled job) ──────────────

export interface BalanceDriftResult {
  accountsChecked: number;
  driftsFound:     number;
}

interface DriftRow {
  account_id:   string;
  group_id:     string;
  account_code: string;
  name:         string;
  stored:       string;
  computed:     string;
}

/**
 * Audits the denormalized accounts.balance column against the source of
 * truth — SUM(debit - credit) over journal_lines of POSTED entries (the
 * exact convention the trg_journal_lines_update_balance trigger maintains).
 *
 * Detection only, no auto-remediation: silently rewriting a financial
 * balance would mask whatever caused the drift. Each drifted account is
 * logged and the full list is recorded as a 'balance_drift' run in
 * mpesa_reconciliations, which surfaces in the reconciliation history UI.
 */
export async function detectBalanceDrift(): Promise<BalanceDriftResult> {
  return withAdminDb(async (db) => {
    const { rows: countRows } = await db.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM accounts WHERE is_active = true`,
    );
    const accountsChecked = parseInt(countRows[0]?.n ?? '0', 10);

    const { rows: drifts } = await db.query<DriftRow>(
      `SELECT a.id AS account_id, a.group_id, a.account_code, a.name,
              a.balance::text AS stored,
              COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE je.status = 'posted'), 0)::text AS computed
       FROM   accounts a
       LEFT JOIN journal_lines   jl ON jl.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
       WHERE  a.is_active = true
       GROUP  BY a.id, a.group_id, a.account_code, a.name, a.balance
       HAVING ABS(a.balance - COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE je.status = 'posted'), 0)) > 0.005
       LIMIT  200`,
    );

    for (const d of drifts) {
      logger.error('[accounting] balance drift detected', {
        groupId:     d.group_id,
        accountCode: d.account_code,
        account:     d.name,
        stored:      d.stored,
        computed:    d.computed,
      });
    }

    await db.query(
      `INSERT INTO mpesa_reconciliations
         (group_id, initiated_by, status, reconciliation_type,
          transactions_checked, mismatches_found, resolved_count, details, completed_at)
       VALUES (NULL, NULL, 'completed', 'balance_drift', $1, $2, 0, $3, NOW())`,
      [accountsChecked, drifts.length, JSON.stringify(drifts)],
    );

    return { accountsChecked, driftsFound: drifts.length };
  });
}

// ─── GL-to-real-cash reconciliation (platform-wide scheduled job) ───────────

export interface GLCashReconciliationResult {
  status:        'ok' | 'mismatch' | 'no_snapshot' | 'stale_snapshot';
  glCashTotal?:  string;
  mpesaBalance?: string;
  difference?:   string;
  snapshotAge?:  string;
}

const GL_CASH_RECONCILE_TOLERANCE = 1; // KES — allows for sub-shilling rounding only
const GL_CASH_SNAPSHOT_MAX_AGE_HOURS = 36;

/**
 * ACCOUNTING_ARCHITECTURE_AUDIT.md §16 Critical finding: Daraja's own
 * AccountBalance figure was fetched and displayed on the treasury dashboard
 * but never compared to anything. All groups share one M-Pesa shortcode, so
 * the correct comparison is platform-wide: SUM of every group's "1001 Cash
 * and M-Pesa" GL account against the one real Daraja Working+Utility balance
 * — not a per-group comparison, since no single group's ledger represents
 * the whole paybill.
 *
 * Reads the latest completed balance_query row in mpesa_transactions (the
 * treasurer-triggered "Query balance" action on the treasury page — see
 * app/api/v1/mpesa/balance/route.ts). Detection only, same as
 * detectBalanceDrift: a mismatch is logged and recorded, never silently
 * "corrected".
 *
 * KNOWN GAP (tracked, not fixed here): the daily `mpesa_balance_snapshot`
 * cron job only fires the Daraja query (lib/jobs/handlers.ts
 * handleMpesaBalanceSnapshot) — it does not insert the placeholder
 * mpesa_transactions row the authenticated POST route inserts before
 * querying, so the async result callback (handleBalanceResult, matched by
 * originator_conversation_id) has no row to attach to and the scheduled
 * snapshot's result is silently dropped. mpesa_transactions.group_id is
 * NOT NULL, and there is no platform-level anchor group to attach a
 * shortcode-wide (not group-specific) query to — fixing that cleanly is a
 * schema decision (nullable group_id, or a dedicated platform-balance table)
 * outside this fix's scope. Until it's addressed, this reconciliation runs
 * against whichever group's treasurer most recently clicked "Query balance".
 */
export async function reconcileGLCashToMpesaBalance(): Promise<GLCashReconciliationResult> {
  return withAdminDb(async (db) => {
    const { rows: snapRows } = await db.query<{ raw_response: unknown; completed_at: string }>(
      `SELECT raw_response, completed_at FROM mpesa_transactions
       WHERE transaction_type = 'balance_query' AND status = 'completed'
       ORDER BY completed_at DESC LIMIT 1`,
    );
    if (!snapRows[0]) {
      logger.warn('[accounting] GL-to-cash reconciliation: no balance snapshot exists yet');
      return { status: 'no_snapshot' };
    }

    const ageHours = (Date.now() - new Date(snapRows[0].completed_at).getTime()) / 3_600_000;
    if (ageHours > GL_CASH_SNAPSHOT_MAX_AGE_HOURS) {
      logger.warn('[accounting] GL-to-cash reconciliation: latest balance snapshot is stale', {
        ageHours: ageHours.toFixed(1),
      });
      return { status: 'stale_snapshot', snapshotAge: `${ageHours.toFixed(1)}h` };
    }

    type ResultParam = { Key: string; Value: string | number };
    type BalResult = { Result?: { ResultParameters?: { ResultParameter?: ResultParam[] } } };
    const params = (snapRows[0].raw_response as BalResult).Result?.ResultParameters?.ResultParameter ?? [];
    const get = (k: string) => Number(params.find((p) => p.Key === k)?.Value ?? 0);
    const mpesaBalance = get('WorkingAccountAvailableFunds') + get('UtilityAccountAvailableFunds');

    const { rows: glRows } = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(balance), 0)::text AS total FROM accounts
       WHERE account_code = '1001' AND is_active = true`,
    );
    const glCashTotal = parseFloat(glRows[0]?.total ?? '0');
    const difference  = mpesaBalance - glCashTotal;

    if (Math.abs(difference) > GL_CASH_RECONCILE_TOLERANCE) {
      logger.error('[accounting] GL-to-cash mismatch detected', {
        glCashTotal: glCashTotal.toFixed(2), mpesaBalance: mpesaBalance.toFixed(2), difference: difference.toFixed(2),
      });
    }

    await db.query(
      `INSERT INTO mpesa_reconciliations
         (group_id, initiated_by, status, reconciliation_type,
          transactions_checked, mismatches_found, resolved_count, details, completed_at)
       VALUES (NULL, NULL, 'completed', 'gl_cash_mismatch', 1, $1, 0, $2, NOW())`,
      [
        Math.abs(difference) > GL_CASH_RECONCILE_TOLERANCE ? 1 : 0,
        JSON.stringify({ glCashTotal: glCashTotal.toFixed(2), mpesaBalance: mpesaBalance.toFixed(2), difference: difference.toFixed(2) }),
      ],
    );

    return {
      status:       Math.abs(difference) > GL_CASH_RECONCILE_TOLERANCE ? 'mismatch' : 'ok',
      glCashTotal:  glCashTotal.toFixed(2),
      mpesaBalance: mpesaBalance.toFixed(2),
      difference:   difference.toFixed(2),
    };
  });
}
