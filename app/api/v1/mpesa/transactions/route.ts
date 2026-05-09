export const dynamic = 'force-dynamic'
/**
 * GET /api/v1/mpesa/transactions â€” Paginated list of all M-Pesa transactions
 *
 * Query params: page, limit, type, status, phone, dateFrom, dateTo
 */
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { ok, handleError } from '@/lib/utils/response';
import { withAdminDb } from '@/lib/db';

export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    try {
      const sp       = req.nextUrl.searchParams;
      const page     = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
      const limit    = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '25', 10)));
      const offset   = (page - 1) * limit;
      const txType   = sp.get('type');
      const status   = sp.get('status');
      const phone    = sp.get('phone');
      const dateFrom = sp.get('dateFrom');
      const dateTo   = sp.get('dateTo');

      const conditions: string[] = ['group_id=$1'];
      const params: unknown[] = [auth.groupId];
      let idx = 2;

      if (txType)   { conditions.push(`transaction_type=$${idx++}`); params.push(txType); }
      if (status)   { conditions.push(`status=$${idx++}`);           params.push(status); }
      if (phone)    { conditions.push(`phone_number ILIKE $${idx++}`); params.push(`%${phone}%`); }
      if (dateFrom) { conditions.push(`created_at>=$${idx++}`);      params.push(dateFrom); }
      if (dateTo)   { conditions.push(`created_at<=$${idx++}`);      params.push(dateTo); }

      const where = conditions.join(' AND ');

      const [{ rows: items }, { rows: countRows }] = await withAdminDb(async (db) =>
        Promise.all([
          db.query(
            `SELECT id, transaction_type, direction, mpesa_receipt_number,
                    phone_number, amount, status, reference, description,
                    failure_reason, initiated_at, completed_at, created_at
             FROM mpesa_transactions WHERE ${where}
             ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
            [...params, limit, offset],
          ),
          db.query<{ count: string }>(
            `SELECT COUNT(*) FROM mpesa_transactions WHERE ${where}`,
            params,
          ),
        ]),
      );

      const total = parseInt(countRows[0].count, 10);

      return ok({
        items,
        total,
        page,
        pageSize:   limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      return handleError(err);
    }
  });
}
