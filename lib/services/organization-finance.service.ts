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
import { withDb, withTransaction, withAdminDb, type TenantContext } from '@/lib/db';
import { cached, keys } from '@/lib/redis';
import { organizationService } from './organization.service';
import { postOrgSystemJournal } from './organization-accounting.service';
import { getEffectiveThreshold } from './approval-policy.service';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
// Typed against the validator rather than a hand-written inline shape. A
// parallel hand-maintained type is exactly what drifted in the client/server
// contract audit — this way, adding a field to the schema is a compile error
// here until it is persisted.
import type { CreateProgramInput, CapitalAdjustmentInput, DisburseInput } from '@/lib/validators/organization.schema';

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
  // Financial-product terms (migration 116). Every existing program is
  // non-repayable by default, so these are all null/false for grants.
  product_code:         string | null;
  is_repayable:         boolean;
  capital_model:        string;
  loss_bearer:          string;
  shared_loss_ratio:    string | null;
  interest_method:      string | null;
  /** PERCENTAGE (12.50 = 12.5%), matching loans.interest_rate — never a ratio. */
  interest_rate_annual: string | null;
  repayment_frequency:  string;
  grace_period_days:    number;
  tenor_months:         number | null;
  revenue_owner:        string;
  revenue_share_ratio:  string | null;
  repayment_waterfall:  unknown | null;
  member_visibility:    string;
  /** PERCENTAGE, retained by the org and deducted from what's disbursed (migration 125). */
  processing_fee_pct:   string | null;
}

/**
 * A product's capital position. `budget` is a SPENDING AUTHORITY, not a cash
 * balance — actual cash lives once, at organization_wallets. So:
 *   available = totalCapital - allocated
 */
export interface ProductBalances {
  programId:       string;
  name:            string;
  isRepayable:     boolean;
  totalCapital:    number;
  allocated:       number;
  available:       number;
  /** allocated / totalCapital, 0 when the product has no capital yet. */
  utilizationRate: number;
}

export interface ProgramBudgetLine {
  id:             string;
  name:           string;
  programType:    string;
  status:         string;
  budget:         number;
  disbursed:      number;
  /** Held by pending-approval disbursements — committed but not yet settled. */
  reserved:       number;
  remaining:      number;
  /** (disbursed + reserved) / budget, as a percentage. */
  utilizationPct: number;
  /** Share of the program window already elapsed; null when the program is undated. */
  expectedUtilizationPct: number | null;
  /** utilizationPct − expectedUtilizationPct; negative = behind the calendar. */
  variancePct:    number | null;
  startsOn:       string | null;
  endsOn:         string | null;
}

export interface DonorSpendLine {
  fundingSource:   string;
  programCount:    number;
  totalBudget:     number;
  totalDisbursed:  number;
  totalReserved:   number;
  remaining:       number;
  utilizationPct:  number;
  programs:        { id: string; name: string; budget: number; disbursed: number }[];
  byGroup:         { groupId: string; groupName: string | null; amount: number }[];
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
  /** SNAPSHOT from the product at disbursement time (migration 125). */
  processing_fee_pct:    string | null;
  processing_fee_amount: string;
  /** amount - processing_fee_amount — the real cash the group received. */
  net_disbursed_amount:  string;
  /** How the money physically moved (migration 150). NULL = not recorded,
   *  which is the honest state for every disbursement made before that. */
  payment_method:        string | null;
  /** Cheque number / bank slip — the only artefact a cash or cheque
   *  hand-over leaves behind. */
  payment_reference:     string | null;
}

const orgId = (ctx: TenantContext): string => {
  // super_admins may act on a specific organization passed via context.
  if (!ctx.organizationId) throw new ValidationError('Organization context is required');
  return ctx.organizationId;
};

/**
 * Row-locks the organization's wallet, creating it first if it doesn't exist.
 *
 * This USED to throw NotFoundError when no wallet row existed, which was a live
 * bug: createOrganization() seeds a chart of accounts but NOT a wallet — only
 * getWallet() creates one, lazily, when someone opens the wallet screen. So an
 * organization's very first deposit() or disburse() failed with "Organization
 * wallet not found" unless a coordinator happened to view that screen first.
 * Found by the real-Postgres CI job while wiring Phase 2a; confirmed against
 * production, where the live organization has no wallet row at all.
 *
 * Bootstrapping is the only sane behaviour here — a wallet is an implementation
 * detail of holding a balance, not a thing a user opts into — so the throwing
 * variant is deliberately gone rather than kept alongside this one, so no
 * future caller can pick the footgun by accident.
 */
