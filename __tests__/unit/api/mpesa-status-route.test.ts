/**
 * The STK status poll must not let a cached 'pending' hide a payment the DB
 * already has as completed (DLQ replay / reconciliation / failed cache write).
 */
import { NextRequest } from 'next/server';

const getMpesaStatus = jest.fn();
jest.mock('@/lib/redis', () => ({ getMpesaStatus: (...a: unknown[]) => getMpesaStatus(...a) }));

const dbQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  withDb: (_ctx: unknown, fn: (db: { query: typeof dbQuery }) => unknown) => fn({ query: dbQuery }),
}));

jest.mock('@/lib/auth/middleware', () => ({
  withAuth: (_req: unknown, fn: (auth: Record<string, string>) => unknown) =>
    fn({ userId: 'u1', groupId: 'g1', role: 'treasurer', organizationId: '' }),
}));

import { GET } from '@/app/api/v1/mpesa/status/route';

function req(): NextRequest {
  return new NextRequest('http://localhost/api/v1/mpesa/status?checkoutRequestId=ws_CO_1');
}

async function statusOf(res: Response): Promise<string> {
  const body = (await res.json()) as { data: { status: string } };
  return body.data.status;
}

describe('GET /api/v1/mpesa/status', () => {
  beforeEach(() => {
    getMpesaStatus.mockReset();
    dbQuery.mockReset();
  });

  it('reads the DB when the cache still says pending', async () => {
    getMpesaStatus.mockResolvedValue('pending');
    dbQuery.mockResolvedValue({ rows: [{ status: 'completed', mpesa_receipt_number: 'R1' }] });

    expect(await statusOf(await GET(req()))).toBe('completed');
    expect(dbQuery).toHaveBeenCalledTimes(1);
  });

  it('serves a terminal cached status without touching the DB', async () => {
    getMpesaStatus.mockResolvedValue('completed');

    expect(await statusOf(await GET(req()))).toBe('completed');
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('falls back to the DB when Redis is unavailable', async () => {
    getMpesaStatus.mockRejectedValue(new Error('redis down'));
    dbQuery.mockResolvedValue({ rows: [{ status: 'pending', mpesa_receipt_number: null }] });

    expect(await statusOf(await GET(req()))).toBe('pending');
  });
});
