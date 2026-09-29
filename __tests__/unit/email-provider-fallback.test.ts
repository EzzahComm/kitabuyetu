jest.mock('@/lib/db', () => ({ withAdminDb: jest.fn().mockResolvedValue({ rows: [] }) }));
jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('@/lib/env', () => ({ env: { EMAIL_FROM: 'info@kitabuyetu.co.ke' } }));

const resendSend = jest.fn();
const smtpSend = jest.fn();
jest.mock('@/lib/email/adapters/resend', () => ({
  ResendAdapter: jest.fn().mockImplementation(() => ({ name: 'resend', send: resendSend })),
}));
jest.mock('@/lib/email/adapters/smtp', () => ({
  SmtpAdapter: jest.fn().mockImplementation(() => ({ name: 'smtp', send: smtpSend })),
}));

const payload = { to: 'info@kitabuyetu.co.ke', subject: 's', html: '<p>x</p>' };

/** provider.ts memoises its adapter, so load a fresh copy per case. */
function load() {
  let mod: typeof import('@/lib/email/provider');
  jest.isolateModules(() => {
    mod = require('@/lib/email/provider');
  });
  return mod!;
}

describe('email provider: Resend primary, cPanel SMTP fallback', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EMAIL_DRY_RUN;
  });
  afterEach(() => {
    process.env = { ...OLD };
  });

  it('EMAIL_PROVIDER=resend with SMTP_* set: uses Resend, falls back to SMTP only when Resend fails', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.SMTP_HOST = 'das121.truehost.cloud';
    resendSend.mockResolvedValueOnce({ success: false, provider: 'resend', error: 'domain not verified' });
    smtpSend.mockResolvedValueOnce({ success: true, provider: 'smtp', messageId: 'm' });
    const res = await load().sendEmailWithFallback(payload);
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(smtpSend).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ success: true, provider: 'smtp' });
  });

  it('does not touch SMTP when Resend succeeds', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.SMTP_HOST = 'das121.truehost.cloud';
    resendSend.mockResolvedValueOnce({ success: true, provider: 'resend' });
    await load().sendEmailWithFallback(payload);
    expect(smtpSend).not.toHaveBeenCalled();
  });

  it('EMAIL_PROVIDER=smtp has NO Resend fallback: an SMTP failure is returned as-is', async () => {
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = 'das121.truehost.cloud';
    smtpSend.mockResolvedValueOnce({ success: false, provider: 'smtp', error: 'auth failed' });
    const res = await load().sendEmailWithFallback(payload);
    expect(resendSend).not.toHaveBeenCalled();
    expect(res).toMatchObject({ success: false, provider: 'smtp' });
  });

  it('Resend failure with no SMTP_HOST configured is returned as-is', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    delete process.env.SMTP_HOST;
    resendSend.mockResolvedValueOnce({ success: false, provider: 'resend', error: 'boom' });
    const res = await load().sendEmailWithFallback(payload);
    expect(smtpSend).not.toHaveBeenCalled();
    expect(res.success).toBe(false);
  });
});
