/**
 * Regression tests for SMS_SYSTEM_AUDIT_2026-08-20.md C1.
 *
 * `getDeliveryReport` read the provider's numeric `delivery-status` field and
 * handed it to `classifyDlrStatus`, which matches on WORDS. Live payloads
 * captured from the production TextSMS account on 2026-08-20 (reproduced
 * verbatim as fixtures below) show `delivery-status` is **32 for both a
 * delivered and an undelivered message** — it carries no outcome information
 * at all. The real verdict is `delivery-description`.
 *
 * Consequence: "32" matched neither the failure regex nor the delivered regex,
 * so every delivery report in the platform's history classified as 'pending'.
 * 323 messages sent, zero ever marked delivered, while 22 stored reports
 * carried a real `delivered_at` from the provider alongside `status='pending'`.
 *
 * The first test below is the evidence the bug was real rather than a
 * misreading: it fails against the old code, because the old code returned the
 * string "32" as `status` for a message the provider had plainly delivered.
 */
import axios from 'axios';
import { getDeliveryReport } from '@/lib/services/textsms.service';
import { classifyDlrStatus } from '@/lib/services/sms.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Real production payloads, 2026-08-20. Note `delivery-status: 32` in BOTH —
 * that identity is the entire point of this file, so these are kept verbatim
 * rather than reduced to the fields under test.
 */
const DELIVERED_PAYLOAD = {
  'response-code':        200,
  'message-id':           '810668705',
  'response-description': 'Success',
  'delivery-status':      32,
  'delivery-description': 'DeliveredToTerminal',
  'delivery-tat':         '0.24 sec',
  'delivery-networkid':   1,
  'delivery-time':        '2026-08-14 12:57:42',
};

const STALLED_PAYLOAD = {
  'response-code':        200,
  'message-id':           '821169663',
  'response-description': 'Success',
  'delivery-status':      32,
  'delivery-description': 'Scheduled',
  'delivery-tat':         null,
  'delivery-networkid':   1,
  'delivery-time':        null,
};

describe('TextSMS DLR parsing (C1)', () => {
  afterEach(() => jest.resetAllMocks());

  it('reads the verdict from delivery-description, not delivery-status', async () => {
    mockedAxios.get.mockResolvedValue({ data: DELIVERED_PAYLOAD });

    const res = await getDeliveryReport('810668705');

    // The bug in one assertion: the old code put "32" here.
    expect(res.status).toBe('DeliveredToTerminal');
    expect(classifyDlrStatus(res.status)).toBe('delivered');
    expect(res.deliveredAt).toBe('2026-08-14 12:57:42');
  });

  it('classifies a stalled message as pending, not delivered', async () => {
    mockedAxios.get.mockResolvedValue({ data: STALLED_PAYLOAD });

    const res = await getDeliveryReport('821169663');

    expect(res.status).toBe('Scheduled');
    expect(classifyDlrStatus(res.status)).toBe('pending');
    expect(res.deliveredAt).toBeUndefined();
  });

  it('gives the two payloads DIFFERENT classifications despite identical delivery-status', async () => {
    // Guards the exact property whose absence caused C1: any future refactor
    // that classifies on the numeric field again makes these two collapse to
    // the same answer, and this test says so.
    mockedAxios.get.mockResolvedValueOnce({ data: DELIVERED_PAYLOAD });
    const delivered = await getDeliveryReport('810668705');
    mockedAxios.get.mockResolvedValueOnce({ data: STALLED_PAYLOAD });
    const stalled = await getDeliveryReport('821169663');

    expect(delivered.statusCode).toBe(stalled.statusCode);  // both 32
    expect(classifyDlrStatus(delivered.status)).not.toBe(classifyDlrStatus(stalled.status));
  });

  it('keeps the numeric code as diagnostics only', async () => {
    mockedAxios.get.mockResolvedValue({ data: DELIVERED_PAYLOAD });
    const res = await getDeliveryReport('810668705');
    expect(res.statusCode).toBe(32);
  });

  it('reports an absent delivery-status as NaN rather than inventing a code', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { 'message-id': 'x', 'delivery-description': 'DeliveredToTerminal', mobile: '254717548646' },
    });
    const res = await getDeliveryReport('x');
    expect(Number.isNaN(res.statusCode)).toBe(true);
    expect(classifyDlrStatus(res.status)).toBe('delivered');
  });

  it('falls back to `status` when the provider omits delivery-description', async () => {
    mockedAxios.get.mockResolvedValue({ data: { status: 'DELIVRD', mobile: '254717548646' } });
    const res = await getDeliveryReport('y');
    expect(classifyDlrStatus(res.status)).toBe('delivered');
  });

  it('reads the network id from delivery-networkid when networkid is absent', async () => {
    mockedAxios.get.mockResolvedValue({ data: DELIVERED_PAYLOAD });
    const res = await getDeliveryReport('810668705');
    expect(res.networkId).toBe('1');
  });
});

describe('classifyDlrStatus ordering and vocabulary', () => {
  it('classifies UNDELIVERABLE as failed, not delivered', () => {
    // The failure regex MUST be tested before the delivered one, or the
    // 'deliv' substring inside 'UNDELIVERABLE' wins. Load-bearing ordering.
    expect(classifyDlrStatus('UNDELIVERABLE')).toBe('failed');
    expect(classifyDlrStatus('UndeliveredToTerminal')).toBe('failed');
  });

  it('classifies the provider vocabulary we have actually observed', () => {
    expect(classifyDlrStatus('DeliveredToTerminal')).toBe('delivered');
    expect(classifyDlrStatus('Scheduled')).toBe('pending');
    expect(classifyDlrStatus('Rejected')).toBe('failed');
    expect(classifyDlrStatus('Expired')).toBe('failed');
  });

  it('never classifies a bare number as terminal', () => {
    // If this ever returns anything but 'pending', C1 has been reintroduced.
    for (const n of ['32', '1', '0', '200']) {
      expect(classifyDlrStatus(n)).toBe('pending');
    }
  });

  it('treats empty/undefined input as pending', () => {
    expect(classifyDlrStatus('')).toBe('pending');
    expect(classifyDlrStatus(undefined as unknown as string)).toBe('pending');
  });
});
