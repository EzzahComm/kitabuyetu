/**
 * Ecosystem marketplace (Phase 13) — the eligibility matching engine
 * (evaluateEligibility/evaluateRule existed since Phase 8 but were never
 * exercised by a test, since nothing called them until this pass wired
 * them up), the real group-data resolver that feeds it, and the generic
 * updateOpportunity() this pass added (there was previously no way to edit
 * an opportunity's eligibility_rules after creation).
 */
import { withAdminDb } from '@/lib/db';
import {
  evaluateEligibility, evaluateEligibilityDetailed, getGroupEligibilityData, updateOpportunity,
  type Opportunity,
} from '@/lib/services/ecosystem.service';
import { NotFoundError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withAdminDb: jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
});

function opportunityWithRules(rules: unknown[]): Opportunity {
  return { eligibility_rules: { rules } } as unknown as Opportunity;
}

describe('evaluateEligibility — rule types', () => {
  it('range: before_or_equal passes when the group is old enough', async () => {
    const opp = opportunityWithRules([
      { id: 'r1', name: 'Founded early', type: 'range', field: 'created_at', operator: 'before_or_equal', value: '2026-06-01', error_message: 'Too new' },
    ]);
    const result = await evaluateEligibility(opp, { type: 'chama', created_at: new Date('2026-01-01'), cash_balance: 0 });
    expect(result.matches).toBe(true);
  });

  it('range: fails a group founded after the cutoff', async () => {
    const opp = opportunityWithRules([
      { id: 'r1', name: 'Founded early', type: 'range', field: 'created_at', operator: 'before_or_equal', value: '2026-01-01', error_message: 'Too new' },
    ]);
    const result = await evaluateEligibility(opp, { type: 'chama', created_at: new Date('2026-06-01'), cash_balance: 0 });
    expect(result.matches).toBe(false);
    expect(result.failed_rules).toEqual(['r1']);
  });

  it('enum_whitelist: passes when the group type is in the allowed list', async () => {
    const opp = opportunityWithRules([
      { id: 'r1', name: 'Chama or SACCO', type: 'enum_whitelist', field: 'type', values: ['chama', 'sacco'], error_message: 'Wrong type' },
    ]);
    const result = await evaluateEligibility(opp, { type: 'sacco', created_at: new Date(), cash_balance: 0 });
    expect(result.matches).toBe(true);
  });

  it('geo: fails when the county is not in the allowed list', async () => {
    const opp = opportunityWithRules([
      { id: 'r1', name: 'Nairobi only', type: 'geo', field: 'county', values: ['Nairobi'], error_message: 'Wrong county' },
    ]);
    const result = await evaluateEligibility(opp, { type: 'chama', created_at: new Date(), cash_balance: 0, county: 'Kiambu' });
    expect(result.matches).toBe(false);
  });

  it('financial: supports all four operators', async () => {
    const makeOpp = (operator: string, value: number) => opportunityWithRules([
      { id: 'r1', name: 'Balance', type: 'financial', field: 'cash_balance', operator, value, error_message: 'Balance' },
    ]);
    const groupData = { type: 'chama', created_at: new Date(), cash_balance: 500 };

    expect((await evaluateEligibility(makeOpp('>=', 500), groupData)).matches).toBe(true);
    expect((await evaluateEligibility(makeOpp('>', 500), groupData)).matches).toBe(false);
    expect((await evaluateEligibility(makeOpp('<=', 500), groupData)).matches).toBe(true);
    expect((await evaluateEligibility(makeOpp('<', 500), groupData)).matches).toBe(false);
  });

  it('external_check always passes (stubbed pending Phase 8.2 3rd-party integration)', async () => {
    const opp = opportunityWithRules([
      { id: 'r1', name: 'Credit check', type: 'external_check', function: 'checkCreditBureau', error_message: 'Failed check' },
    ]);
    const result = await evaluateEligibility(opp, { type: 'chama', created_at: new Date(), cash_balance: 0 });
    expect(result.matches).toBe(true);
  });

  it('a malformed rule fails closed rather than throwing', async () => {
    const opp = opportunityWithRules([
      { id: 'r1', name: 'Broken', type: 'financial', field: 'cash_balance', error_message: 'Missing operator/value' },
    ]);
    const result = await evaluateEligibility(opp, { type: 'chama', created_at: new Date(), cash_balance: 1000 });
    expect(result.matches).toBe(false);
    expect(result.failed_rules).toEqual(['r1']);
  });

  it('no rules at all always matches', async () => {
    const opp = opportunityWithRules([]);
    const result = await evaluateEligibility(opp, { type: 'chama', created_at: new Date(), cash_balance: 0 });
    expect(result.matches).toBe(true);
  });
});

describe('evaluateEligibilityDetailed', () => {
  it('maps failed rule ids back to the full rule objects for display', async () => {
    const opp = opportunityWithRules([
      { id: 'r1', name: 'Balance too low', type: 'financial', field: 'cash_balance', operator: '>=', value: 10000, error_message: 'Need KES 10,000' },
      { id: 'r2', name: 'Any type', type: 'enum_whitelist', field: 'type', values: ['chama', 'sacco'], error_message: 'Wrong type' },
    ]);
    const { matches, failedRules } = await evaluateEligibilityDetailed(opp, { type: 'chama', created_at: new Date(), cash_balance: 0 });

    expect(matches).toBe(false);
    expect(failedRules).toHaveLength(1);
    expect(failedRules[0].error_message).toBe('Need KES 10,000');
  });
});

describe('getGroupEligibilityData', () => {
  it('returns null for an unknown group', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getGroupEligibilityData(mockClient as any, 'ghost')).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1); // never reaches the finance query
  });

  it('computes cash_balance as contributions + shares - loans', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ type: 'chama', created_at: new Date('2026-01-01'), county: 'Nairobi' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ contributions: '10000', shares: '5000', loans: '3000' }] });

    const result = await getGroupEligibilityData(mockClient as any, 'grp-1');

    expect(result).toEqual({ type: 'chama', created_at: new Date('2026-01-01'), cash_balance: 12000, county: 'Nairobi' });
  });
});

describe('updateOpportunity', () => {
  it('returns null on an empty update without querying', async () => {
    const result = await updateOpportunity({ userId: 'admin-1' }, 'opp-1', {});
    expect(result).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('throws NotFoundError for an unknown opportunity', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(updateOpportunity({ userId: 'admin-1' }, 'ghost', { title: 'New title' }))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('casts eligibility_rules to jsonb and logs an audit entry', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'opp-1', eligibility_rules: { rules: [] } }] }); // update
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit

    const rules = { rules: [{ id: 'r1', name: 'x', type: 'financial' as const, error_message: 'x' }] };
    await updateOpportunity({ userId: 'admin-1' }, 'opp-1', { eligibility_rules: rules });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('eligibility_rules = $2::jsonb');
    expect(params[1]).toBe(JSON.stringify(rules));
    expect(String(mockQuery.mock.calls[1][0])).toContain('INSERT INTO audit_logs');
  });
});
