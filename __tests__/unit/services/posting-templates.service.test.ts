/**
 * Posting templates (audit §29.9) — line building from named amounts, the
 * structure lock on overrides, and the template-resolution posting path.
 */
import { withDb, withTransaction } from '@/lib/db';
import { resolvePolicy, resolvePolicyDetailed, setPolicy } from '@/lib/services/configuration.service';
import { postSystemJournal } from '@/lib/services/accounting.service';
import {
  buildTemplateLines, postTemplatedJournal, postingTemplatesService,
  postLoanDisbursementJournal, postLoanRepaymentJournal,
  postSettlementSweepJournal, postVendorPaymentJournal,
  DEFAULT_TEMPLATES, POSTING_EVENTS, type TemplateLine,
} from '@/lib/services/posting-templates.service';
import { ValidationError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
}));
jest.mock('@/lib/services/configuration.service', () => ({
  resolvePolicy:         jest.fn(),
  resolvePolicyDetailed: jest.fn(),
  setPolicy:             jest.fn(),
}));
jest.mock('@/lib/services/accounting.service', () => ({
  ...jest.requireActual('@/lib/services/accounting.service'),
  postSystemJournal: jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (resolvePolicy as jest.Mock).mockReset();
  (resolvePolicyDetailed as jest.Mock).mockReset();
  (setPolicy as jest.Mock).mockReset().mockResolvedValue({ id: 'p-1', version: 2 });
  (postSystemJournal as jest.Mock).mockReset().mockResolvedValue('je-1');
});

const ctx = { groupId: 'g1', userId: 'user-1', role: 'treasurer', organizationId: 'org-1' };

describe('buildTemplateLines', () => {
  it('maps a single-amount template to debit/credit lines', () => {
    const lines = buildTemplateLines(DEFAULT_TEMPLATES.share_purchase, { amount: 500 });
    expect(lines).toEqual([
      { accountCode: '1001', debit: 500 },
      { accountCode: '3001', credit: 500 },
    ]);
  });

  it('drops zero-valued lines (dividend declaration without withholding posts two lines)', () => {
    const lines = buildTemplateLines(DEFAULT_TEMPLATES.dividend_declaration, { gross: 1000, net: 1000, tax: 0 });
    expect(lines).toEqual([
      { accountCode: '3101', debit: 1000 },
      { accountCode: '2103', credit: 1000 },
    ]);
  });

  it('keeps the tax line when withholding applies', () => {
    const lines = buildTemplateLines(DEFAULT_TEMPLATES.dividend_declaration, { gross: 1000, net: 850, tax: 150 });
    expect(lines).toEqual([
      { accountCode: '3101', debit: 1000 },
      { accountCode: '2103', credit: 850 },
      { accountCode: '2104', credit: 150 },
    ]);
  });

  it('inverts every side for reversals', () => {
    const lines = buildTemplateLines(DEFAULT_TEMPLATES.share_purchase, { amount: 500 }, { invert: true });
    expect(lines).toEqual([
      { accountCode: '1001', credit: 500 },
      { accountCode: '3001', debit: 500 },
    ]);
  });

  it('throws when a referenced amount role was not supplied', () => {
    expect(() => buildTemplateLines(DEFAULT_TEMPLATES.dividend_declaration, { gross: 1000, net: 1000 }))
      .toThrow(ValidationError);
  });

  it('throws on a negative amount', () => {
    expect(() => buildTemplateLines(DEFAULT_TEMPLATES.share_purchase, { amount: -5 }))
      .toThrow(ValidationError);
  });
});

describe('postTemplatedJournal', () => {
  it('resolves the group template and posts the built lines in the same transaction', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce(DEFAULT_TEMPLATES.welfare_disbursement);
    const jeId = await postTemplatedJournal(
      mockClient as never, 'g1', 'user-1', 'welfare_disbursement', 'Welfare payout', { amount: 200 }, { reference: 'r1' },
    );
    expect(jeId).toBe('je-1');
    expect(resolvePolicy).toHaveBeenCalledWith(
      mockClient, 'accounting', 'posting_template.welfare_disbursement', { groupId: 'g1' }, DEFAULT_TEMPLATES.welfare_disbursement,
    );
    expect(postSystemJournal).toHaveBeenCalledWith(
      mockClient, 'g1', 'user-1', 'Welfare payout',
      [{ accountCode: '2102', debit: 200 }, { accountCode: '1001', credit: 200 }],
      { reference: 'r1' },
    );
  });

  it('posts nothing when every line resolves to zero', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce(DEFAULT_TEMPLATES.share_purchase);
    const jeId = await postTemplatedJournal(
      mockClient as never, 'g1', 'user-1', 'share_purchase', 'Zero-cash allocation', { amount: 0 },
    );
    expect(jeId).toBeNull();
    expect(postSystemJournal).not.toHaveBeenCalled();
  });
});

