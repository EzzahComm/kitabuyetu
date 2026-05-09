import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import type { Account, JournalEntry, JournalLine } from '@/types/db.types';
import type { CreateAccountInput, UpdateAccountInput, CreateJournalInput, VoidJournalInput } from '@/lib/validators/accounting.schema';
import type { TrialBalanceLine, ProfitAndLoss, BalanceSheet } from '@/types/api.types';

// Standard chart of accounts seeded for every new group
const DEFAULT_ACCOUNTS = [
  { code: '1001', name: 'Cash and M-Pesa',          type: 'asset' },
  { code: '1002', name: 'Bank Account',              type: 'asset' },
  { code: '1101', name: 'Loans Receivable',          type: 'asset' },
  { code: '1201', name: 'Fixed Assets',              type: 'asset' },
  { code: '2001', name: 'Accounts Payable',          type: 'liability' },
  { code: '2101', name: 'Member Savings',            type: 'liability' },
  { code: '3001', name: 'Member Equity',             type: 'equity' },
  { code: '3101', name: 'Retained Surplus',          type: 'equity' },
  { code: '4001', name: 'Member Contributions',      type: 'income' },
  { code: '4002', name: 'Interest Income — Loans',   type: 'income' },
  { code: '4003', name: 'Registration Fees',         type: 'income' },
  { code: '4004', name: 'Other Income',              type: 'income' },
  { code: '5001', name: 'Administrative Expenses',   type: 'expense' },
  { code: '5002', name: 'SMS Expenses',              type: 'expense' },
  { code: '5003', name: 'Platform Subscription',     type: 'expense' },
  { code: '5004', name: 'Loan Write-offs',           type: 'expense' },
];

export const accountingService = {

  async seedDefaultAccounts(ctx: TenantContext): Promise<void> {
    return withTransaction(ctx, async (client) => {
      for (const acct of DEFAULT_ACCOUNTS) {
        await client.query(
          `INSERT INTO accounts (group_id, account_code, name, type, is_system)
           VALUES ($1,$2,$3,$4,true)
           ON CONFLICT (group_id, account_code) DO NOTHING`,
          [ctx.groupId, acct.code, acct.name, acct.type],
        );
      }
    });
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
      return { ...je, lines: lineRows };
    });
  },

  async postJournalEntry(ctx: TenantContext, id: string): Promise<JournalEntry> {
    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query<JournalEntry>(
        `UPDATE journal_entries
         SET status = 'posted', posted_by = $1, posted_at = NOW()
         WHERE id = $2 AND group_id = $3 AND status = 'draft'
         RETURNING *`,
        [ctx.userId, id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Draft journal entry', id);
      return rows[0];
    });
  },

  async voidJournalEntry(ctx: TenantContext, id: string, data: VoidJournalInput): Promise<JournalEntry> {
    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query<JournalEntry>(
        `UPDATE journal_entries
         SET status = 'void', voided_by = $1, voided_at = NOW(), void_reason = $2
         WHERE id = $3 AND group_id = $4 AND status = 'posted'
         RETURNING *`,
        [ctx.userId, data.reason, id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Posted journal entry', id);
      return rows[0];
    });
  },

  async getTrialBalance(ctx: TenantContext): Promise<TrialBalanceLine[]> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<TrialBalanceLine>(
        `SELECT
           a.account_code  AS "accountCode",
           a.name          AS "accountName",
           a.type          AS "accountType",
           COALESCE(SUM(jl.debit),  0)::text AS "totalDebits",
           COALESCE(SUM(jl.credit), 0)::text AS "totalCredits",
           a.balance::text                   AS "netBalance"
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
           COALESCE(SUM(jl.credit) - SUM(jl.debit), 0)::text AS total
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
      const totalIncome   = income.reduce((s, r)   => s + parseFloat(r.amount),   0);
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
      const { rows } = await client.query<{
        account_code: string; account_name: string; type: string; balance: string;
      }>(
        `SELECT a.account_code, a.name AS account_name, a.type, a.balance::text
         FROM accounts a
         WHERE a.group_id = $1 AND a.type IN ('asset','liability','equity') AND a.is_active = true
         ORDER BY a.account_code`,
        [ctx.groupId],
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
