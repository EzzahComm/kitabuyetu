/**
 * Posting templates (audit §29.9) — line building from named amounts, the
 * structure lock on overrides, and the template-resolution posting path.
 */
import { withDb, withTransaction } from '@/lib/db';
import { resolvePolicy, resolvePolicyDetailed, setPolicy } from '@/lib/services/configuration.service';
import { postSystemJournal } from '@/lib/services/accounting.service';
import {
  buildTemplateLines, postTemplatedJournal, postingTemplatesService,
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