// Moved from accounting.test.ts along with the functions themselves (§29.9
// second rollout). postSystemJournal is fully mocked here (see top of file),
// so these tests exercise postLoanDisbursementJournal/postLoanRepaymentJournal's
// own logic (template resolution, the charge-account existence check, member/
// membership lookup) rather than postSystemJournal's internals, which have
// their own coverage in this file's 'postTemplatedJournal' block.
describe('postLoanDisbursementJournal', () => {
  it('posts a 2-line entry (no charge)', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce(DEFAULT_TEMPLATES.loan_disbursement);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ member_id: 'mem-1', group_membership_id: 'gm-1' }] }) // member lookup
      .mockResolvedValueOnce({ rows: [] }); // final UPDATE

    const result = await postLoanDisbursementJournal(mockClient as never, {
      groupId: 'group-1', loanId: 'loan-1', principal: 50000,
      entryDate: '2026-01-15', createdBy: 'user-1',
    });

    expect(result).toEqual({ journalEntryId: 'je-1', chargePosted: false });
    expect(postSystemJournal).toHaveBeenCalledWith(
      mockClient, 'group-1', 'user-1', 'Loan disbursement — loan-1',
      [{ accountCode: '1101', debit: 50000 }, { accountCode: '1001', credit: 50000 }],
      { reference: undefined, memberId: 'mem-1', groupMembershipId: 'gm-1', entryDate: '2026-01-15', isTest: undefined },
    );
  });

  it('folds the fee in when a charge is passed and the charge-role account exists', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce(DEFAULT_TEMPLATES.loan_disbursement);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ account_code: '5001' }, { account_code: '1001' }] }) // charge-account check
      .mockResolvedValueOnce({ rows: [{ member_id: null, group_membership_id: null }] })
      .mockResolvedValueOnce({ rows: [] });
    (postSystemJournal as jest.Mock).mockResolvedValueOnce('je-2');

    const result = await postLoanDisbursementJournal(mockClient as never, {
      groupId: 'group-1', loanId: 'loan-2', principal: 50000, charge: 55,
      entryDate: '2026-01-15', createdBy: null, isTest: true,
    });

    expect(result).toEqual({ journalEntryId: 'je-2', chargePosted: true });
    expect(postSystemJournal).toHaveBeenCalledWith(
      mockClient, 'group-1', null, 'Loan disbursement — loan-2',
      [
        { accountCode: '1101', debit: 50000 }, { accountCode: '1001', credit: 50000 },
        { accountCode: '5001', debit: 55 },    { accountCode: '1001', credit: 55 },
      ],
      { reference: undefined, memberId: undefined, groupMembershipId: undefined, entryDate: '2026-01-15', isTest: true },
    );
  });

  it('falls back to principal-only when a charge exists but its account is missing from the chart', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce(DEFAULT_TEMPLATES.loan_disbursement);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ account_code: '1001' }] }) // 5001 missing from the charge-role check
      .mockResolvedValueOnce({ rows: [{ member_id: 'mem-3', group_membership_id: null }] })
      .mockResolvedValueOnce({ rows: [] });
    (postSystemJournal as jest.Mock).mockResolvedValueOnce('je-3');

    const result = await postLoanDisbursementJournal(mockClient as never, {
      groupId: 'group-1', loanId: 'loan-3', principal: 50000, charge: 55,
      entryDate: '2026-01-15', createdBy: 'user-1',
    });

    expect(result).toEqual({ journalEntryId: 'je-3', chargePosted: false });
    expect(postSystemJournal).toHaveBeenCalledWith(
      mockClient, 'group-1', 'user-1', 'Loan disbursement — loan-3',
      [{ accountCode: '1101', debit: 50000 }, { accountCode: '1001', credit: 50000 }],
      expect.objectContaining({ memberId: 'mem-3' }),
    );
  });

  it('returns null when postSystemJournal cannot post (e.g. 1001/1101 missing from the chart)', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce(DEFAULT_TEMPLATES.loan_disbursement);
    mockQuery.mockResolvedValueOnce({ rows: [{ member_id: null, group_membership_id: null }] });
    (postSystemJournal as jest.Mock).mockResolvedValueOnce(null);

    const result = await postLoanDisbursementJournal(mockClient as never, {
      groupId: 'group-1', loanId: 'loan-4', principal: 50000,
      entryDate: '2026-01-15', createdBy: 'user-1',
    });

    expect(result).toBeNull();
    // No UPDATE issued after a null journal — only the member-lookup query ran.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('postLoanRepaymentJournal', () => {
  it('posts a 4-line entry when there is an interest portion (principal + interest cash lines, both to 1001)', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce(DEFAULT_TEMPLATES.loan_repayment);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ member_id: 'mem-1', group_membership_id: 'gm-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await postLoanRepaymentJournal(mockClient as never, {
      groupId: 'group-1', repaymentId: 'rep-1', loanId: 'loan-1',
      principalPortion: 4000, interestPortion: 500,
      entryDate: '2026-01-15', createdBy: 'user-1',
    });

    expect(result).toBe('je-1');
    expect(postSystemJournal).toHaveBeenCalledWith(
      mockClient, 'group-1', 'user-1', 'Loan repayment — loan-1 #rep-1',
      [
        { accountCode: '1001', debit: 4000 }, { accountCode: '1101', credit: 4000 },
        { accountCode: '1001', debit: 500 },  { accountCode: '4002', credit: 500 },
      ],
      { reference: undefined, memberId: 'mem-1', groupMembershipId: 'gm-1', entryDate: '2026-01-15', isTest: undefined },
    );
  });

  it('omits the interest lines entirely when interestPortion is zero', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce(DEFAULT_TEMPLATES.loan_repayment);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ member_id: null, group_membership_id: null }] })
      .mockResolvedValueOnce({ rows: [] });
    (postSystemJournal as jest.Mock).mockResolvedValueOnce('je-2');

    const result = await postLoanRepaymentJournal(mockClient as never, {
      groupId: 'group-1', repaymentId: 'rep-2', loanId: 'loan-2',
      principalPortion: 4500, interestPortion: 0,
      entryDate: '2026-01-15', createdBy: null, isTest: true,
    });

    expect(result).toBe('je-2');
    expect(postSystemJournal).toHaveBeenCalledWith(
      mockClient, 'group-1', null, 'Loan repayment — loan-2 #rep-2',
      [{ accountCode: '1001', debit: 4500 }, { accountCode: '1101', credit: 4500 }],
      expect.anything(),
    );
  });

  it('returns null when an interest portion is due but postSystemJournal cannot post (e.g. 4002 missing)', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce(DEFAULT_TEMPLATES.loan_repayment);
    mockQuery.mockResolvedValueOnce({ rows: [{ member_id: null, group_membership_id: null }] });
    (postSystemJournal as jest.Mock).mockResolvedValueOnce(null);

    const result = await postLoanRepaymentJournal(mockClient as never, {
      groupId: 'group-1', repaymentId: 'rep-3', loanId: 'loan-3',
      principalPortion: 4000, interestPortion: 500,
      entryDate: '2026-01-15', createdBy: 'user-1',
    });

    expect(result).toBeNull();
  });
});

