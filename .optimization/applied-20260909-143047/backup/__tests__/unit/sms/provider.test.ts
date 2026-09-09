/**
 * lib/sms/provider.ts (SMS-AUDIT-v3 T3-3) — the funnel every dispatch call
 * goes through: adapter resolution, the circuit breaker wrapping every call,
 * and per-call provider override (retryFailures honouring a historical
 * provider). textsms.service.ts is mocked, not the adapter — this exercises
 * the real TextSmsAdapter wiring, only stubbing the actual HTTP-shaped calls.
 */
import * as provider from '@/lib/sms/provider';
import { resetCircuit } from '@/lib/sms/circuit-breaker';
import { ServiceUnavailableError } from '@/lib/utils/errors';

const mockSendSingleSms      = jest.fn();
const mockSendBulkSmsChunked = jest.fn();
const mockGetDeliveryReport  = jest.fn();
const mockGetProviderBalance = jest.fn();

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms:      (...args: unknown[]) => mockSendSingleSms(...args),
  sendBulkSmsChunked: (...args: unknown[]) => mockSendBulkSmsChunked(...args),
  getDeliveryReport:  (...args: unknown[]) => mockGetDeliveryReport(...args),
  getProviderBalance: (...args: unknown[]) => mockGetProviderBalance(...args),
}));

describe('sms provider abstraction', () => {
  beforeEach(() => {
    resetCircuit();
    jest.clearAllMocks();
    delete process.env.SMS_PROVIDER;
  });

  describe('activeSmsProvider', () => {
    it('defaults to textsms', () => {
      expect(provider.activeSmsProvider()).toBe('textsms');
      expect(provider.activeSmsProvider()).toBe(provider.DEFAULT_SMS_PROVIDER);
    });
  });

  describe('routing to the adapter', () => {
    it('sendSingleSms calls through to textsms.service and returns its result', async () => {
      mockSendSingleSms.mockResolvedValueOnce({ success: true, messageId: 'm1' });
      const res = await provider.sendSingleSms({ mobile: '254700000001', message: 'hi' });
      expect(res).toEqual({ success: true, messageId: 'm1' });
      expect(mockSendSingleSms).toHaveBeenCalledWith({ mobile: '254700000001', message: 'hi' });
    });

    it('sendBulkSmsChunked calls through and returns its result', async () => {
      mockSendBulkSmsChunked.mockResolvedValueOnce({ responses: [], sent: 0, failed: 0 });
      const res = await provider.sendBulkSmsChunked([]);
      expect(res).toEqual({ responses: [], sent: 0, failed: 0 });
    });

    it('getDeliveryReport and getProviderBalance call through', async () => {
      mockGetDeliveryReport.mockResolvedValueOnce({ messageId: 'm1', status: 'DeliveredToTerminal' });
      mockGetProviderBalance.mockResolvedValueOnce({ balance: 100, currency: 'KES' });

      await expect(provider.getDeliveryReport('m1')).resolves.toEqual(
        { messageId: 'm1', status: 'DeliveredToTerminal' },
      );
      await expect(provider.getProviderBalance()).resolves.toEqual({ balance: 100, currency: 'KES' });
    });
  });

  describe('unknown provider', () => {
    it('throws ServiceUnavailableError without calling any adapter', async () => {
      await expect(
        provider.sendSingleSms({ mobile: '254700000001', message: 'hi' }, 'some-retired-provider'),
      ).rejects.toThrow(ServiceUnavailableError);
      expect(mockSendSingleSms).not.toHaveBeenCalled();
    });
  });

  describe('circuit breaker integration', () => {
    it('a transport-level throw records a failure and rethrows the original error', async () => {
      mockSendSingleSms.mockRejectedValueOnce(new Error('ETIMEDOUT'));
      await expect(
        provider.sendSingleSms({ mobile: '254700000001', message: 'hi' }),
      ).rejects.toThrow('ETIMEDOUT');
    });

    it('a resolved per-item REJECTION (no throw) does not trip the breaker', async () => {
      for (let i = 0; i < 10; i++) {
        mockSendSingleSms.mockResolvedValueOnce({ success: false, responseDescription: 'Invalid Mobile Number' });
        await provider.sendSingleSms({ mobile: 'bad', message: 'hi' });
      }
      // Still available after far more than FAILURE_THRESHOLD non-throwing
      // "failures" — a bad number is not a provider-health signal.
      expect(provider.isProviderAvailable()).toBe(true);
    });

    it('5 consecutive transport throws open the circuit and the 6th call never reaches the adapter', async () => {
      mockSendSingleSms.mockRejectedValue(new Error('ETIMEDOUT'));
      for (let i = 0; i < 5; i++) {
        await expect(provider.sendSingleSms({ mobile: '254700000001', message: 'hi' })).rejects.toThrow();
      }
      expect(provider.isProviderAvailable()).toBe(false);

      mockSendSingleSms.mockClear();
      await expect(
        provider.sendSingleSms({ mobile: '254700000001', message: 'hi' }),
      ).rejects.toThrow(ServiceUnavailableError);
      expect(mockSendSingleSms).not.toHaveBeenCalled();
    });

    it('a success in between throws resets the consecutive count, so the breaker does not open', async () => {
      mockSendSingleSms
        .mockRejectedValueOnce(new Error('e1'))
        .mockRejectedValueOnce(new Error('e2'))
        .mockRejectedValueOnce(new Error('e3'))
        .mockRejectedValueOnce(new Error('e4'))
        .mockResolvedValueOnce({ success: true, messageId: 'm1' })
        .mockRejectedValueOnce(new Error('e5'));

      for (let i = 0; i < 4; i++) {
        await expect(provider.sendSingleSms({ mobile: '254700000001', message: 'hi' })).rejects.toThrow();
      }
      await provider.sendSingleSms({ mobile: '254700000001', message: 'hi' }); // success
      await expect(provider.sendSingleSms({ mobile: '254700000001', message: 'hi' })).rejects.toThrow('e5');

      expect(provider.isProviderAvailable()).toBe(true);
    });

    it('isProviderAvailable reflects an explicit provider name, independent of the active default', async () => {
      expect(provider.isProviderAvailable('textsms')).toBe(true);
      // Tripping the default-named circuit must not affect a differently-named one.
      mockSendSingleSms.mockRejectedValue(new Error('down'));
      for (let i = 0; i < 5; i++) {
        await expect(provider.sendSingleSms({ mobile: '254700000001', message: 'hi' })).rejects.toThrow();
      }
      expect(provider.isProviderAvailable('textsms')).toBe(false);
      expect(provider.isProviderAvailable('some-other-provider')).toBe(true);
    });
  });
});