async function getWalletForUpdate(db: PoolClient, organizationId: string): Promise<OrgWallet> {
  const { rows } = await db.query<OrgWallet>(
    `SELECT * FROM organization_wallets
     WHERE organization_id = $1 AND currency = 'KES' AND is_active
     FOR UPDATE`,
    [organizationId],
  );
  if (rows[0]) return rows[0];

  const { rows: created } = await db.query<OrgWallet>(
    `INSERT INTO organization_wallets (organization_id) VALUES ($1)
     ON CONFLICT (organization_id, currency) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [organizationId],
  );
  return created[0];
}

/** Row-locks a product before adjusting its capital, mirroring getWalletForUpdate. */
async function getProgramForUpdate(
  db: PoolClient, organizationId: string, programId: string,
): Promise<FundingProgram> {
  const { rows } = await db.query<FundingProgram>(
    `SELECT * FROM funding_programs
     WHERE id = $1 AND organization_id = $2
     FOR UPDATE`,
    [programId, organizationId],
  );
  if (!rows[0]) throw new NotFoundError('Funding program', programId);
  return rows[0];
}

/**
 * Audit trail for a capital-authority change.
 *
 * organization_ledger.wallet_id is NOT NULL, so this attaches the org's wallet
 * even though no cash moves — the row records WHICH product's authority
 * changed (funding_program_id) and by how much. balance_after is the wallet's
 * unchanged available balance, precisely because capitalization is not a cash
 * event; reading a jump there would be the bug, not the feature.
 */
async function recordCapitalLedgerEntry(
  db: PoolClient,
  ctx: TenantContext,
  program: FundingProgram,
  entryType: 'capitalization' | 'decapitalization',
  input: CapitalAdjustmentInput,
): Promise<void> {
  const wallet = await getWalletForUpdate(db, orgId(ctx));
  const verb   = entryType === 'capitalization' ? 'Capitalized' : 'Decapitalized';

  await db.query(
    `INSERT INTO organization_ledger
       (organization_id, wallet_id, entry_type, direction, amount, balance_after,
        funding_program_id, reference, description, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      orgId(ctx), wallet.id, entryType,
      entryType === 'capitalization' ? 'credit' : 'debit',
      input.amount.toFixed(2),
      parseFloat(wallet.available_balance).toFixed(2),
      program.id,
      input.reference ?? null,
      input.notes ?? `${verb} — ${program.name}`,
      ctx.userId,
    ],
  );
}

interface AllocationTerms {
  isRepayable:        boolean;
  interestRateAnnual: string | null;
  repaymentFrequency: string | null;
  tenorMonths:        number | null;
  firstRepaymentDate: string | null;
  maturityDate:       string | null;
  /** SNAPSHOT of the product's processing_fee_pct (migration 125). Independent
   *  of isRepayable — read below before the non-repayable early return. */
  processingFeePct:   string | null;
}

const GRANT_TERMS: AllocationTerms = {
  isRepayable: false, interestRateAnnual: null, repaymentFrequency: null,
  tenorMonths: null, firstRepaymentDate: null, maturityDate: null,
  processingFeePct: null,
};

/**
 * Copies a product's repayment terms for stamping onto a new allocation.
 *
 * Read ONCE, at disbursement. The allocation then owns its own terms forever —
 * repricing a product must never retroactively change what an existing
 * borrower owes, which is why organization_disbursements carries these columns
 * rather than joining back to funding_programs.
 *
 * A disbursement with no funding programme, or from a non-repayable one, is a
 * plain grant: every term stays null and org_disb_non_repayable_shape enforces
 * that at the database level.
 */
async function snapshotProductTerms(
  db: PoolClient, fundingProgramId: string | null,
): Promise<AllocationTerms> {
  if (!fundingProgramId) return GRANT_TERMS;

  const { rows } = await db.query<{
    is_repayable: boolean; interest_rate_annual: string | null;
    repayment_frequency: string; tenor_months: number | null; grace_period_days: number;
    processing_fee_pct: string | null;
  }>(
    `SELECT is_repayable, interest_rate_annual, repayment_frequency,
            tenor_months, grace_period_days, processing_fee_pct
     FROM funding_programs WHERE id = $1`,
    [fundingProgramId],
  );

  const p = rows[0];
  if (!p) return GRANT_TERMS;

  // processing_fee_pct is independent of is_repayable — a grant can still
  // carry a processing fee, so this is read before (and outside) the
  // non-repayable early return below.
  if (!p.is_repayable) return { ...GRANT_TERMS, processingFeePct: p.processing_fee_pct };

  // Dates are derived from the product's grace period and tenor at the moment
  // of disbursement, so a later change to either leaves this allocation alone.
  const first    = new Date();
  first.setDate(first.getDate() + (p.grace_period_days ?? 0));
  const maturity = new Date(first);
  maturity.setMonth(maturity.getMonth() + (p.tenor_months ?? 0));
  const iso = (d: Date): string => d.toISOString().slice(0, 10);

  return {
    isRepayable:        true,
    interestRateAnnual: p.interest_rate_annual,
    repaymentFrequency: p.repayment_frequency,
    tenorMonths:        p.tenor_months,
    firstRepaymentDate: iso(first),
    maturityDate:       iso(maturity),
    processingFeePct:   p.processing_fee_pct,
  };
}