describe('postingTemplatesService.setGroupOverride', () => {
  const remapped: TemplateLine[] = [
    { accountCode: '1002', side: 'debit',  amount: 'amount' }, // Bank instead of Cash
    { accountCode: '3001', side: 'credit', amount: 'amount' },
  ];

  it('accepts an account remap that keeps the structure, after checking the group COA', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ account_code: '1002' }, { account_code: '3001' }] });
    await postingTemplatesService.setGroupOverride(ctx, 'share_purchase', remapped);
    expect(setPolicy).toHaveBeenCalledWith(
      mockClient, 'accounting', 'posting_template.share_purchase', { groupId: 'g1' }, { lines: remapped }, 'user-1',
    );
  });

  it('rejects an amount-role change (structure is locked)', async () => {
    const roleChange: TemplateLine[] = [
      { accountCode: '1001', side: 'debit',  amount: 'gross' },
      { accountCode: '3001', side: 'credit', amount: 'amount' },
    ];
    await expect(postingTemplatesService.setGroupOverride(ctx, 'share_purchase', roleChange))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an unbalanced side change (all lines on one side)', async () => {
    const oneSided: TemplateLine[] = [
      { accountCode: '1001', side: 'debit', amount: 'amount' },
      { accountCode: '3001', side: 'debit', amount: 'amount' },
    ];
    await expect(postingTemplatesService.setGroupOverride(ctx, 'share_purchase', oneSided))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a line-count change', async () => {
    const extra: TemplateLine[] = [
      { accountCode: '1001', side: 'debit',  amount: 'amount' },
      { accountCode: '3001', side: 'credit', amount: 'amount' },
      { accountCode: '4004', side: 'credit', amount: 'amount' },
    ];
    await expect(postingTemplatesService.setGroupOverride(ctx, 'share_purchase', extra))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects codes missing from the group chart of accounts', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ account_code: '3001' }] }); // 1002 missing
    await expect(postingTemplatesService.setGroupOverride(ctx, 'share_purchase', remapped))
      .rejects.toBeInstanceOf(ValidationError);
    expect(setPolicy).not.toHaveBeenCalled();
  });
});

