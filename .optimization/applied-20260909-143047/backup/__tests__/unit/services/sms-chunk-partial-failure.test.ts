/**
 * Partial-batch integrity in sendBulkSmsChunked (SMS-AUDIT-v3 G4, T3-2).
 *
 * A throw on chunk k used to discard every response from chunks 0..k-1 —
 * messages the provider had already ACCEPTED and billed us for. The caller
 * then treated the whole batch as never-dispatched: every row failed, every
 * reservation released, sms_failures rows written, and retryFailures sent
 * those recipients the same message again. A real duplicate, an absorbed
 * provider charge, and a first send no DLR could ever confirm.
 *
 * Mocked at the HTTP layer, because sendBulkSmsChunked calls the module's own
 * internal sendBulkSms — mocking the exported binding does not intercept it.
 */
import axios from 'axios';
import { sendBulkSmsChunked, type BulkSmsItem } from '@/lib/services/textsms.service';

jest.mock('axios');
const mockPost = axios.post as jest.MockedFunction<typeof axios.post>;

function items(n: number): BulkSmsItem[] {
  return Array.from({ length: n }, (_, i) => ({
    mobile: `25470000${String(i).padStart(4, '0')}`,
    message: 'hello',
    clientSmsId: i + 1,
  }));
}

/** Shape sendBulkSms parses: one provider row per item in the posted chunk. */
function acceptedResponse(body: unknown) {
  const list = (body as { smslist: { mobile: string; clientsmsid: number }[] }).smslist;
  return {
    data: {
      responses: list.map((it) => ({
        'response-code': 200,
        'response-description': 'Success',
        mobile: it.mobile,
        messageid: `m${it.clientsmsid}`,
        networkid: '1',
        clientsmsid: it.clientsmsid,
      })),
    },
  };
}

describe('sendBulkSmsChunked partial failure', () => {
  beforeEach(() => mockPost.mockReset());

  it('keeps the accepted chunk when a later chunk fails', async () => {
    mockPost
      .mockImplementationOnce((_u, body) => Promise.resolve(acceptedResponse(body)) as never)
      .mockImplementationOnce(() => Promise.reject(new Error('provider 500')) as never);

    const res = await sendBulkSmsChunked(items(150));   // 100 + 50

    expect(res.sent).toBe(100);        // chunk 0 preserved, not discarded
    expect(res.failed).toBe(50);
    expect(res.responses).toHaveLength(150);
  });

  it('gives synthesized failures a clientSmsId so they align by identity', async () => {
    mockPost
      .mockImplementationOnce((_u, body) => Promise.resolve(acceptedResponse(body)) as never)
      .mockImplementationOnce(() => Promise.reject(new Error('provider 500')) as never);

    const res = await sendBulkSmsChunked(items(150));
    const failures = res.responses.filter((r) => !r.success);

    // Without this the failed half falls back to positional matching — the
    // exact defect H6 fixed for the success path.
    expect(failures).toHaveLength(50);
    expect(failures.every((r) => typeof r.clientSmsId === 'number')).toBe(true);
    expect(new Set(failures.map((r) => r.clientSmsId)).size).toBe(50);
  });

  it('carries the provider error text onto the failed rows', async () => {
    mockPost
      .mockImplementationOnce((_u, body) => Promise.resolve(acceptedResponse(body)) as never)
      .mockImplementationOnce(() => Promise.reject(new Error('connection reset')) as never);

    const res = await sendBulkSmsChunked(items(150));
    expect(res.responses.find((r) => !r.success)?.responseDescription).toContain('connection reset');
  });

  it('still throws when EVERY chunk fails, so outage handling runs', async () => {
    mockPost.mockRejectedValue(new Error('provider down'));
    await expect(sendBulkSmsChunked(items(150))).rejects.toThrow(/provider down/);
  });

  it('is unchanged for a fully successful send', async () => {
    mockPost.mockImplementation((_u, body) => Promise.resolve(acceptedResponse(body)) as never);

    const res = await sendBulkSmsChunked(items(150));
    expect(res.sent).toBe(150);
    expect(res.failed).toBe(0);
  });
});
