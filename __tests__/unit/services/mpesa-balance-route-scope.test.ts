import { NextRequest } from 'next/server';

/**
 * /api/v1/mpesa/balance used to let any treasurer trigger a query against the
 * PLATFORM shortcode (MPESA_SHORTCODE, shared by every group) and read its
 * working/utility/charges balances back. These tests pin that:
 *   - a tenant POST (no ?type=) is refused and never reaches Daraja, and
 *   - GET returns only the CALLER'S group ledger balance, scoped by the
 *     session's groupId, with no Daraja fields.
 */

const getCashBalances = jest.fn();
const queryAccountBalance = jest.fn();

jest.mock('@/lib/auth/middleware', () => ({
  withPermission: (_req: unknown, _perm: string, handler: (a: unknown) => Promise<Response>) =>
    handler({ userId: 'u1', groupId: 'group-A', role: 'treasurer' }),
}));
jest.mock('@/lib/services/accounting.service', () => ({
  accountingService: { getCashBalances: (...a: unknown[]) => getCashBalances(...a) },
}));
jest.mock('@/lib/services/daraja.service', () => ({
  isValidCallbackToken: jest.fn(() => false),
  queryAccountBalance: (...a: unknown[]) => queryAccountBalance(...a),
}));
jest.mock('@/lib/services/mpesa.service', () => ({ handleBalanceResult: jest.fn() }));
jest.mock('@/lib/db', () => ({ withAdminDb: jest.fn() }));
jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  return { ...actual, after: (fn: () => void) => fn() };
});

import { GET, POST } from '@/app/api/v1/mpesa/balance/route';

const req = (url: string, init?: RequestInit) => new NextRequest(`http://localhost${url}`, init);

describe('mpesa balance route scope', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses a tenant trigger and never queries the platform shortcode', async () => {
    const res = await POST(req('/api/v1/mpesa/balance', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(403);
    expect(queryAccountBalance).not.toHaveBeenCalled();
  });

  it("returns the caller's own group ledger balance, scoped by session groupId", async () => {
    getCashBalances.mockResolvedValue({ cashAndMpesa: 1200, bank: 300, total: 1500 });
    const res = await GET(req('/api/v1/mpesa/balance'));
    expect(res.status).toBe(200);
    expect(getCashBalances).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group-A' }));
    const body = await res.json();
    expect(body.data).toMatchObject({ cashAndMpesa: 1200, bank: 300, total: 1500 });
    expect(body.data).not.toHaveProperty('workingAccountBalance');
    expect(queryAccountBalance).not.toHaveBeenCalled();
  });
});
