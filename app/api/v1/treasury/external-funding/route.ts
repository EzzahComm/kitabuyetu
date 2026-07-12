export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/treasury/external-funding — disbursements this group has
 * received from partner organizations (grants, revolving funds, loan
 * capital…). Group-side, read-only view of the org → group money trail;
 * scoped strictly to the caller's group. The organization's wallet and
 * ledger remain invisible to groups by design.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const page  = Math.max(1, parseInt(req.nextUrl.searchParams.get('page')  ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10)));

    const data = await withAdminDb(async (db) => {
      const { rows: countRows } = await db.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM organization_disbursements WHERE group_id = $1`,
        [auth.groupId],
      );
      const { rows } = await db.query(
        `SELECT d.id, d.disbursement_type, d.amount, d.currency, d.status,
                d.reference, d.notes, d.created_at, d.completed_at,
                o.name  AS organization_name,
                fp.name AS program_name
         FROM   organization_disbursements d
         JOIN   organizations o ON o.id = d.organization_id
         LEFT JOIN funding_programs fp ON fp.id = d.funding_program_id
         WHERE  d.group_id = $1
         ORDER  BY d.created_at DESC
         LIMIT  $2 OFFSET $3`,
        [auth.groupId, limit, (page - 1) * limit],
      );
      const { rows: totals } = await db.query<{ total_received: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total_received
         FROM organization_disbursements
         WHERE group_id = $1 AND status = 'completed'`,
        [auth.groupId],
      );
      return {
        items: rows,
        total: parseInt(countRows[0]?.n ?? '0', 10),
        totalReceived: totals[0]?.total_received ?? '0',
        page, limit,
      };
    });

    return ok(data);
  });
}
