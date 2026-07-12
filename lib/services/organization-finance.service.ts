/**
 * Organization financial ecosystem — wallet, ledger, funding programs and
 * org → group disbursements (migration 055).
 *
 * Design invariants:
 *  - The wallet is the single money position; every movement appends an
 *    organization_ledger row carrying balance_after, so the ledger alone can
 *    reconstruct (and audit) the balance.
 *  - A disbursement is DUAL-LEDGER and atomic: org wallet debit + org ledger
 *    row + a balanced, posted journal entry in the receiving group's books
 *    (DR 1001 Cash / CR 4005 External Funding) — all in one transaction.
 *  - Access control is layered: routes require the organization_coordinator
 *    role, RLS scopes every table to app_current_organization_id(), and
 *    disbursements additionally require an active organization_group_access
 *    link — an organization can never fund (or see) an unrelated group.
 */
import type { PoolClient } from 'pg';
import crypto from 'crypto';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { organizationService } from './organization.service';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrgWallet {
  id:                string;
  organization_id:   string;
  currency:          string;
  available_balance: string;
  committed_balance: string;
  total_deposited:   string;
  total_disbursed:   string;
  total_returned:    string;
}

export interface FundingProgram {
  id:              string;
  name:            string;
  program_type:    string;
  funding_source:  string | null;
  description:     string | null;
  budget:          string;
  disbursed_total: string;
  currency:        string;
  starts_on:       string | null;
  ends_on:         string | null;
  status:          string;
  created_at:      string;
}

export interface OrgDisbursement {
  id:                 string;
  group_id:           string;
  group_name?:        string;
  funding_program_id: string | null;
  program_name?:      string | null;
  disbursement_type:  string;
  amount:             string;
  status:             string;
  reference:          string;
  notes:              string | null;
  created_at:         string;
}

const orgId = (ctx: TenantContext): string => {
  // super_admins may act on a specific organization passed via context.
  if (!ctx.organizationId) throw new ValidationError('Organization context is required');
  return ctx.organizationId;
};

async function getWalletForUpdate(db: PoolClient, organizationId: string): Promise<OrgWallet> {
  const { rows } = await db.query<OrgWallet>(
    `SELECT * FROM organization_wallets
     WHERE organization_id = $1 AND currency = 'KES' AND is_active
     FOR UPDATE`,
    [organizationId],
  );
  if (!rows[0]) throw new NotFoundError('Organization wallet');
  return rows[0];
}