describe('postingTemplatesService.setPlatformDefault', () => {
  it('rejects non-standard chart codes at platform scope', async () => {
    const custom: TemplateLine[] = [
      { accountCode: '9999', side: 'debit',  amount: 'amount' },
      { accountCode: '3001', side: 'credit', amount: 'amount' },
    ];
    await expect(postingTemplatesService.setPlatformDefault('admin-1', mockClient as never, 'share_purchase', custom))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts standard codes and writes at platform scope', async () => {
    const remap: TemplateLine[] = [
      { accountCode: '1002', side: 'debit',  amount: 'amount' },
      { accountCode: '3001', side: 'credit', amount: 'amount' },
    ];
    await postingTemplatesService.setPlatformDefault('admin-1', mockClient as never, 'share_purchase', remap);
    expect(setPolicy).toHaveBeenCalledWith(
      mockClient, 'accounting', 'posting_template.share_purchase', {}, { lines: remap }, 'admin-1',
    );
  });
});

describe('defaults', () => {
  it('covers every posting event with a balanced-by-construction structure', () => {
    for (const event of POSTING_EVENTS) {
      const t = DEFAULT_TEMPLATES[event];
      expect(t.lines.length).toBeGreaterThanOrEqual(2);
      expect(t.lines.some((l) => l.side === 'debit')).toBe(true);
      expect(t.lines.some((l) => l.side === 'credit')).toBe(true);
    }
  });
});

// ─── Settlement sweep / vendor payment wrappers ──────────────────────────

