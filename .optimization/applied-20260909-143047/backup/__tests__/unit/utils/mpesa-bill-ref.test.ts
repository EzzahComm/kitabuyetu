import { parseBillRefNumber, isSandboxTestRef } from '@/lib/utils/mpesa-bill-ref';

describe('parseBillRefNumber — contribution prefix', () => {
  it('parses KYT-CONTR-<group_code>', () => {
    const r = parseBillRefNumber('KYT-CONTR-KY1234567');
    expect(r.kind).toBe('contribution');
    expect(r.groupCode).toBe('KY1234567');
    expect(r.memberCode).toBeNull();
  });

  it('parses KYT-CONTR-<group_code>-<member_code>', () => {
    const r = parseBillRefNumber('KYT-CONTR-KY1234567-MEM00042');
    expect(r.kind).toBe('contribution');
    expect(r.groupCode).toBe('KY1234567');
    expect(r.memberCode).toBe('MEM00042');
  });

  it('normalises mixed-case and stray spaces', () => {
    const r = parseBillRefNumber('  kyt contr KY1234567 ');
    expect(r.kind).toBe('contribution');
    expect(r.groupCode).toBe('KY1234567');
    expect(r.normalised).toBe('KYT-CONTR-KY1234567');
  });

  it('tolerates underscores and slashes as separators', () => {
    const r = parseBillRefNumber('KYT_CONTR/KY1234567');
    expect(r.kind).toBe('contribution');
    expect(r.groupCode).toBe('KY1234567');
  });
});

describe('parseBillRefNumber — other prefixes', () => {
  it('parses KYT-LOAN-<short-id>', () => {
    const r = parseBillRefNumber('KYT-LOAN-ABCD12345');
    expect(r.kind).toBe('loan_repayment');
    expect(r.entityId).toBe('ABCD12345');
  });

  it('parses KYT-LOAN-<uuid> preserving the UUID across dashes', () => {
    const r = parseBillRefNumber('KYT-LOAN-7f3a8b2c-9d4e-4f1a-b2c5-1234567890ab');
    expect(r.kind).toBe('loan_repayment');
    expect(r.entityId).toBe('7F3A8B2C-9D4E-4F1A-B2C5-1234567890AB');
  });

  it('parses KYT-WELF-<group>', () => {
    const r = parseBillRefNumber('KYT-WELF-KY7777777');
    expect(r.kind).toBe('welfare');
    expect(r.groupCode).toBe('KY7777777');
  });

  it('parses KYT-INV-<investment-id>', () => {
    const r = parseBillRefNumber('KYT-INV-7F3A');
    expect(r.kind).toBe('investment');
    expect(r.entityId).toBe('7F3A');
  });

  it('parses KYT-SUB-<group>', () => {
    const r = parseBillRefNumber('KYT-SUB-KY1234567');
    expect(r.kind).toBe('subscription');
    expect(r.groupCode).toBe('KY1234567');
  });

  it('parses KYT-SHARE-<group>-<member>', () => {
    const r = parseBillRefNumber('KYT-SHARE-KY1234567-MEM1');
    expect(r.kind).toBe('share');
    expect(r.groupCode).toBe('KY1234567');
    expect(r.memberCode).toBe('MEM1');
  });

  it('parses INV-YYYY-NNNNNN invoice number', () => {
    const r = parseBillRefNumber('INV-2026-000045');
    expect(r.kind).toBe('invoice');
    expect(r.invoiceNumber).toBe('INV-2026-000045');
  });

  it('still recognises the prefix when KYT- is omitted', () => {
    const r = parseBillRefNumber('CONTR-KY1234567');
    expect(r.kind).toBe('contribution');
    expect(r.groupCode).toBe('KY1234567');
  });

  it('returns kind=unknown for garbage', () => {
    expect(parseBillRefNumber('hello world').kind).toBe('unknown');
    expect(parseBillRefNumber('').kind).toBe('unknown');
    expect(parseBillRefNumber(null).kind).toBe('unknown');
    expect(parseBillRefNumber(undefined).kind).toBe('unknown');
  });

  it('returns the raw input verbatim for audit', () => {
    const r = parseBillRefNumber('  KYT/CONTR/KY1234567  ');
    expect(r.raw).toBe('  KYT/CONTR/KY1234567  ');
  });
});

describe('isSandboxTestRef', () => {
  it('matches known sandbox junk values', () => {
    expect(isSandboxTestRef('TEST')).toBe(true);
    expect(isSandboxTestRef('test')).toBe(true);
    expect(isSandboxTestRef('Account')).toBe(true);
    expect(isSandboxTestRef('')).toBe(true);
    expect(isSandboxTestRef('TEST-001')).toBe(true);
    expect(isSandboxTestRef('test_42')).toBe(true);
  });

  it('does not match real refs', () => {
    expect(isSandboxTestRef('KYT-CONTR-KY1234567')).toBe(false);
    expect(isSandboxTestRef('INV-2026-000045')).toBe(false);
  });
});
