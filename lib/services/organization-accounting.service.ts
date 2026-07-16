/**
 * Organization-level chart of accounts and journal posting
 * (ACCOUNTING_ARCHITECTURE_AUDIT.md §9 Critical finding, §29.13 item 3).
 *
 * A deliberate parallel to accounting.service.ts (the group-scoped ledger),
 * not an extension of it — organizations are a structurally different
 * entity (fund accounting: net assets, donors, program disbursements — no
 * members, shares, or welfare pools), and this keeps every change scoped to
 * new tables rather than touching the already-hardened, RLS-tightly-scoped
 * accounts/journal_entries tables every group financial operation depends
 * on. See organization_accounts / organization_journal_entries /
 * organization_journal_lines (migration 085) for the schema this operates
 * over — structurally identical to the group ledger (two-layer balance
 * enforcement via DB triggers, a trigger-maintained balance column).
 */
import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ValidationError } from '@/lib/utils/errors';
import { organizationService } from './organization.service';

export interface OrgAccount {
  id:              string;
  organization_id: string;
  account_code:    string;
  name:            string;
  type:            'asset' | 'liability' | 'equity' | 'income' | 'expense';
  is_system:       boolean;
  is_active:       boolean;
  balance:         string;
}

export interface OrgTrialBalanceLine {
  accountCode: string;
  accountName: string;
  accountType: string;
  netBalance:  string;
}

// Kept in lockstep with migration 085's seed INSERT — this is the set every
// current posting path (deposit, settleOrgDisbursement) actually uses.
const DEFAULT_ORG_ACCOUNTS = [
  { code: '1001', name: 'Cash and Bank',         type: 'asset'   },
  { code: '4001', name: 'Donor Contributions',   type: 'income'  },
  { code: '5001', name: 'Program Disbursements', type: 'expense' },
];

export interface OrgSystemJournalLine {
  accountCode: string;
  debit?:      number;
  credit?:     number;
}

export const organizationAccountingService = {

  /** Participates in the caller's own transaction — used when provisioning a new organization. */
  async seedDefaultAccountsInTx(client: PoolClient, organizationId: string): Promise<void> {
    for (const acct of DEFAULT_ORG_ACCOUNTS) {
      await client.query(
        `INSERT INTO organization_accounts (organization_id, account_code, name, type, is_system)
         VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (organization_id, account_code) DO NOTHING`,
        [organizationId, acct.code, acct.name, acct.type],
      );
    }
  },

  async listAccounts(ctx: TenantContext): Promise<OrgAccount[]> {
    await organizationService.assertOrganizationCoordinator(ctx);
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<OrgAccount>(
        `SELECT * FROM organization_accounts WHERE organization_id = $1 ORDER BY account_code`,
        [ctx.organizationId],
      );
      return rows;
    });
  },

  async getTrialBalance(ctx: TenantContext): Promise<OrgTrialBalanceLine[]> {
    await organizationService.assertOrganizationCoordinator(ctx);
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<OrgTrialBalanceLine>(
        `SELECT
           a.account_code  AS "accountCode",
           a.name          AS "accountName",
           a.type          AS "accountType",
           CASE WHEN a.type IN ('asset','expense') THEN a.balance ELSE -a.balance END::text AS "netBalance"
         FROM organization_accounts a
         WHERE a.organization_id = $1 AND a.is_active = true
         ORDER BY a.account_code`,
        [ctx.organizationId],
      );
      return rows;
    });
  },
};

/**
 * Posts a balanced system-generated journal entry within the CALLER's own
 * transaction, mirroring accounting.service.ts's postSystemJournal exactly
 * — same missing-account tolerance (logs + returns null rather than failing
 * the caller's real business transaction), same direct status='posted'
 * insert pattern relying on the deferred constraint trigger (migration 085)
 * to validate balance at COMMIT.
 */
export async function postOrgSystemJournal(
  client:          PoolClient,
  organizationId:  string,
  userId:          string | null,
  description:     string,
  lines:           OrgSystemJournalLine[],
  opts?: { reference?: string; entryDate?: string | Date; isTest?: boolean },
): Promise<string | null> {
  const codes = [...new Set(lines.map((l) => l.accountCode))];
  const { rows: accts } = await client.query<{ id: string; account_code: string }>(
    `SELECT id, account_code FROM organization_accounts
     WHERE organization_id = $1 AND account_code = ANY($2) AND is_active = true`,
    [organizationId, codes],
  );
  const byCode = new Map(accts.map((a) => [a.account_code, a.id]));
  if (byCode.size !== codes.length) {
    logger.warn('[org-accounting] postOrgSystemJournal: missing chart-of-accounts row(s), skipping posting', {
      organizationId, description, missing: codes.filter((c) => !byCode.has(c)),
    });
    return null;
  }

  const { rows: je } = await client.query<{ id: string }>(
    `INSERT INTO organization_journal_entries
       (organization_id, entry_date, reference, description, status, created_by, posted_at, is_test, posted_via)
     VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, 'posted', $5, NOW(), $6, $7) RETURNING id`,
    [
      organizationId, opts?.entryDate ?? null, opts?.reference ?? null, description, userId,
      opts?.isTest ?? false, userId ? 'user' : 'system',
    ],
  );
  const jeId = je[0]?.id;
  if (!jeId) return null;

  for (const line of lines) {
    await client.query(
      `INSERT INTO organization_journal_lines (organization_id, journal_entry_id, account_id, debit, credit)
       VALUES ($1, $2, $3, $4, $5)`,
      [organizationId, jeId, byCode.get(line.accountCode), (line.debit ?? 0).toFixed(2), (line.credit ?? 0).toFixed(2)],
    );
  }

  return jeId;
}

// Referenced so ValidationError stays a live import if this file grows
// request-facing methods later — avoids an unused-import lint error today.
void ValidationError;
