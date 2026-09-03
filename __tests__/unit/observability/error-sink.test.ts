/**
 * The error sink (SMS-REAUDIT-2026-09-02 F2 / T3-4 item 1).
 *
 * 107 `logger.error` call sites reached nobody. This wires them to Sentry when
 * SENTRY_DSN is configured, and to nothing at all when it is not.
 *
 * The SDK's own transmission cannot be tested here — that needs a real DSN and
 * a real project. What CAN be pinned, and is, is everything around it: that an
 * unconfigured deployment never loads or calls the SDK, that a broken sink can
 * never break the logger, and — the one that actually matters — that secrets
 * the logger redacts are never handed onward to a third party.
 */
import { reportError, resetErrorSink } from '@/lib/observability/error-sink';
import { logger } from '@/lib/logger';

const mockInit = jest.fn();
const mockCapture = jest.fn();

jest.mock('@sentry/node', () => ({
  init:             (...a: unknown[]) => mockInit(...a),
  captureException: (...a: unknown[]) => mockCapture(...a),
}));

/** The sink is fire-and-forget, so let its microtask chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('error sink', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    resetErrorSink();
    mockInit.mockClear();
    mockCapture.mockClear();
    delete process.env.SENTRY_DSN;
    process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  });

  afterAll(() => { process.env = ORIGINAL_ENV; });

  describe('with no DSN configured (today’s production state)', () => {
    it('never loads or calls the SDK', async () => {
      reportError('something broke', { detail: 1 });
      await settle();

      expect(mockInit).not.toHaveBeenCalled();
      expect(mockCapture).not.toHaveBeenCalled();
    });

    it('does not throw, so logger.error stays safe to call anywhere', () => {
      expect(() => logger.error('boom', new Error('x'))).not.toThrow();
    });
  });

  describe('with a DSN configured', () => {
    beforeEach(() => { process.env.SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/1'; });

    it('initialises once, no matter how many errors arrive', async () => {
      reportError('first', {});
      reportError('second', {});
      reportError('third', {});
      await settle();

      expect(mockInit).toHaveBeenCalledTimes(1);
      expect(mockCapture).toHaveBeenCalledTimes(3);
    });

    it('does not enable tracing — this exists for errors, not request volume', async () => {
      reportError('x', {});
      await settle();

      expect(mockInit.mock.calls[0][0]).toMatchObject({ tracesSampleRate: 0, sendDefaultPii: false });
    });

    it('forwards the message and its context', async () => {
      reportError('provider exploded', { provider: 'textsms', attempt: 2 });
      await settle();

      const [err, opts] = mockCapture.mock.calls[0];
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('provider exploded');
      expect(opts).toMatchObject({ extra: { provider: 'textsms', attempt: 2 } });
    });

    it('survives an SDK that throws, rather than turning a logged problem into a crash', async () => {
      mockCapture.mockImplementationOnce(() => { throw new Error('sentry is down'); });

      expect(() => reportError('x', {})).not.toThrow();
      await settle();
    });
  });

  describe('secret redaction — the property that makes this safe to send outward at all', () => {
    beforeEach(() => { process.env.SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/1'; });

    it('NEVER forwards a secret that the logger redacts', async () => {
      // Exactly the shape T0-3 found leaking in production: an axios error
      // whose `config` carries the provider credential.
      const providerError = Object.assign(new Error('Request failed'), {
        config: {
          url: 'https://sms.textsms.co.ke/api/services/sendsms/',
          data: { apikey: 'REAL-TEXTSMS-KEY', partnerID: '14643', message: 'hi' },
        },
      });

      logger.error('[sms] dispatch failed', providerError);
      await settle();

      const serialized = JSON.stringify(mockCapture.mock.calls);
      expect(serialized).not.toContain('REAL-TEXTSMS-KEY');
      expect(serialized).not.toContain('14643');
      // And it did report something — a test that passes because nothing was
      // sent would prove nothing at all.
      expect(mockCapture).toHaveBeenCalled();
    });
  });

  describe('logger integration', () => {
    beforeEach(() => { process.env.SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/1'; });

    it('reports logger.error', async () => {
      logger.error('a real failure', { groupId: 'g-1' });
      await settle();
      expect(mockCapture).toHaveBeenCalled();
    });

    it('does NOT report logger.warn or logger.info — the sink is for errors', async () => {
      logger.warn('just a warning');
      logger.info('just information');
      await settle();
      expect(mockCapture).not.toHaveBeenCalled();
    });
  });
});
