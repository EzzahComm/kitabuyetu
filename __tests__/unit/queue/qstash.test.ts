const mockPublishJSON = jest.fn();
const mockTrigger      = jest.fn();
const mockNotify       = jest.fn();

jest.mock('@upstash/qstash', () => ({
  Client: jest.fn().mockImplementation(() => ({
    publishJSON: mockPublishJSON,
  })),
}));

jest.mock('@upstash/workflow', () => ({
  Client: jest.fn().mockImplementation(() => ({
    trigger: mockTrigger,
    notify:  mockNotify,
  })),
}));

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const CONFIGURED_ENV = {
  QSTASH_URL: 'https://qstash.example.com', QSTASH_TOKEN: 'tok',
  QSTASH_CURRENT_SIGNING_KEY: 'cur', QSTASH_NEXT_SIGNING_KEY: 'next',
  NEXT_PUBLIC_APP_URL: 'https://kitabuyetu.co.ke',
};

describe('lib/queue/qstash', () => {
  beforeEach(() => {
    jest.resetModules();
    mockPublishJSON.mockReset();
    mockTrigger.mockReset();
    mockNotify.mockReset();
  });

  describe('isQstashConfigured', () => {
    it('is false when any of the four QSTASH_* vars is missing', async () => {
      jest.doMock('@/lib/env', () => ({
        env: { QSTASH_URL: 'https://qstash.example.com', QSTASH_TOKEN: 'tok', QSTASH_CURRENT_SIGNING_KEY: undefined, QSTASH_NEXT_SIGNING_KEY: 'next' },
      }));
      const { isQstashConfigured } = await import('@/lib/queue/qstash');
      expect(isQstashConfigured()).toBe(false);
    });

    it('is true when all four are set', async () => {
      jest.doMock('@/lib/env', () => ({
        env: { QSTASH_URL: 'https://qstash.example.com', QSTASH_TOKEN: 'tok', QSTASH_CURRENT_SIGNING_KEY: 'cur', QSTASH_NEXT_SIGNING_KEY: 'next' },
      }));
      const { isQstashConfigured } = await import('@/lib/queue/qstash');
      expect(isQstashConfigured()).toBe(true);
    });
  });

  describe('publishSmsChunk', () => {
    it('publishes to the sms-dispatch-chunk route with the app base URL and retries: 3', async () => {
      jest.doMock('@/lib/env', () => ({
        env: {
          QSTASH_URL: 'https://qstash.example.com', QSTASH_TOKEN: 'tok',
          QSTASH_CURRENT_SIGNING_KEY: 'cur', QSTASH_NEXT_SIGNING_KEY: 'next',
          NEXT_PUBLIC_APP_URL: 'https://kitabuyetu.co.ke',
        },
      }));
      mockPublishJSON.mockResolvedValue({ messageId: 'msg_123' });

      const { publishSmsChunk } = await import('@/lib/queue/qstash');
      const payload = {
        jobId: 'job-1', chunkIndex: 0, chunkCount: 2,
        groupId: 'group-1', phones: ['254700000001'], message: 'hi',
        sentBy: 'tester', totalRecipientCount: 60,
      };

      const messageId = await publishSmsChunk(payload);

      expect(messageId).toBe('msg_123');
      expect(mockPublishJSON).toHaveBeenCalledWith({
        url:     'https://kitabuyetu.co.ke/api/v1/workers/sms-dispatch-chunk',
        body:    payload,
        retries: 3,
      });
    });

    it('falls back to the production domain when NEXT_PUBLIC_APP_URL is unset', async () => {
      jest.doMock('@/lib/env', () => ({
        env: {
          QSTASH_URL: 'https://qstash.example.com', QSTASH_TOKEN: 'tok',
          QSTASH_CURRENT_SIGNING_KEY: 'cur', QSTASH_NEXT_SIGNING_KEY: 'next',
          NEXT_PUBLIC_APP_URL: undefined,
        },
      }));
      mockPublishJSON.mockResolvedValue({ messageId: 'msg_456' });

      const { publishSmsChunk } = await import('@/lib/queue/qstash');
      await publishSmsChunk({
        jobId: 'job-2', chunkIndex: 0, chunkCount: 1,
        groupId: 'group-1', phones: ['254700000001'], message: 'hi',
        sentBy: 'tester', totalRecipientCount: 1,
      });

      expect(mockPublishJSON).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://kitabuyetu.co.ke/api/v1/workers/sms-dispatch-chunk' }),
      );
    });
  });

  describe('watchdogKey', () => {
    it('derives the same key from the same (kind, rowId) regardless of caller', async () => {
      jest.doMock('@/lib/env', () => ({ env: CONFIGURED_ENV }));
      const { watchdogKey } = await import('@/lib/queue/qstash');
      expect(watchdogKey('disbursement', 'row-1')).toBe('disbursement:row-1');
      expect(watchdogKey('settlement', 'row-2')).toBe('settlement:row-2');
      expect(watchdogKey('vendor_payment', 'row-3')).toBe('vendor_payment:row-3');
    });
  });

  describe('triggerDisbursementWatchdog', () => {
    it('no-ops when QStash is not configured (never calls trigger)', async () => {
      jest.doMock('@/lib/env', () => ({
        env: { QSTASH_URL: undefined, QSTASH_TOKEN: undefined, QSTASH_CURRENT_SIGNING_KEY: undefined, QSTASH_NEXT_SIGNING_KEY: undefined },
      }));
      const { triggerDisbursementWatchdog } = await import('@/lib/queue/qstash');

      await expect(triggerDisbursementWatchdog({ kind: 'disbursement', rowId: 'row-1' })).resolves.toBeUndefined();
      expect(mockTrigger).not.toHaveBeenCalled();
    });

    it('triggers the watchdog route with a deterministic workflowRunId', async () => {
      jest.doMock('@/lib/env', () => ({ env: CONFIGURED_ENV }));
      mockTrigger.mockResolvedValue({ workflowRunId: 'wfr_ignored' });
      const { triggerDisbursementWatchdog } = await import('@/lib/queue/qstash');

      await triggerDisbursementWatchdog({ kind: 'settlement', rowId: 'row-42' });

      expect(mockTrigger).toHaveBeenCalledWith({
        url:           'https://kitabuyetu.co.ke/api/v1/workers/disbursement-watchdog',
        body:          { kind: 'settlement', rowId: 'row-42' },
        workflowRunId: 'settlement:row-42',
      });
    });

    it('never throws when the underlying trigger call rejects', async () => {
      jest.doMock('@/lib/env', () => ({ env: CONFIGURED_ENV }));
      mockTrigger.mockRejectedValue(new Error('qstash unavailable'));
      const { triggerDisbursementWatchdog } = await import('@/lib/queue/qstash');

      await expect(
        triggerDisbursementWatchdog({ kind: 'vendor_payment', rowId: 'row-99' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('notifyDisbursementCallback', () => {
    it('no-ops when QStash is not configured (never calls notify)', async () => {
      jest.doMock('@/lib/env', () => ({
        env: { QSTASH_URL: undefined, QSTASH_TOKEN: undefined, QSTASH_CURRENT_SIGNING_KEY: undefined, QSTASH_NEXT_SIGNING_KEY: undefined },
      }));
      const { notifyDisbursementCallback } = await import('@/lib/queue/qstash');

      await expect(
        notifyDisbursementCallback('disbursement', 'row-1', { status: 'completed' }),
      ).resolves.toBeUndefined();
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it('notifies with the same key as eventId AND workflowRunId (lookback)', async () => {
      jest.doMock('@/lib/env', () => ({ env: CONFIGURED_ENV }));
      mockNotify.mockResolvedValue([]);
      const { notifyDisbursementCallback } = await import('@/lib/queue/qstash');

      await notifyDisbursementCallback('disbursement', 'row-7', { status: 'completed', mpesaReceiptNumber: 'ABC123' });

      expect(mockNotify).toHaveBeenCalledWith({
        eventId:       'disbursement:row-7',
        workflowRunId: 'disbursement:row-7',
        eventData:     { status: 'completed', mpesaReceiptNumber: 'ABC123' },
      });
    });

    it('never throws when the underlying notify call rejects', async () => {
      jest.doMock('@/lib/env', () => ({ env: CONFIGURED_ENV }));
      mockNotify.mockRejectedValue(new Error('qstash unavailable'));
      const { notifyDisbursementCallback } = await import('@/lib/queue/qstash');

      await expect(
        notifyDisbursementCallback('vendor_payment', 'row-8', { status: 'failed', failureReason: 'oops' }),
      ).resolves.toBeUndefined();
    });
  });
});
