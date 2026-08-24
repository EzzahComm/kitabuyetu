/**
 * Investment portfolio summary.
 *
 * Regression cover for a summary that read KES 0 and a flat -100% ROI on a
 * perfectly healthy portfolio. Two facts about the module combine to cause it:
 * create() writes status='pending_approval' and only a PATCH moves a row to
 * 'active', and current_value stays NULL until someone records a revaluation.
 * A summary that filtered the value sum to status='active' and summed raw
 * current_value therefore measured an empty set against a real principal —
 * (0 - principal) / principal = -100%, shown to the group in red.
 */
import { withDb } from '@/lib/db';
import { investmentsService, RecordReturnSchema } from '@/lib/services/investments.service';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
  withAdminDb: jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: 'g1', userId: 'u1', role: 'treasurer' };

/** pg hands back `numeric` as a string — mirror that, it is half the bug. */
const summaryRow = (o: Record<string, string>) => ({
  rows: [{
    total_investments:  '1',
    active_count:       '0',
    held_count:         '1',
    total_principal:    '0',
    total_current_value:'0',
    total_returns:      '0',
    ...o,
  }],
});

describe('investmentsService.getSummary', () => {
  it('reports 0% ROI, not -100%, for a recorded investment awaiting approval', async () => {
    // One pending_approval holding, never revalued. The fixed query carries it
    // at cost, so value == principal and the group is flat, not wiped out.
    mockQuery.mockResolvedValueOnce(summaryRow({
      total_principal:     '100000',
      total_current_value: '100000',
      total_returns:       '0',
    }));

    const s = await investmentsService.getSummary(ctx);

    expect(s.totalCurrentValue).toBe(100000);
    expect(s.roi).toBe(0);
  });

  it('values the portfolio over every status except cancelled, falling back to cost', async () => {
    mockQuery.mockResolvedValueOnce(summaryRow({}));
    await investmentsService.getSummary(ctx);
    const sql = (mockQuery.mock.calls[0][0] as string).replace(/\s+/g, ' ');

    // The two specific regressions. Either one alone reproduces the bug.
    expect(sql).not.toMatch(/SUM\(current_value\) FILTER \(WHERE status='active'\)/);
    expect(sql).toMatch(/COALESCE\(current_value, principal_amount\)/);
    expect(sql).toMatch(/FILTER \(WHERE status<>'cancelled'\)/);
  });

  it('counts gains and returns into ROI', async () => {
    mockQuery.mockResolvedValueOnce(summaryRow({
      total_principal:     '100000',
      total_current_value: '120000',
      total_returns:       '5000',
    }));

    const s = await investmentsService.getSummary(ctx);

    expect(s.roi).toBe(25);           // (120000 + 5000 - 100000) / 100000
  });

  it('still reports a real loss as a loss', async () => {
    mockQuery.mockResolvedValueOnce(summaryRow({
      total_principal:     '100000',
      total_current_value: '80000',
      total_returns:       '0',
    }));

    expect((await investmentsService.getSummary(ctx)).roi).toBe(-20);
  });

  it('guards divide-by-zero on the string principal pg returns', async () => {
    // `'0' > 0` is false by coercion so the old code happened to work here,
    // but it was comparing a string — pin the behaviour explicitly.
    mockQuery.mockResolvedValueOnce(summaryRow({ total_principal: '0' }));

    const s = await investmentsService.getSummary(ctx);

    expect(s.roi).toBe(0);
    expect(Number.isNaN(s.roi)).toBe(false);
  });

  it('exposes heldCount alongside activeCount', async () => {
    mockQuery.mockResolvedValueOnce(summaryRow({ active_count: '2', held_count: '5' }));

    const s = await investmentsService.getSummary(ctx);

    expect(s.activeCount).toBe(2);
    expect(s.heldCount).toBe(5);
  });
});

describe('RecordReturnSchema', () => {
  it.each(['dividend', 'interest', 'capital_gain', 'rental_income', 'other'])(
    'accepts %s, a real member of public.return_type',
    (returnType) => {
      const parsed = RecordReturnSchema.safeParse({
        returnType, amount: 1000, returnDate: '2026-08-24',
      });
      expect(parsed.success).toBe(true);
    },
  );

  it('rejects coupon, which is not in the DB enum and failed at INSERT', () => {
    const parsed = RecordReturnSchema.safeParse({
      returnType: 'coupon', amount: 1000, returnDate: '2026-08-24',
    });
    expect(parsed.success).toBe(false);
  });
});
