/**
 * Loan charges engine (migration 179): the money-accuracy properties.
 *   - fee amounts are computed and rounded to whole cents correctly
 *   - a charge is never applied twice (retried disburse / repayment)
 *   - late fees fire only for instalments paid AFTER their due date
 *   - each application posts the GL entry and an audit row
 *   - waiving reverses the GL entry only for a still-pending charge
 */
import { withTransaction, withDb } from '@/lib/db';
import { postTemplatedJournal } from '@/lib/services/posting-templates.service';
import {
  applyDisbursementCharges,
  applyOverdueCharges,
  getEffectiveChargeTypes,
  loanChargesService,
} from '@/lib/services/loan-charges.service';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/utils/errors';
import type { PoolClient } from 'pg';
import type { TenantContext } from '@/lib/db';

jest.mock('@/lib/db', () => ({ withDb: jest.fn(), withTransaction: jest.fn() }));
jest.mock('@/lib/services/posting-templates.service', () => ({
  postTemplatedJournal: jest.fn().mockResolvedValue('je-1'),
}));

const mockQuery = jest.fn();
const client = { query: mockQuery } as unknown as PoolClient;
const ctx: TenantContext = { userId: 'user-1', groupId: 'group-1', role: 'treasurer' };

const typeRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'ct-1',
  name: 'Processing fee',
  calculation_type: 'percentage',
  amount: '2.5',
  trigger_event: 'on_disburse',
  is_active: true,
  specificity: 2,
  ...over,
});

/** Route queries by SQL so tests read as behaviour, not call order. */
function scenario(opts: {
  chargeTypes: unknown[];
  alreadyCharged?: boolean;
  insertedAmount?: (params: unknown[]) => string;
}) {
  mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/FROM loan_charge_types/.test(sql)) return { rows: opts.chargeTypes };
    if (/SELECT id FROM loan_charges/.test(sql)) return { rows: opts.alreadyCharged ? [{ id: 'existing' }] : [] };
    if (/SELECT member_id, group_membership_id/.test(sql))
      return { rows: [{ member_id: 'm-1', group_membership_id: 'gm-1' }] };
    if (/INSERT INTO loan_charges/.test(sql)) {
      return {
        rows: [
          {
            id: 'lc-1',
            amount: opts.insertedAmount ? opts.insertedAmount(params) : String(params[4]),
            journal_entry_id: null,
          },
        ],
      };
    }
    if (/UPDATE loan_charges SET journal_entry_id/.test(sql)) {
      return { rows: [{ id: 'lc-1', amount: '0', journal_entry_id: params[0] }] };
    }
    return { rows: [] };
  });
}

const inserts = () => mockQuery.mock.calls.filter(([sql]) => /INSERT INTO loan_charges/.test(sql));
const audits = () => mockQuery.mock.calls.filter(([sql]) => /INSERT INTO audit_logs/.test(sql));

beforeEach(() => {
  mockQuery.mockReset();
  (postTemplatedJournal as jest.Mock).mockClear();
  (withTransaction as jest.Mock).mockImplementation((_c, fn) => fn(client));
  (withDb as jest.Mock).mockImplementation((_c, fn) => fn(client));
});

describe('getEffectiveChargeTypes', () => {
  it('maps specificity to the policy source and parses the configured amount', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        typeRow({ specificity: 2 }),
        typeRow({ id: 'ct-2', name: 'Insurance', specificity: 1, amount: '150' }),
        typeRow({ id: 'ct-3', name: 'Base', specificity: 0 }),
      ],
    });
    const out = await getEffectiveChargeTypes(client, { groupId: 'group-1' });
    expect(out.map((c) => c.source)).toEqual(['group', 'organization', 'platform']);
    expect(out[1].amount).toBe(150);
    expect(out[0].calculationType).toBe('percentage');
  });

  it('passes the trigger filter (or null) and both scopes to the query', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await getEffectiveChargeTypes(client, { organizationId: 'org-1', groupId: 'group-1' }, 'on_overdue');
    expect(mockQuery.mock.calls[0][1]).toEqual(['org-1', 'group-1', 'on_overdue']);
    await getEffectiveChargeTypes(client, {});
    expect(mockQuery.mock.calls[1][1]).toEqual([null, null, null]);
  });
});