export const organizationFinanceService = {

  // ─── Wallet ────────────────────────────────────────────────────────────────

  async getWallet(ctx: TenantContext): Promise<OrgWallet> {
    await organizationService.assertOrganizationCoordinator(ctx);
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<OrgWallet>(
        `SELECT * FROM organization_wallets
         WHERE organization_id = $1 AND currency = 'KES'`,
        [orgId(ctx)],
      );
      if (rows[0]) return rows[0];
      // Bootstrap lazily for organizations created before migration 055.
      const { rows: created } = await db.query<OrgWallet>(
        `INSERT INTO organization_wallets (organization_id) VALUES ($1)
         ON CONFLICT (organization_id, currency) DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [orgId(ctx)],
      );
      return created[0];
    });
  },

  /**
   * Records inbound capital (donor funding, grant capital, loan capital…).
   * M-Pesa / bank settlement is reconciled out-of-band for now; the ledger row
   * carries the external reference so reconciliation can bind them later.
   */
  async deposit(
    ctx: TenantContext,
    input: { amount: number; source?: string; reference?: string; notes?: string },
  ): Promise<{ wallet: OrgWallet; ledgerEntryId: string }> {
    await organizationService.assertOrganizationCoordinator(ctx);
    if (!(input.amount > 0)) throw new ValidationError('Deposit amount must be positive');

    return withTransaction(ctx, async (db) => {
      const wallet = await getWalletForUpdate(db, orgId(ctx));
      const newBalance = parseFloat(wallet.available_balance) + input.amount;

      const { rows: updated } = await db.query<OrgWallet>(
        `UPDATE organization_wallets
         SET available_balance = available_balance + $1,
             total_deposited   = total_deposited   + $1
         WHERE id = $2 RETURNING *`,
        [input.amount.toFixed(2), wallet.id],
      );

      const { rows: ledger } = await db.query<{ id: string }>(
        `INSERT INTO organization_ledger
           (organization_id, wallet_id, entry_type, direction, amount,
            balance_after, reference, description, created_by)
         VALUES ($1,$2,'deposit','credit',$3,$4,$5,$6,$7)
         RETURNING id`,
        [
          orgId(ctx), wallet.id, input.amount.toFixed(2), newBalance.toFixed(2),
          input.reference ?? null,
          input.notes ?? (input.source ? `Deposit — ${input.source}` : 'Deposit'),
          ctx.userId,
        ],
      );

      return { wallet: updated[0], ledgerEntryId: ledger[0].id };
    });
  },

  async listLedger(
    ctx: TenantContext,
    params: { page?: number; limit?: number } = {},
  ): Promise<{ items: unknown[]; total: number; page: number; limit: number }> {
    await organizationService.assertOrganizationCoordinator(ctx);
    const page  = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));

    return withDb(ctx, async (db) => {
      const { rows: countRows } = await db.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM organization_ledger WHERE organization_id = $1`,
        [orgId(ctx)],
      );
      const { rows } = await db.query(
        `SELECT l.*, g.name AS group_name, fp.name AS program_name
         FROM   organization_ledger l
         LEFT JOIN groups g            ON g.id  = l.group_id
         LEFT JOIN funding_programs fp ON fp.id = l.funding_program_id
         WHERE  l.organization_id = $1
         ORDER  BY l.created_at DESC
         LIMIT  $2 OFFSET $3`,
        [orgId(ctx), limit, (page - 1) * limit],
      );
      return { items: rows, total: parseInt(countRows[0]?.n ?? '0', 10), page, limit };
    });
  },

  // ─── Funding programs ──────────────────────────────────────────────────────

  async listPrograms(ctx: TenantContext): Promise<FundingProgram[]> {
    await organizationService.assertOrganizationCoordinator(ctx);
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<FundingProgram>(
        `SELECT * FROM funding_programs
         WHERE organization_id = $1
         ORDER BY status = 'active' DESC, created_at DESC`,
        [orgId(ctx)],
      );
      return rows;
    });
  },

  async createProgram(
    ctx: TenantContext,
    input: {
      name: string; programType: string; budget: number;
      fundingSource?: string; description?: string;
      eligibilityCriteria?: Record<string, unknown>;
      geographicCoverage?: string[];
      reportingRequirements?: string;
      startsOn?: string; endsOn?: string;
    },
  ): Promise<FundingProgram> {
    await organizationService.assertOrganizationCoordinator(ctx);
    if (!(input.budget > 0)) throw new ValidationError('Budget must be positive');

    return withTransaction(ctx, async (db) => {
      const { rows } = await db.query<FundingProgram>(
        `INSERT INTO funding_programs
           (organization_id, name, program_type, budget, funding_source, description,
            eligibility_criteria, geographic_coverage, reporting_requirements,
            starts_on, ends_on, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,'active',$12)
         RETURNING *`,
        [
          orgId(ctx), input.name, input.programType, input.budget.toFixed(2),
          input.fundingSource ?? null, input.description ?? null,
          JSON.stringify(input.eligibilityCriteria ?? {}),
          JSON.stringify(input.geographicCoverage ?? []),
          input.reportingRequirements ?? null,
          input.startsOn ?? null, input.endsOn ?? null,
          ctx.userId,
        ],
      );
      return rows[0];
    });
  },

  async updateProgramStatus(
    ctx: TenantContext,
    programId: string,
    status: 'active' | 'paused' | 'closed',
  ): Promise<FundingProgram> {
    await organizationService.assertOrganizationCoordinator(ctx);
    return withTransaction(ctx, async (db) => {
      const { rows } = await db.query<FundingProgram>(
        `UPDATE funding_programs SET status = $1
         WHERE id = $2 AND organization_id = $3
         RETURNING *`,
        [status, programId, orgId(ctx)],
      );
      if (!rows[0]) throw new NotFoundError('Funding program', programId);
      return rows[0];
    });
  },

  // ─── Disbursement (org → group, dual-ledger, atomic) ───────────────────────

  async disburse(
    ctx: TenantContext,
    input: {
      groupId: string;
      amount: number;
      disbursementType: string;
      fundingProgramId?: string;
      notes?: string;
    },
  ): Promise<OrgDisbursement> {
    await organizationService.assertOrganizationCoordinator(ctx);
    if (!(input.amount > 0)) throw new ValidationError('Disbursement amount must be positive');

    return withTransaction(ctx, async (db) => {
      const organizationId = orgId(ctx);

      // 1. Eligibility: the group must hold an active link to this organization.
      const { rows: access } = await db.query<{ id: string }>(
        `SELECT id FROM organization_group_access
         WHERE organization_id = $1 AND group_id = $2 AND is_active`,
        [organizationId, input.groupId],
      );
      if (!access[0]) throw new NotFoundError('Linked group', input.groupId);

      // 2. Funds: lock the wallet, require sufficient available balance.
      const wallet = await getWalletForUpdate(db, organizationId);
      const available = parseFloat(wallet.available_balance);
      if (available < input.amount) {
        throw new ValidationError(
          `Insufficient wallet balance (available KES ${available.toFixed(2)})`,
        );
      }

      // 3. Program budget guard (when funded from a program).
      if (input.fundingProgramId) {
        const { rows: prog } = await db.query<{ budget: string; disbursed_total: string; status: string }>(
          `SELECT budget, disbursed_total, status FROM funding_programs
           WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
          [input.fundingProgramId, organizationId],
        );
        if (!prog[0]) throw new NotFoundError('Funding program', input.fundingProgramId);
        if (prog[0].status !== 'active') throw new ValidationError('Funding program is not active');
        const remaining = parseFloat(prog[0].budget) - parseFloat(prog[0].disbursed_total);
        if (remaining < input.amount) {
          throw new ValidationError(`Program budget remaining is KES ${remaining.toFixed(2)}`);
        }
        await db.query(
          `UPDATE funding_programs SET disbursed_total = disbursed_total + $1 WHERE id = $2`,
          [input.amount.toFixed(2), input.fundingProgramId],
        );
      }

      // 4. Org side: wallet debit + ledger row.
      const reference = `ODB-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      const newBalance = available - input.amount;
      await db.query(
        `UPDATE organization_wallets
         SET available_balance = available_balance - $1,
             total_disbursed   = total_disbursed   + $1
         WHERE id = $2`,
        [input.amount.toFixed(2), wallet.id],
      );

      // 5. Group side: balanced, posted journal entry in the group's books.
      //    DR 1001 Cash / CR 4005 External Funding (fallback 4004 Other Income
      //    for groups chartered before 4005 existed).
      const { rows: accts } = await db.query<{ code: string; id: string }>(
        `SELECT account_code AS code, id FROM accounts
         WHERE group_id = $1 AND is_active AND account_code IN ('1001','4005','4004')`,
        [input.groupId],
      );
      const cashId   = accts.find((a) => a.code === '1001')?.id;
      const incomeId = accts.find((a) => a.code === '4005')?.id
                    ?? accts.find((a) => a.code === '4004')?.id;

      let groupJournalId: string | null = null;
      if (cashId && incomeId) {
        const { rows: je } = await db.query<{ id: string }>(
          `INSERT INTO journal_entries
             (group_id, entry_date, reference, description, status, created_by, posted_at)
           VALUES ($1, CURRENT_DATE, $2, $3, 'posted', NULL, NOW())
           RETURNING id`,
          [
            input.groupId, reference,
            `External funding — ${input.disbursementType.replace(/_/g, ' ')}`,
          ],
        );
        groupJournalId = je[0].id;
        await db.query(
          `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit)
           VALUES ($1,$2,$3,$4,0), ($1,$2,$5,0,$4)`,
          [input.groupId, groupJournalId, cashId, input.amount.toFixed(2), incomeId],
        );
      } else {
        // Never lose the money trail: the disbursement + org ledger still land,
        // and reconciliation surfaces the missing group posting.
        logger.warn('[org-finance] group journal skipped — chart missing 1001/4005', {
          groupId: input.groupId,
        });
      }

      // 6. The disbursement record + org ledger row, cross-linked.
      const { rows: disb } = await db.query<OrgDisbursement>(
        `INSERT INTO organization_disbursements
           (organization_id, wallet_id, funding_program_id, group_id,
            disbursement_type, amount, status, reference, notes,
            group_journal_entry_id, created_by, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,'completed',$7,$8,$9,$10,NOW())
         RETURNING *`,
        [
          organizationId, wallet.id, input.fundingProgramId ?? null, input.groupId,
          input.disbursementType, input.amount.toFixed(2), reference,
          input.notes ?? null, groupJournalId, ctx.userId,
        ],
      );

      const { rows: ledger } = await db.query<{ id: string }>(
        `INSERT INTO organization_ledger
           (organization_id, wallet_id, entry_type, direction, amount, balance_after,
            funding_program_id, group_id, disbursement_id, reference, description, created_by)
         VALUES ($1,$2,'disbursement','debit',$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [
          organizationId, wallet.id, input.amount.toFixed(2), newBalance.toFixed(2),
          input.fundingProgramId ?? null, input.groupId, disb[0].id, reference,
          input.notes ?? `Disbursement to group`, ctx.userId,
        ],
      );
      await db.query(
        `UPDATE organization_disbursements SET ledger_entry_id = $1 WHERE id = $2`,
        [ledger[0].id, disb[0].id],
      );

      return disb[0];
    });
  },

  async listDisbursements(
    ctx: TenantContext,
    params: { page?: number; limit?: number } = {},
  ): Promise<{ items: OrgDisbursement[]; total: number; page: number; limit: number }> {
    await organizationService.assertOrganizationCoordinator(ctx);
    const page  = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));

    return withDb(ctx, async (db) => {
      const { rows: countRows } = await db.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM organization_disbursements WHERE organization_id = $1`,
        [orgId(ctx)],
      );
      const { rows } = await db.query<OrgDisbursement>(
        `SELECT d.*, g.name AS group_name, fp.name AS program_name
         FROM   organization_disbursements d
         JOIN   groups g ON g.id = d.group_id
         LEFT JOIN funding_programs fp ON fp.id = d.funding_program_id
         WHERE  d.organization_id = $1
         ORDER  BY d.created_at DESC
         LIMIT  $2 OFFSET $3`,
        [orgId(ctx), limit, (page - 1) * limit],
      );
      return { items: rows, total: parseInt(countRows[0]?.n ?? '0', 10), page, limit };
    });
  },

  // ─── Dashboard metrics ─────────────────────────────────────────────────────

  async getDashboard(ctx: TenantContext): Promise<{
    financial: Record<string, string | number>;
    portfolio: Record<string, string | number>;
    programs:  FundingProgram[];
  }> {
    await organizationService.assertOrganizationCoordinator(ctx);
    const wallet = await this.getWallet(ctx);

    return withDb(ctx, async (db) => {
      const [portfolio, programs] = await Promise.all([
        db.query<{
          linked_groups: string; active_members: string;
          total_savings: string; loan_portfolio: string;
          loans_disbursed: string; loans_repaid: string;
        }>(
          `SELECT
             COUNT(DISTINCT nga.group_id)                                            AS linked_groups,
             COUNT(DISTINCT gm.member_id) FILTER (WHERE gm.is_active)                AS active_members,
             COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'completed'), 0)::text  AS total_savings,
             COALESCE(SUM(l.outstanding_balance)
                      FILTER (WHERE l.status IN ('disbursed','active')), 0)::text    AS loan_portfolio,
             COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('disbursed','active'))  AS loans_disbursed,
             COALESCE(SUM(lr.amount_paid) FILTER (WHERE lr.status = 'completed'), 0)::text AS loans_repaid
           FROM organization_group_access nga
           LEFT JOIN group_members    gm ON gm.group_id = nga.group_id
           LEFT JOIN contributions    c  ON c.group_id  = nga.group_id
           LEFT JOIN loans            l  ON l.group_id  = nga.group_id
           LEFT JOIN loan_repayments  lr ON lr.loan_id  = l.id
           WHERE nga.organization_id = $1 AND nga.is_active`,
          [orgId(ctx)],
        ),
        db.query<FundingProgram>(
          `SELECT * FROM funding_programs
           WHERE organization_id = $1 AND status = 'active'
           ORDER BY created_at DESC LIMIT 10`,
          [orgId(ctx)],
        ),
      ]);

      const p = portfolio.rows[0];
      return {
        financial: {
          walletBalance:   wallet.available_balance,
          committedFunds:  wallet.committed_balance,
          totalDeposited:  wallet.total_deposited,
          totalDisbursed:  wallet.total_disbursed,
          totalReturned:   wallet.total_returned,
        },
        portfolio: {
          linkedGroups:    parseInt(p?.linked_groups ?? '0', 10),
          activeMembers:   parseInt(p?.active_members ?? '0', 10),
          totalSavings:    p?.total_savings ?? '0',
          loanPortfolio:   p?.loan_portfolio ?? '0',
          activeLoans:     parseInt(p?.loans_disbursed ?? '0', 10),
          loanRepayments:  p?.loans_repaid ?? '0',
          activePrograms:  programs.rows.length,
        },
        programs: programs.rows,
      };
    });
  },
};
