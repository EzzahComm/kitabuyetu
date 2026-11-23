export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { confirmedPaymentRequired } from '@/lib/utils/response';

export function POST(req: NextRequest, _context: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPermission(req, 'dividends.manage', async () => confirmedPaymentRequired());
}