/**
 * Creates the group-side funding source for a settled allocation.
 *
 * THIS IS THE KEYSTONE of the capital layer. Without it, money arriving from an
 * organization is indistinguishable from the group's own savings, so a member
 * loan funded by that money cannot be attributed back — and no organization
 * portfolio reporting is possible.
 *
 * Idempotent via uq_group_funding_sources_allocation (migration 115): calling
 * this twice for the same allocation is a no-op, matching
 * settleOrgDisbursement's own idempotency.
 */
async function createAllocationFundingSource(
  db: PoolClient,
  allocation: {
    id: string; organization_id: string; group_id: string;
    funding_program_id: string | null; is_repayable: boolean;
  },
): Promise<void> {
  const { rows } = await db.query<{ org_name: string; program_name: string | null }>(
    `SELECT o.name AS org_name, p.name AS program_name
     FROM organizations o
     LEFT JOIN funding_programs p ON p.id = $2
     WHERE o.id = $1`,
    [allocation.organization_id, allocation.funding_program_id],
  );

  const orgName = rows[0]?.org_name ?? 'Organization';
  const label   = rows[0]?.program_name ? `${orgName} — ${rows[0].program_name}` : orgName;

  await db.query(
    `INSERT INTO group_funding_sources
       (group_id, source_type, allocation_id, organization_id, label, is_repayable)
     VALUES ($1, 'organization_allocation', $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [allocation.group_id, allocation.id, allocation.organization_id, label, allocation.is_repayable],
  );
}

async function fetchOrgDisbursement(db: PoolClient, id: string): Promise<OrgDisbursement> {
  const { rows } = await db.query<OrgDisbursement>(
    `SELECT * FROM organization_disbursements WHERE id = $1`, [id],
  );
  if (!rows[0]) throw new NotFoundError('Disbursement', id);
  return rows[0];
}

/**
 * Settles an 'approved' org disbursement: posts the group-side journal, folds
 * the amount into the program budget and the wallet's lifetime total, and
 * releases the reservation hold. Idempotent — only a row still 'approved'
 * transitions, so calling this twice (e.g. a duplicate approval click) is a
 * safe no-op.
 */
async function settleOrgDisbursement(id: string): Promise<void> {
  await withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string; organization_id: string; wallet_id: string; group_id: string;
      funding_program_id: string | null; disbursement_type: string; amount: string;
      reference: string; is_repayable: boolean;
      processing_fee_amount: string; net_disbursed_amount: string;
    }>(
      `SELECT id, organization_id, wallet_id, group_id, funding_program_id,
              disbursement_type, amount, reference, is_repayable,
              processing_fee_amount, net_disbursed_amount
       FROM   organization_disbursements
       WHERE  id = $1 AND status = 'approved'
       FOR UPDATE`,
      [id],
    );
    const disb = rows[0];
    if (!disb) return; // already settled

    // The money has landed in the group's books, so record WHERE it came from.
    // Without this the group cannot later attribute a member loan back to this
    // organization's capital — see createAllocationFundingSource.
    await createAllocationFundingSource(db, disb);

    if (disb.funding_program_id) {
      await db.query(
        `UPDATE funding_programs SET disbursed_total = disbursed_total + $1 WHERE id = $2`,
        [disb.amount, disb.funding_program_id],
      );
    }

    // Group-side: balanced, posted journal entry. DR 1001 Cash / CR 4005
    // External Funding (fallback 4004 for groups chartered before 4005 existed).
    const { rows: accts } = await db.query<{ code: string; id: string }>(
      `SELECT account_code AS code, id FROM accounts
       WHERE group_id = $1 AND is_active AND account_code IN ('1001','4005','4004')`,
      [disb.group_id],
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
        [disb.group_id, disb.reference, `External funding — ${disb.disbursement_type.replace(/_/g, ' ')}`],
      );
      groupJournalId = je[0].id;
      // entry_date is the journal_lines partition key — supplied directly as
      // the same CURRENT_DATE literal used for the parent journal_entries row
      // above (a BEFORE INSERT trigger deriving it after Postgres has already
      // routed the row to a partition is unsupported).
      // net_disbursed_amount (migration 125), not the gross amount — the
      // group's own cash account must reflect what it actually received; a
      // processing fee never reaches the group.
      await db.query(
        `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit, entry_date)
         VALUES ($1,$2,$3,$4,0,CURRENT_DATE), ($1,$2,$5,0,$4,CURRENT_DATE)`,
        [disb.group_id, groupJournalId, cashId, disb.net_disbursed_amount, incomeId],
      );
    } else {
      // Never lose the money trail: the disbursement + org ledger still
      // land, and reconciliation surfaces the missing group posting.
      logger.warn('[org-finance] group journal skipped — chart missing 1001/4005', {
        groupId: disb.group_id,
      });
    }

    // Wallet math (migration 125): the reservation at request time held the
    // FULL gross amount in committed_balance. At settlement:
    //   - committed_balance releases by the full gross (closes the reservation)
    //   - available_balance gets the fee portion BACK (it never actually left
    //     the org — retained as income, not disbursed)
    //   - total_disbursed (lifetime counter) only counts the NET cash that
    //     really went out the door
    // Net effect on available_balance across request+settle: -gross+fee = -net.
    const { rows: walletAfter } = await db.query<{ available_balance: string }>(
      `UPDATE organization_wallets
       SET    committed_balance = committed_balance - $1,
              available_balance = available_balance + $2,
              total_disbursed   = total_disbursed   + $3
       WHERE  id = $4
       RETURNING available_balance`,
      [disb.amount, disb.processing_fee_amount, disb.net_disbursed_amount, disb.wallet_id],
    );

    // Organization's own side of the same transfer: DR 5001 Program
    // Disbursements / CR 1001 Cash and Bank — completes the dual-ledger
    // transaction whose group-side half was posted above. net_disbursed_amount
    // (migration 125): only the real cash outflow is posted here.
    await postOrgSystemJournal(
      db, disb.organization_id, null,
      `Disbursement to group — ${disb.disbursement_type.replace(/_/g, ' ')}`,
      [{ accountCode: '5001', debit: parseFloat(disb.net_disbursed_amount) }, { accountCode: '1001', credit: parseFloat(disb.net_disbursed_amount) }],
      { reference: disb.reference },
    );

    // Processing fee audit trail (migration 125) — entry_type='fee' has
    // existed on organization_ledger since migration 116 but was unused until
    // now. Posts no GL journal (that would double-count against the
    // disbursement journal above) — this row is the audit trail for the fee
    // that was just credited back to available_balance in the wallet UPDATE
    // above; balance_after is that same post-credit figure.
    if (parseFloat(disb.processing_fee_amount) > 0) {
      await db.query(
        `INSERT INTO organization_ledger
           (organization_id, wallet_id, entry_type, direction, amount, balance_after,
            funding_program_id, group_id, disbursement_id, reference, description, created_by)
         VALUES ($1,$2,'fee','credit',$3,$4,$5,$6,$7,$8,$9,NULL)`,
        [
          disb.organization_id, disb.wallet_id, disb.processing_fee_amount, walletAfter[0].available_balance,
          disb.funding_program_id, disb.group_id, disb.id, disb.reference,
          `Processing fee retained — ${disb.disbursement_type.replace(/_/g, ' ')}`,
        ],
      );
    }

    await db.query(
      `UPDATE organization_disbursements
       SET    status = 'completed', completed_at = NOW(), group_journal_entry_id = $2
       WHERE  id = $1`,
      [id, groupJournalId],
    );
  });
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

      await postOrgSystemJournal(
        db, orgId(ctx), ctx.userId,
        input.notes ?? (input.source ? `Deposit — ${input.source}` : 'Deposit'),
        [{ accountCode: '1001', debit: input.amount }, { accountCode: '4001', credit: input.amount }],
        { reference: input.reference },
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

  /**
   * Budget variance / utilization report (ACCOUNTING_ARCHITECTURE_AUDIT.md
   * §14 — "budget variance/utilization reporting" was the audit's Medium
   * finding on the otherwise well-built reservation system): per program,
   * budget vs settled disbursements vs amounts reserved under pending
   * approval, plus — for programs with a start/end date — a schedule
   * variance: actual utilization minus the share of the program window
   * already elapsed (negative = deploying slower than the calendar).
   */
  async programBudgetReport(ctx: TenantContext): Promise<ProgramBudgetLine[]> {
    await organizationService.assertOrganizationCoordinator(ctx);
    return cached(keys.cache('program-budget', orgId(ctx)), 60, () => withDb(ctx, async (db) => {
      const { rows } = await db.query<{
        id: string; name: string; program_type: string; status: string;
        budget: string; disbursed_total: string; reserved: string;
        starts_on: string | null; ends_on: string | null;
      }>(
        `SELECT p.id, p.name, p.program_type, p.status,
                p.budget::text, p.disbursed_total::text,
                COALESCE(pd.pending, 0)::text AS reserved,
                p.starts_on::text, p.ends_on::text
         FROM funding_programs p
         LEFT JOIN (
           SELECT funding_program_id, SUM(amount) AS pending
           FROM organization_disbursements
           WHERE status = 'pending_approval' AND funding_program_id IS NOT NULL
           GROUP BY funding_program_id
         ) pd ON pd.funding_program_id = p.id
         WHERE p.organization_id = $1
         ORDER BY p.status = 'active' DESC, p.created_at DESC`,
        [orgId(ctx)],
      );

      const today = Date.now();
      return rows.map((r) => {
        const budget    = parseFloat(r.budget);
        const disbursed = parseFloat(r.disbursed_total);
        const reserved  = parseFloat(r.reserved);
        const utilizationPct = budget > 0 ? ((disbursed + reserved) / budget) * 100 : 0;

        let expectedUtilizationPct: number | null = null;
        if (r.starts_on && r.ends_on) {
          const start = Date.parse(r.starts_on);
          const end   = Date.parse(r.ends_on);
          if (end > start) {
            expectedUtilizationPct = Math.min(100, Math.max(0, ((today - start) / (end - start)) * 100));
          }
        }

        return {
          id: r.id, name: r.name, programType: r.program_type, status: r.status,
          budget, disbursed, reserved,
          remaining:      budget - disbursed - reserved,
          utilizationPct,
          expectedUtilizationPct,
          variancePct: expectedUtilizationPct === null ? null : utilizationPct - expectedUtilizationPct,
          startsOn: r.starts_on, endsOn: r.ends_on,
        };
      });
    }));
  },

  /**
   * Donor/grant-specific spend report (ACCOUNTING_ARCHITECTURE_AUDIT.md §12 —
   * "organization_ledger carries funding_program_id and programs carry
   * funding_source, but no endpoint aggregates spend-by-donor into a report").
   * Groups every funding program by its (free-text) `funding_source`, rolling
   * up budget/disbursed/reserved across that donor's programs, plus a
   * per-recipient-group breakdown of settled disbursements traced through
   * `organization_ledger` (the only rows carrying both `funding_program_id`
   * and `group_id`).
   */
  async donorSpendReport(ctx: TenantContext): Promise<DonorSpendLine[]> {
    await organizationService.assertOrganizationCoordinator(ctx);
    return cached(keys.cache('donor-spend', orgId(ctx)), 60, () => withDb(ctx, async (db) => {
      const { rows: programs } = await db.query<{
        id: string; name: string; funding_source: string | null;
        budget: string; disbursed_total: string; reserved: string;
      }>(
        `SELECT p.id, p.name, p.funding_source,
                p.budget::text, p.disbursed_total::text,
                COALESCE(pd.pending, 0)::text AS reserved
         FROM funding_programs p
         LEFT JOIN (
           SELECT funding_program_id, SUM(amount) AS pending
           FROM organization_disbursements
           WHERE status = 'pending_approval' AND funding_program_id IS NOT NULL
           GROUP BY funding_program_id
         ) pd ON pd.funding_program_id = p.id
         WHERE p.organization_id = $1
         ORDER BY p.funding_source NULLS LAST, p.created_at DESC`,
        [orgId(ctx)],
      );

      const { rows: byGroupRows } = await db.query<{
        funding_source: string | null; group_id: string; group_name: string | null; amount: string;
      }>(
        `SELECT p.funding_source, l.group_id, g.name AS group_name, SUM(l.amount)::text AS amount
         FROM organization_ledger l
         JOIN funding_programs p ON p.id = l.funding_program_id
         LEFT JOIN groups g ON g.id = l.group_id
         WHERE l.organization_id = $1 AND l.entry_type = 'disbursement' AND l.direction = 'debit'
         GROUP BY p.funding_source, l.group_id, g.name`,
        [orgId(ctx)],
      );

      const donors = new Map<string, DonorSpendLine>();
      const bucketOf = (source: string | null): DonorSpendLine => {
        const key = source ?? 'Unspecified';
        let d = donors.get(key);
        if (!d) {
          d = {
            fundingSource: key, programCount: 0, totalBudget: 0, totalDisbursed: 0,
            totalReserved: 0, remaining: 0, utilizationPct: 0, programs: [], byGroup: [],
          };
          donors.set(key, d);
        }
        return d;
      };

      for (const p of programs) {
        const d = bucketOf(p.funding_source);
        const budget = parseFloat(p.budget), disbursed = parseFloat(p.disbursed_total), reserved = parseFloat(p.reserved);
        d.programCount   += 1;
        d.totalBudget    += budget;
        d.totalDisbursed += disbursed;
        d.totalReserved  += reserved;
        d.programs.push({ id: p.id, name: p.name, budget, disbursed });
      }
      for (const r of byGroupRows) {
        bucketOf(r.funding_source).byGroup.push({
          groupId: r.group_id, groupName: r.group_name, amount: parseFloat(r.amount),
        });
      }
      for (const d of donors.values()) {
        d.remaining      = d.totalBudget - d.totalDisbursed - d.totalReserved;
        d.utilizationPct = d.totalBudget > 0 ? ((d.totalDisbursed + d.totalReserved) / d.totalBudget) * 100 : 0;
      }
      return Array.from(donors.values()).sort((a, b) => b.totalDisbursed - a.totalDisbursed);
    }));
  },

  async createProgram(
    ctx: TenantContext,
    input: CreateProgramInput,
  ): Promise<FundingProgram> {
    await organizationService.assertOrganizationCoordinator(ctx);
    if (!(input.budget > 0)) throw new ValidationError('Budget must be positive');

    return withTransaction(ctx, async (db) => {
      const { rows } = await db.query<FundingProgram>(
        `INSERT INTO funding_programs
           (organization_id, name, program_type, budget, funding_source, description,
            eligibility_criteria, geographic_coverage, reporting_requirements,
            starts_on, ends_on, status, created_by,
            product_code, is_repayable, capital_model, loss_bearer, shared_loss_ratio,
            interest_method, interest_rate_annual, repayment_frequency, grace_period_days,
            tenor_months, revenue_owner, revenue_share_ratio, repayment_waterfall,
            member_visibility, processing_fee_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,'active',$12,
                 $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb,$26,$27)
         RETURNING *`,
        [
          orgId(ctx), input.name, input.programType, input.budget.toFixed(2),
          input.fundingSource ?? null, input.description ?? null,
          JSON.stringify(input.eligibilityCriteria ?? {}),
          JSON.stringify(input.geographicCoverage ?? []),
          input.reportingRequirements ?? null,
          input.startsOn ?? null, input.endsOn ?? null,
          ctx.userId,
          // Financial-product terms. Defaults keep any caller that doesn't set
          // them (i.e. every existing one) creating a plain non-repayable grant.
          input.productCode ?? null,
          input.isRepayable ?? false,
          input.capitalModel ?? 'liability',
          input.lossBearer ?? 'group',
          input.sharedLossRatio ?? null,
          input.interestMethod ?? null,
          input.interestRateAnnual ?? null,
          input.repaymentFrequency ?? 'none',
          input.gracePeriodDays ?? 0,
          input.tenorMonths ?? null,
          input.revenueOwner ?? 'organization',
          input.revenueShareRatio ?? null,
          input.repaymentWaterfall ? JSON.stringify(input.repaymentWaterfall) : null,
          input.memberVisibility ?? 'pseudonymous',
          input.processingFeePct ?? null,
        ],
      );
      return rows[0];
    });
  },

  // ─── Product capital (Phase 1) ─────────────────────────────────────────────

  /**
   * Add capital to a product.
   *
   * `budget` is a SPENDING AUTHORITY, not a pot of cash — actual money lives
   * once, at organization_wallets, and is topped up by deposit(). So this
   * raises what the product is allowed to allocate and records the change in
   * organization_ledger for the audit trail. It deliberately posts NO GL
   * journal: raising an authority is not a cash event, and inventing one would
   * unbalance the organization's books against its own wallet.
   */
  async capitalizeProduct(
    ctx: TenantContext,
    programId: string,
    input: CapitalAdjustmentInput,
  ): Promise<FundingProgram> {
    await organizationService.assertOrganizationCoordinator(ctx);
    if (!(input.amount > 0)) throw new ValidationError('Capitalization amount must be positive');

    return withTransaction(ctx, async (db) => {
      const program = await getProgramForUpdate(db, orgId(ctx), programId);

      const { rows } = await db.query<FundingProgram>(
        `UPDATE funding_programs SET budget = budget + $1
         WHERE id = $2 AND organization_id = $3
         RETURNING *`,
        [input.amount.toFixed(2), programId, orgId(ctx)],
      );

      await recordCapitalLedgerEntry(db, ctx, program, 'capitalization', input);
      return rows[0];
    });
  },

  /**
   * Withdraw uncommitted capital from a product.
   *
   * Refuses to cut `budget` below what has already been allocated. The DB's
   * funding_programs_budget_not_exceeded CHECK would catch this anyway, but as
   * a raw 23514 — this turns it into a clean ValidationError the UI can show.
   */
  async decapitalizeProduct(
    ctx: TenantContext,
    programId: string,
    input: CapitalAdjustmentInput,
  ): Promise<FundingProgram> {
    await organizationService.assertOrganizationCoordinator(ctx);
    if (!(input.amount > 0)) throw new ValidationError('Decapitalization amount must be positive');

    return withTransaction(ctx, async (db) => {
      const program   = await getProgramForUpdate(db, orgId(ctx), programId);
      const budget    = parseFloat(program.budget);
      const allocated = parseFloat(program.disbursed_total);

      if (input.amount > budget - allocated) {
        throw new ValidationError(
          `Cannot withdraw ${input.amount.toFixed(2)} — only ${(budget - allocated).toFixed(2)} of this product's capital is uncommitted`,
        );
      }

      const { rows } = await db.query<FundingProgram>(
        `UPDATE funding_programs SET budget = budget - $1
         WHERE id = $2 AND organization_id = $3
         RETURNING *`,
        [input.amount.toFixed(2), programId, orgId(ctx)],
      );

      await recordCapitalLedgerEntry(db, ctx, program, 'decapitalization', input);
      return rows[0];
    });
  },

  /** Capital position per product — the read side of the capitalization flow. */
  async productBalances(ctx: TenantContext, programId?: string): Promise<ProductBalances[]> {
    await organizationService.assertOrganizationCoordinator(ctx);
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<{
        id: string; name: string; is_repayable: boolean;
        budget: string; disbursed_total: string;
      }>(
        `SELECT id, name, is_repayable, budget, disbursed_total
         FROM funding_programs
         WHERE organization_id = $1
           AND ($2::uuid IS NULL OR id = $2::uuid)
         ORDER BY created_at DESC`,
        [orgId(ctx), programId ?? null],
      );

      return rows.map((r) => {
        const totalCapital = parseFloat(r.budget);
        const allocated    = parseFloat(r.disbursed_total);
        return {
          programId:       r.id,
          name:            r.name,
          isRepayable:     r.is_repayable,
          totalCapital,
          allocated,
          available:       totalCapital - allocated,
          utilizationRate: totalCapital > 0 ? allocated / totalCapital : 0,
        };
      });
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

  /**
   * Org -> group disbursement. Dual control (B2B audit: separation of
   * duties): amounts above the org's disbursement_approval_threshold are
   * RESERVED (committed_balance) but park in 'pending_approval' — the group
   * journal is not posted, and the program budget is not consumed — until a
   * DIFFERENT coordinator approves via approveDisbursement(). Amounts at or
   * under the threshold settle immediately under single control, same as
   * before.
   */
  async disburse(
    ctx: TenantContext,
    // Typed against the validator, not a parallel hand-written shape — the
    // same drift that bit createProgram when product terms were added.
    input: DisburseInput,
  ): Promise<OrgDisbursement & { needsApproval: boolean }> {
    await organizationService.assertOrganizationCoordinator(ctx);
    if (!(input.amount > 0)) throw new ValidationError('Disbursement amount must be positive');

    const disb = await withTransaction(ctx, async (db) => {
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

      // 3. Program budget guard (when funded from a program). "Remaining"
      //    accounts for amounts already reserved by OTHER pending-approval
      //    disbursements against the same program, so budget can never be
      //    double-committed while multiple requests await approval.
      if (input.fundingProgramId) {
        const { rows: prog } = await db.query<{ budget: string; disbursed_total: string; status: string }>(
          `SELECT budget, disbursed_total, status FROM funding_programs
           WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
          [input.fundingProgramId, organizationId],
        );
        if (!prog[0]) throw new NotFoundError('Funding program', input.fundingProgramId);
        if (prog[0].status !== 'active') throw new ValidationError('Funding program is not active');

        const { rows: pendingRows } = await db.query<{ pending: string }>(
          `SELECT COALESCE(SUM(amount), 0) AS pending FROM organization_disbursements
           WHERE funding_program_id = $1 AND status = 'pending_approval'`,
          [input.fundingProgramId],
        );
        const remaining = parseFloat(prog[0].budget)
                         - parseFloat(prog[0].disbursed_total)
                         - parseFloat(pendingRows[0].pending);
        if (remaining < input.amount) {
          throw new ValidationError(`Program budget remaining is KES ${remaining.toFixed(2)}`);
        }
      }

      // 4. Maker-checker threshold (B2B audit: separation of duties).
      const threshold = await getEffectiveThreshold(db, 'org_disbursement_threshold', { organizationId });
      const requiresApproval = input.amount > threshold;

      // 5. Reserve: debit available_balance, hold in committed_balance — the
      //    wallet's own reservation column, previously unused. Ledger records
      //    this balance-affecting event now; approval is a pure status
      //    transition (no second balance-affecting entry), rejection posts a
      //    reversing credit.
      const reference  = `ODB-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      const newBalance = available - input.amount;
      await db.query(
        `UPDATE organization_wallets
         SET available_balance = available_balance - $1,
             committed_balance = committed_balance + $1
         WHERE id = $2`,
        [input.amount.toFixed(2), wallet.id],
      );

      // 5b. SNAPSHOT the product's terms onto the allocation (migration 117).
      //     Copied once, here, and never re-read: repricing a product must not
      //     retroactively change what an existing borrower owes. A disbursement
      //     with no funding programme, or from a non-repayable one, stays a
      //     plain grant with all terms null.
      const terms = await snapshotProductTerms(db, input.fundingProgramId ?? null);

      // 5c. Processing fee (migration 125) — "deducted from what's disbursed".
      //     The group's principal (input.amount, below) is unaffected; only
      //     the CASH that actually leaves the wallet at settlement is net.
      //     Reservation itself (step 5 above) still holds the full gross
      //     amount — conservative, matches the existing approval-pending
      //     window's behaviour for every other term.
      const feePct       = terms.processingFeePct ? parseFloat(terms.processingFeePct) : 0;
      const feeAmount    = Math.round(input.amount * feePct) / 100;
      const netDisbursed = input.amount - feeAmount;

      const { rows: disbRows } = await db.query<OrgDisbursement>(
        `INSERT INTO organization_disbursements
           (organization_id, wallet_id, funding_program_id, group_id,
            disbursement_type, amount, status, reference, notes, created_by,
            purpose, is_repayable, interest_rate_annual, repayment_frequency,
            tenor_months, first_repayment_date, maturity_date,
            processing_fee_pct, processing_fee_amount, net_disbursed_amount,
            payment_method, payment_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         RETURNING *`,
        [
          organizationId, wallet.id, input.fundingProgramId ?? null, input.groupId,
          input.disbursementType, input.amount.toFixed(2),
          requiresApproval ? 'pending_approval' : 'approved',
          reference, input.notes ?? null, ctx.userId,
          input.purpose ?? null,
          terms.isRepayable, terms.interestRateAnnual, terms.repaymentFrequency,
          terms.tenorMonths, terms.firstRepaymentDate, terms.maturityDate,
          terms.processingFeePct, feeAmount.toFixed(2), netDisbursed.toFixed(2),
          // NULL when not supplied — "not recorded", never an assumed default.
          // Guessing a channel would fabricate an audit trail for real money.
          input.paymentMethod ?? null, input.paymentReference ?? null,
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
          input.fundingProgramId ?? null, input.groupId, disbRows[0].id, reference,
          input.notes ?? (requiresApproval ? 'Disbursement — reserved, pending approval' : 'Disbursement to group'),
          ctx.userId,
        ],
      );
      await db.query(
        `UPDATE organization_disbursements SET ledger_entry_id = $1 WHERE id = $2`,
        [ledger[0].id, disbRows[0].id],
      );

      return disbRows[0];
    });

    if (disb.status === 'approved') {
      await settleOrgDisbursement(disb.id);
    }

    const fresh = await withDb(ctx, (db) => fetchOrgDisbursement(db, disb.id));
    return { ...fresh, needsApproval: fresh.status === 'pending_approval' };
  },

  /** Second-officer approval (maker-checker) — approver ≠ creator. */
  async approveDisbursement(ctx: TenantContext, id: string): Promise<OrgDisbursement> {
    await organizationService.assertOrganizationCoordinator(ctx);
    const organizationId = orgId(ctx);

    await withTransaction(ctx, async (db) => {
      const { rows } = await db.query<{ id: string; created_by: string }>(
        `SELECT id, created_by FROM organization_disbursements
         WHERE id = $1 AND organization_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, organizationId],
      );
      if (!rows[0]) throw new NotFoundError('Pending disbursement', id);
      if (rows[0].created_by === ctx.userId) {
        throw new ForbiddenError('Maker-checker: the initiator cannot approve their own disbursement');
      }
      await db.query(
        `UPDATE organization_disbursements
         SET    status = 'approved', approved_by = $2
         WHERE  id = $1`,
        [id, ctx.userId],
      );
    });

    await settleOrgDisbursement(id);
    return withDb(ctx, (db) => fetchOrgDisbursement(db, id));
  },

  /** Reject a pending disbursement — releases the wallet reservation. */
  async rejectDisbursement(ctx: TenantContext, id: string, reason: string): Promise<OrgDisbursement> {
    await organizationService.assertOrganizationCoordinator(ctx);
    const organizationId = orgId(ctx);

    return withTransaction(ctx, async (db) => {
      const { rows } = await db.query<{ wallet_id: string; amount: string }>(
        `SELECT wallet_id, amount FROM organization_disbursements
         WHERE id = $1 AND organization_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, organizationId],
      );
      if (!rows[0]) throw new NotFoundError('Pending disbursement', id);

      const { rows: walletRows } = await db.query<{ available_balance: string }>(
        `UPDATE organization_wallets
         SET    available_balance = available_balance + $1,
                committed_balance = committed_balance - $1
         WHERE  id = $2
         RETURNING available_balance`,
        [rows[0].amount, rows[0].wallet_id],
      );

      await db.query(
        `INSERT INTO organization_ledger
           (organization_id, wallet_id, entry_type, direction, amount, balance_after,
            disbursement_id, reference, description, created_by)
         SELECT $1, $2, 'disbursement', 'credit', $3, $4, id, reference,
                'Disbursement rejected — reservation released', $5
         FROM   organization_disbursements WHERE id = $6`,
        [organizationId, rows[0].wallet_id, rows[0].amount, walletRows[0].available_balance, ctx.userId, id],
      );

      const { rows: updated } = await db.query<OrgDisbursement>(
        `UPDATE organization_disbursements
         SET    status = 'rejected', rejected_by = $2, rejected_at = NOW(), rejection_reason = $3
         WHERE  id = $1 RETURNING *`,
        [id, ctx.userId, reason],
      );
      return updated[0];
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

    // Shorter TTL than the two report methods below — this payload embeds
    // the live wallet balance, so a smaller staleness window matters more
    // here than on the report-style views. getWallet is fetched inside the
    // cached closure (not before it) so a cache hit skips that query too.
    return cached(keys.cache('org-dashboard', orgId(ctx)), 30, async () => {
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
    });
  },
};
