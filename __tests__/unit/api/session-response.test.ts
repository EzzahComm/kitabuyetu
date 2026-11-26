import { api, configureApiClient } from '@/lib/api/client';

describe('API responses across session changes', () => {
  let accessToken: string;
  const onUnauthorized = jest.fn();
  const onPaymentRequired = jest.fn();

  beforeEach(() => {
    accessToken = 'first-session';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: () => JSON.stringify({ accessToken }) } },
    });
    configureApiClient({ onUnauthorized, onPaymentRequired });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    Reflect.deleteProperty(globalThis, 'window');
    configureApiClient({ onUnauthorized: () => {} });
  });

  it.each([401, 402])('ignores a late %i redirect from the previous session', async (status) => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      // The request has already captured the old bearer when the session switches.
      accessToken = 'second-session';
      return Response.json({ success: false, error: 'Old session response', code: 'OLD_SESSION' }, { status });
    });

    await expect(api.get('/example')).rejects.toMatchObject({ status });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer first-session' });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onPaymentRequired).not.toHaveBeenCalled();
  });

  it.each([401, 402])('still dispatches a current-session %i redirect', async (status) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ success: false, error: 'Current session response', code: 'CURRENT' }, { status }),
      );

    await expect(api.get('/example')).rejects.toMatchObject({ status });
    expect(status === 401 ? onUnauthorized : onPaymentRequired).toHaveBeenCalledTimes(1);
  });
});
