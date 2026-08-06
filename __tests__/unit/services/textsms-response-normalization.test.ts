/**
 * Regression tests for SMS_MESSAGING_AUDIT_2026-08.md C2.
 *
 * TextSMS returns numeric fields as JSON strings. `success: code === 200` was a
 * strict comparison against a number, so it was false for every accepted
 * message — production accumulated 112 rows marked `failed` whose failed_reason
 * was literally "Success" and which carried a real provider message id.
 *
 * The negative cases below (string "200" must be a success) are the evidence
 * the bug was real rather than a misreading: they fail against the old code.
 */
import axios from 'axios';
import { sendSingleSms, sendBulkSms } from '@/lib/services/textsms.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** A response row shaped exactly as TextSMS sends it — everything stringified. */
function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    'respose-code':         '200',
    'response-description': 'Success',
    mobile:                 '254717548646',
    messageid:              '655405696',
    networkid:              '1',
    ...overrides,
  };
}

describe('TextSMS response normalization (C2)', () => {
  afterEach(() => jest.resetAllMocks());

  describe('sendSingleSms', () => {
    it('treats a stringified "200" as success', async () => {
      mockedAxios.post.mockResolvedValue({ data: { responses: [providerRow()] } });

      const res = await sendSingleSms({ mobile: '0717548646', message: 'hi' });

      expect(res.success).toBe(true);
      expect(res.responseCode).toBe(200);
      expect(res.messageId).toBe('655405696');
    });

    it('still treats a numeric 200 as success', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { responses: [providerRow({ 'respose-code': 200 })] },
      });

      const res = await sendSingleSms({ mobile: '0717548646', message: 'hi' });
      expect(res.success).toBe(true);
    });

    it('treats a genuine error code as failure regardless of string typing', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          responses: [providerRow({
            'respose-code': '1006',
            'response-description': 'Invalid Credentials',
          })],
        },
      });

      const res = await sendSingleSms({ mobile: '0717548646', message: 'hi' });
      expect(res.success).toBe(false);
      expect(res.responseCode).toBe(1006);
    });

    it('fails closed on an uninterpretable code rather than throwing', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { responses: [providerRow({ 'respose-code': 'not-a-number' })] },
      });

      const res = await sendSingleSms({ mobile: '0717548646', message: 'hi' });
      expect(res.success).toBe(false);
      expect(res.responseCode).toBe(1005);
    });

    it('fails closed when the provider returns no responses array', async () => {
      mockedAxios.post.mockResolvedValue({ data: {} });

      const res = await sendSingleSms({ mobile: '0717548646', message: 'hi' });
      expect(res.success).toBe(false);
    });

    it('coerces stringified ids so downstream consumers get real strings', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { responses: [providerRow({ messageid: 655405696, networkid: 1 })] },
      });

      const res = await sendSingleSms({ mobile: '0717548646', message: 'hi' });
      expect(res.messageId).toBe('655405696');
      expect(res.networkId).toBe('1');
    });
  });

  describe('sendBulkSms', () => {
    it('counts stringified "200" rows as sent, not failed', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          responses: [
            providerRow(),
            providerRow({ messageid: '655405697' }),
            providerRow({ 'respose-code': '1003', 'response-description': 'Invalid Mobile Number' }),
          ],
        },
      });

      const res = await sendBulkSms([
        { mobile: '0717548646', message: 'a' },
        { mobile: '0717548647', message: 'b' },
        { mobile: '0717548648', message: 'c' },
      ]);

      expect(res.sent).toBe(2);
      expect(res.failed).toBe(1);
      expect(res.responses[0].success).toBe(true);
      expect(res.responses[2].success).toBe(false);
    });
  });
});