describe('applyDisbursementCharges', () => {
  const loan = { id: 'loan-1', principal_amount: '50000.00', disbursement_date: '2026-09-01' };

  it('charges a percentage fee on the principal, to the cent', async () => {
    scenario({ chargeTypes: [typeRow({ amount: '2.5' })] });
    await applyDisbursementCharges(client, ctx, loan);
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0][1][4]).toBe('1250.00'); // 2.5% of 50,000
  });

  it('rounds to the nearest cent instead of truncating', async () => {
    scenario({ chargeTypes: [typeRow({ amount: '2.5' })] });
    await applyDisbursementCharges(client, ctx, { ...loan, principal_amount: '33333.33' });
    expect(inserts()[0][1][4]).toBe('833.33'); // 833.33325 rounds down
    mockQuery.mockClear();
    await applyDisbursementCharges(client, ctx, { ...loan, principal_amount: '40000.20' });
    expect(inserts()[0][1][4]).toBe('1000.01'); // 1000.005 rounds UP (truncation would give 1000.00)
  });

  it('charges a flat fee as configured, independent of the principal', async () => {
    scenario({ chargeTypes: [typeRow({ calculation_type: 'flat', amount: '500' })] });
    await applyDisbursementCharges(client, ctx, { ...loan, principal_amount: '1000000' });
    expect(inserts()[0][1][4]).toBe('500.00');
  });

  it('applies every configured charge type once', async () => {
    scenario({
      chargeTypes: [typeRow(), typeRow({ id: 'ct-2', name: 'Insurance', calculation_type: 'flat', amount: '200' })],
    });
    await applyDisbursementCharges(client, ctx, loan);
    expect(inserts().map(([, p]) => p[2])).toEqual(['ct-1', 'ct-2']);
  });

  it('is a no-op when the group has no on_disburse charges configured', async () => {
    scenario({ chargeTypes: [] });
    await applyDisbursementCharges(client, ctx, loan);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(inserts()).toHaveLength(0);
  });

  it('does not charge twice when the loan was already charged (retried disburse)', async () => {
    scenario({ chargeTypes: [typeRow()], alreadyCharged: true });
    await applyDisbursementCharges(client, ctx, loan);
    expect(inserts()).toHaveLength(0);
    expect(postTemplatedJournal).not.toHaveBeenCalled();
    expect(audits()).toHaveLength(0);
  });

  it('skips a charge that resolves to zero', async () => {
    scenario({ chargeTypes: [typeRow({ amount: '0' })] });
    await applyDisbursementCharges(client, ctx, loan);
    expect(inserts()).toHaveLength(0);
    // no idempotency lookup either: nothing to charge
    expect(mockQuery.mock.calls.some(([sql]) => /SELECT id FROM loan_charges/.test(sql))).toBe(false);
  });

  it('posts the GL entry with member tagging and the disbursement date, then audits', async () => {
    scenario({ chargeTypes: [typeRow()] });
    await applyDisbursementCharges(client, ctx, { ...loan, disbursement_date: new Date('2026-09-01T00:00:00.000Z') });
    expect(postTemplatedJournal).toHaveBeenCalledWith(
      client,
      'group-1',
      'user-1',
      'loan_charge',
      'Processing fee — loan loan-1',
      { amount: 1250 },
      { reference: 'lc-1', memberId: 'm-1', groupMembershipId: 'gm-1', entryDate: '2026-09-01' },
    );
    // journal id is linked back onto the charge
    expect(mockQuery.mock.calls.some(([sql, p]) => /SET journal_entry_id/.test(sql) && p[0] === 'je-1')).toBe(true);
    expect(audits()[0][1]).toEqual(expect.arrayContaining(['group-1', 'user-1', 'loan_charge.applied']));
    expect(JSON.parse(audits()[0][1][5]).trigger).toBe('on_disburse');
  });
});

describe('applyOverdueCharges', () => {
  const loan = { id: 'loan-1', principal_amount: '20000' };
  const overdueFee = typeRow({
    id: 'late-1',
    name: 'Late fee',
    calculation_type: 'flat',
    amount: '300',
    trigger_event: 'on_overdue',
  });

  it.each([
    ['on the due date', '2026-09-10'],
    ['before the due date', '2026-09-05'],
  ])('charges nothing when paid %s', async (_label, asOf) => {
    scenario({ chargeTypes: [overdueFee] });
    await applyOverdueCharges(client, ctx, loan, { id: 'inst-1', due_date: '2026-09-10' }, asOf);
    expect(mockQuery).not.toHaveBeenCalled(); // not even a catalogue lookup
  });

  it('charges the late fee when paid after the due date, keyed to that instalment', async () => {
    scenario({ chargeTypes: [overdueFee] });
    await applyOverdueCharges(
      client,
      ctx,
      loan,
      { id: 'inst-1', due_date: new Date('2026-09-10T00:00:00.000Z') },
      '2026-09-11',
    );
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0][1]).toEqual(['group-1', 'loan-1', 'late-1', 'inst-1', '300.00']);
    // the idempotency check is per instalment, not per loan
    const lookup = mockQuery.mock.calls.find(([sql]) => /SELECT id FROM loan_charges/.test(sql))!;
    expect(lookup[0]).toMatch(/loan_repayment_id = \$1/);
    expect(lookup[1]).toEqual(['inst-1', 'late-1']);
    expect(postTemplatedJournal).toHaveBeenCalledWith(
      client,
      'group-1',
      'user-1',
      'loan_charge',
      'Late fee — loan loan-1',
      { amount: 300 },
      expect.objectContaining({ entryDate: '2026-09-11' }),
    );
    expect(JSON.parse(audits()[0][1][5]).trigger).toBe('on_overdue');
  });

  it('does not double-charge the same overdue instalment', async () => {
    scenario({ chargeTypes: [overdueFee], alreadyCharged: true });
    await applyOverdueCharges(client, ctx, loan, { id: 'inst-1', due_date: '2026-09-10' }, '2026-09-20');
    expect(inserts()).toHaveLength(0);
  });
});

