/**
 * lib/logger.ts — credential and PII containment.
 *
 * Guards the fix for the TextSMS API key leaking into logs. An AxiosError is
 * an Error, and its toJSON() includes `config`, which carries `apikey` in
 * `params` for the GET calls (delivery report, balance) and in `data` for the
 * POST calls (sends). Nesting such an error inside a context object —
 * `logger.error('...', { logId, err })`, which five SMS call sites do — used
 * to serialize the whole thing, publishing the live credential in cleartext.
 *
 * The logger reads NODE_ENV at call time, so both branches are exercised by
 * setting it directly — no module-registry reloading, which cost ~50s of
 * suite time and leaked a worker when this was first written.
 */
import { logger } from '@/lib/logger';

const ORIGINAL_ENV = process.env.NODE_ENV;

function loadLogger(nodeEnv: string): typeof logger {
  // NODE_ENV is readonly in the Next.js type defs; the cast is the point.
  (process.env as Record<string, string>).NODE_ENV = nodeEnv;
  return logger;
}

/** Mirrors the real shape: an Error carrying an axios `config`. */
function axiosLikeError(): Error & { config: unknown; isAxiosError: boolean } {
  const err = new Error('Request failed with status code 401') as Error & {
    config: unknown;
    isAxiosError: boolean;
  };
  err.isAxiosError = true;
  err.config = {
    url: 'https://sms.textsms.co.ke/api/services/getdlr/',
    method: 'get',
    params: { apikey: 'SUPER_SECRET_KEY', partnerID: '14643', messageID: 'abc' },
    headers: { Authorization: 'Bearer SUPER_SECRET_TOKEN' },
  };
  return err;
}

describe.each(['production', 'development'])('logger in %s', (nodeEnv) => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    spy.mockRestore();
    (process.env as Record<string, string>).NODE_ENV = ORIGINAL_ENV as string;
  });

  const output = (): string => spy.mock.calls.map((c) => JSON.stringify(c)).join('\n');

  it('does not leak a credential from an error NESTED in a context object', () => {
    // The exact call shape used at lib/services/sms.service.ts's DLR poll.
    loadLogger(nodeEnv).error('[sms] DLR poll error', { logId: 'log-1', err: axiosLikeError() });

    expect(output()).not.toContain('SUPER_SECRET_KEY');
    expect(output()).not.toContain('SUPER_SECRET_TOKEN');
  });

  it('does not leak a credential from a top-level error argument', () => {
    loadLogger(nodeEnv).error('[sms] dispatch failed', axiosLikeError());

    expect(output()).not.toContain('SUPER_SECRET_KEY');
    expect(output()).not.toContain('SUPER_SECRET_TOKEN');
  });

  it('redacts secret-looking keys wherever they appear', () => {
    loadLogger(nodeEnv).error('config dump', {
      nested: { deeper: { apiKey: 'SUPER_SECRET_KEY', partnerId: '14643' } },
      password: 'SUPER_SECRET_KEY',
    });

    expect(output()).not.toContain('SUPER_SECRET_KEY');
    expect(output()).toContain('REDACTED');
  });

  it('still preserves the diagnostic value of an error', () => {
    loadLogger(nodeEnv).error('[sms] DLR poll error', { logId: 'log-1', err: axiosLikeError() });

    // The message and the caller's own context must survive — redaction that
    // destroys debuggability would just get reverted.
    expect(output()).toContain('Request failed with status code 401');
    expect(output()).toContain('log-1');
  });

  it('survives a circular reference instead of throwing', () => {
    const circular: Record<string, unknown> = { name: 'outer' };
    circular.self = circular;

    expect(() => loadLogger(nodeEnv).error('circular', circular)).not.toThrow();
    expect(output()).toContain('Circular');
  });

  it('does not log a message body or a full phone number that was never passed', () => {
    // Regression guard for the PII axis: the logger must not invent or expand
    // context beyond what the caller supplied.
    loadLogger(nodeEnv).error('[sms] send failed', { count: 3 });

    expect(output()).not.toContain('254');
  });
});