describe('postSettlementSweepJournal', () => {
  beforeEach(() => {
    (resolvePolicy as jest.Mock).mockResolvedValue(DEFAULT_TEMPLATES.settlement_sweep);
  });

  it('posts DR bank / CR cash and stamps the journal id onto the settlement', async () => {
    // The fee lines reference BOTH 5001 and 1001, and the guard requires
    // every referenced account to exist before posting the fee (same rule
    // postLoanDisbursementJournal applies to its charge lines).
    mockQuery
      .mockResolvedValueOnce({ rows: [{ account_code: '5001' }, { account_code: '1001' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE settlement_requests

    const jeId = await postSettlementSweepJournal(mockClient as never, {
      groupId: 'g1', settlementId: 'set-1', amount: 5000, fee: 20,
      entryDate: '2026-08-11', createdBy: null,
    });

    expect(jeId).toBe('je-1');
    const lines = (postSystemJournal as jest.Mock).mock.calls[0][4];
    expect(lines).toEqual(expect.arrayContaining([
      { accountCode: '1002', debit: 5000 },
      { accountCode: '1001', credit: 5000 },
      { accountCode: '5001', debit: 20 },
      { accountCode: '1001', credit: 20 },
    ]));

    const update = mockQuery.mock.calls[1];
    expect(String(update[0])).toContain('UPDATE settlement_requests');
    expect(update[1]).toEqual(['je-1', 'set-1']);
  });

  it('drops just the fee lines when the fee account is missing (graceful degradation)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // fee account NOT in the group's chart
      .mockResolvedValueOnce({ rows: [] });

    await postSettlementSweepJournal(mockClient as never, {
      groupId: 'g1', settlementId: 'set-1', amount: 5000, fee: 20,
      entryDate: '2026-08-11', createdBy: null,
    });

    const lines = (postSystemJournal as jest.Mock).mock.calls[0][4];
    expect(lines).toHaveLength(2); // principal only — the sweep still posts
    expect(lines).toEqual(expect.arrayContaining([
      { accountCode: '1002', debit: 5000 },
      { accountCode: '1001', credit: 5000 },
    ]));
  });
});

describe('postVendorPaymentJournal', () => {
  beforeEach(() => {
    (resolvePolicy as jest.Mock).mockResolvedValue(DEFAULT_TEMPLATES.vendor_payment);
  });

  it('overrides the expense line with the row\'s own expense_account_code', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ account_code: '5001' }, { account_code: '1001' }] })
      .mockResolvedValueOnce({ rows: [] });

    await postVendorPaymentJournal(mockClient as never, {
      groupId: 'g1', vendorPaymentId: 'vp-1', amount: 1000, fee: 10,
      expenseAccountCode: '5010', entryDate: '2026-08-11', createdBy: null,
    });

    const lines = (postSystemJournal as jest.Mock).mock.calls[0][4];
    // The main expense debit uses the per-row override, not the template's 5001.
    expect(lines).toEqual(expect.arrayContaining([
      { accountCode: '5010', debit: 1000 },
      { accountCode: '1001', credit: 1000 },
    ]));
    // The fee line keeps the template's own account — the override is
    // scoped to the payment's expense, not the Safaricom charge.
    expect(lines).toEqual(expect.arrayContaining([{ accountCode: '5001', debit: 10 }]));
  });

  it('stamps the journal id onto the vendor payment row', async () => {
    // No fee passed, so no fee-account lookup happens — the UPDATE is the
    // only query.
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await postVendorPaymentJournal(mockClient as never, {
      groupId: 'g1', vendorPaymentId: 'vp-1', amount: 1000,
      expenseAccountCode: '5001', entryDate: '2026-08-11', createdBy: null,
    });

    const update = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
    expect(String(update[0])).toContain('UPDATE vendor_payments');
    expect(update[1]).toEqual(['je-1', 'vp-1']);
  });

  it('returns null when the journal itself could not post', async () => {
    (postSystemJournal as jest.Mock).mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [{ account_code: '5001' }, { account_code: '1001' }] });

    const jeId = await postVendorPaymentJournal(mockClient as never, {
      groupId: 'g1', vendorPaymentId: 'vp-1', amount: 1000, fee: 10,
      expenseAccountCode: '5001', entryDate: '2026-08-11', createdBy: null,
    });

    expect(jeId).toBeNull();
  });
});