describe('loanChargesService.configureChargeType', () => {
  const input = {
    name: 'Processing fee',
    calculationType: 'percentage',
    amount: 2.5,
    triggerEvent: 'on_disburse',
    isActive: true,
  } as never;

  it('creates a group-level charge type with a 4-decimal amount', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      /INSERT INTO loan_charge_types/.test(sql) ? { rows: [{ id: 'ct-9', name: 'Processing fee' }] } : { rows: [] },
    );
    const out = await loanChargesService.configureChargeType(ctx, input);
    expect(out.id).toBe('ct-9');
    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO loan_charge_types/.test(sql))!;
    expect(insert[1]).toEqual(['group-1', 'Processing fee', 'percentage', '2.5000', 'on_disburse', true, 'user-1']);
    expect(audits()[0][1]).toContain('loan_charge_type.create');
  });

  it('updates only a charge type that belongs to the caller’s group', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ownership lookup finds nothing
    await expect(
      loanChargesService.configureChargeType(ctx, { ...(input as object), id: 'other-groups' } as never),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockQuery.mock.calls[0][0]).toMatch(/group_id = \$2 AND organization_id IS NULL/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['other-groups', 'group-1']);
  });

  it('translates the active-scope unique violation into a friendly conflict', async () => {
    mockQuery.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: '23505', constraint: 'loan_charge_types_active_scope_unique' }),
    );
    await expect(loanChargesService.configureChargeType(ctx, input)).rejects.toBeInstanceOf(ConflictError);
  });

  it('rethrows unrelated database errors untouched', async () => {
    const boom = Object.assign(new Error('deadlock'), { code: '40P01' });
    mockQuery.mockRejectedValueOnce(boom);
    await expect(loanChargesService.configureChargeType(ctx, input)).rejects.toBe(boom);
  });
});

describe('loanChargesService.waiveCharge', () => {
  const pending = { id: 'lc-1', loan_id: 'loan-1', amount: '1250.00', status: 'pending', journal_entry_id: 'je-1' };

  it('reverses the posted GL entry (inverted) and marks the charge waived', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM loan_charges/.test(sql)) return { rows: [pending] };
      if (/SELECT member_id, group_membership_id FROM loans/.test(sql))
        return { rows: [{ member_id: 'm-1', group_membership_id: 'gm-1' }] };
      if (/UPDATE loan_charges/.test(sql)) return { rows: [{ ...pending, status: 'waived' }] };
      return { rows: [] };
    });
    const out = await loanChargesService.waiveCharge(ctx, 'lc-1', 'hardship');
    expect(out.status).toBe('waived');
    expect(postTemplatedJournal).toHaveBeenCalledWith(
      client,
      'group-1',
      'user-1',
      'loan_charge',
      'Waived charge reversal — lc-1',
      { amount: 1250 },
      { reference: 'lc-1', invert: true, memberId: 'm-1', groupMembershipId: 'gm-1' },
    );
    expect(JSON.parse(audits()[0][1][5])).toEqual({ status: 'waived', reason: 'hardship' });
  });

  it('does not post a reversal for a charge that never reached the GL', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM loan_charges/.test(sql)) return { rows: [{ ...pending, journal_entry_id: null }] };
      if (/UPDATE loan_charges/.test(sql)) return { rows: [{ ...pending, status: 'waived' }] };
      return { rows: [] };
    });
    await loanChargesService.waiveCharge(ctx, 'lc-1', 'hardship');
    expect(postTemplatedJournal).not.toHaveBeenCalled();
  });

  it.each(['paid', 'waived'])('refuses to waive a %s charge and posts nothing', async (status) => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...pending, status }] });
    await expect(loanChargesService.waiveCharge(ctx, 'lc-1', 'x')).rejects.toBeInstanceOf(ValidationError);
    expect(postTemplatedJournal).not.toHaveBeenCalled();
  });

  it('is scoped to the caller’s group', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(loanChargesService.waiveCharge(ctx, 'foreign', 'x')).rejects.toBeInstanceOf(NotFoundError);
    expect(mockQuery.mock.calls[0][1]).toEqual(['foreign', 'group-1']);
  });
});

describe('loanChargesService.listChargesForLoan', () => {
  it('404s for a loan outside the caller’s group before reading any charges', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(loanChargesService.listChargesForLoan(ctx, 'foreign-loan')).rejects.toBeInstanceOf(NotFoundError);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('lists charges scoped by loan and group', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'loan-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'lc-1', charge_type_name: 'Late fee' }] });
    const out = await loanChargesService.listChargesForLoan(ctx, 'loan-1');
    expect(out).toHaveLength(1);
    expect(mockQuery.mock.calls[1][1]).toEqual(['loan-1', 'group-1']);
  });
});
