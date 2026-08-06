/**
 * Phase 0 of RBAC permission activation (SIMPLIFICATION_AND_RBAC_AUDIT.md
 * Workstream 4). Runs against real Postgres before any route migrates onto
 * withPermission() — a regression guard for the seed data itself, independent
 * of any application code.
 *
 * Two invariants:
 *  1. Monotonicity: chairperson's permissions are a superset of treasurer's,
 *     which is a superset of secretary's, which is a superset of member's.
 *     The seed data (migrations 077/079/110) is written to preserve this by
 *     construction; this test is what would have caught a mistake in any of
 *     them.
 *  2. Coverage: every (role, permission) pair the eventual route migration
 *     (batches 2-9) will rely on is already satisfied by the seeded arrays —
 *     built directly from the real withRole/withOneOf/ROLES.can*() route
 *     inventory, not aspirational.
 */
import { rawQuery } from '../helpers/db';

const RANKS = ['member', 'secretary', 'treasurer', 'chairperson'] as const;
type RoleCode = (typeof RANKS)[number];

async function seededPermissions(): Promise<Record<RoleCode, string[]>> {
  const rows = await rawQuery<{ code: RoleCode; permissions: string[] }>(
    `SELECT code, permissions FROM public.roles WHERE group_id IS NULL AND code = ANY($1)`,
    [RANKS as unknown as string[]],
  );
  const byCode = Object.fromEntries(rows.map((r) => [r.code, r.permissions])) as Record<RoleCode, string[]>;
  for (const code of RANKS) {
    if (!byCode[code]) throw new Error(`No system role row seeded for code='${code}'`);
  }
  return byCode;
}

describe('roles.permissions seed data', () => {
  it('is monotonic by rank: chairperson ⊇ treasurer ⊇ secretary ⊇ member', async () => {
    const perms = await seededPermissions();
    for (let i = 1; i < RANKS.length; i++) {
      const lower = new Set(perms[RANKS[i - 1]]);
      const higher = new Set(perms[RANKS[i]]);
      const missing = [...lower].filter((p) => !higher.has(p));
      expect({ higherRole: RANKS[i], missing }).toEqual({ higherRole: RANKS[i], missing: [] });
    }
  });

  // Built from the real withRole/withOneOf/ROLES.can*() route inventory
  // (verified this session against every app/api/v1/**/route.ts and
  // app/api/admin/**/route.ts call site) plus the net-new Meetings/Welfare/
  // Investments gates and the import/messaging reconciliation, all closed by
  // migration 110. This is the canonical catalog later batches migrate onto.
  const EXPECTED: Record<RoleCode, string[]> = {
    member: [
      'dashboard.view', 'meetings.view',
      'welfare.request', 'welfare.view', 'investments.view',
    ],
    secretary: [
      'members.view', 'members.manage', 'analytics.view', 'meetings.manage',
      'messaging.send', 'data.import',
      'import.preview', 'import.commit', 'import.cancel',
      'messaging.templates.view', 'messaging.schedules.view',
    ],
    treasurer: [
      'contributions.view', 'contributions.record', 'loans.view', 'loans.approve',
      'mpesa.view', 'payments.request', 'payments.approve', 'expenses.approve',
      'cashbook.view', 'accounting.manage', 'reports.view', 'governance.view',
      'welfare.manage', 'shares.manage', 'cycles.manage', 'dividends.manage',
      'treasury.manage', 'payouts.manage',
      'import.start', 'investments.manage',
      'credit_scores.recompute',
    ],
    chairperson: [
      'billing.manage', 'roles.manage',
      'dividends.approve', 'shares.reverse', 'payments.disburse',
      'data.rollback', 'admin.recompute', 'group.manage', 'messaging.manage',
      'import.rollback', 'messaging.templates.manage', 'messaging.schedules.manage',
      'fines.manage',
      'credit_scores.recompute',
      'loans.policy.manage', 'credit_scores.policy.manage', 'mpesa.bill_manager.manage',
    ],
  };

  it.each(RANKS)('%s has every permission its real route tiers require', async (role) => {
    const perms = await seededPermissions();
    const have = new Set(perms[role]);
    const missing = EXPECTED[role].filter((p) => !have.has(p));
    expect(missing).toEqual([]);
  });
});
