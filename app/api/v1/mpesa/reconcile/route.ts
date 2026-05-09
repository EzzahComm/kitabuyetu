export const dynamic = 'force-dynamic'
/**
 * POST /api/v1/mpesa/reconcile â€” Trigger reconciliation (group_admin+)
 * GET  /api/v1/mpesa/reconcile â€” List reconciliation run history
 *
 * Reconciliation finds STK Push requests stuck in 'pending' for > 5 min,
 * queries Daraja for their actual status, and resolves mismatches.
 *
 * Can be triggered by Upstash QStash, a Vercel Cron, or manually.
 * Protected by either JWT (manual trigger) or CRON_SECRET header.
 */
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { runReconciliation } from '@/lib/services/mpesa.service';
import { ok, handleError } from '@/lib/utils/response';
import { withAdminDb } from '@/lib/db';

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('x-cron-secret') === secret;
}

export async function POST(req: NextRequest): Promise<Response> {
  // Allow cron-triggered calls without JWT
  if (verifyCronSecret(req)) {
    try {
      const result = await runReconciliation(null, null);
      return ok({ ...result, trigger: 'cron' });
    } catch (err) {
      return handleError(err);
    }
  }

  return withRole(req, 'group_admin', async (auth) => {
    try {
      const result = await runReconciliation(auth.groupId, auth.userId);
      return ok({ ...result, trigger: 'manual' });
    } catch (err) {
      return handleError(err);
    }
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'group_admin', async (auth) => {
    try {
      const rows = await withAdminDb(async (db) => {
        const { rows } = await db.query(
          `SELECT r.*, m.first_name||' '||m.last_name AS initiated_by_name
           FROM mpesa_reconciliations r
           LEFT JOIN members m ON m.id=r.initiated_by
           WHERE r.group_id=$1 OR r.group_id IS NULL
           ORDER BY r.started_at DESC LIMIT 20`,
          [auth.groupId],
        );
        return rows;
      });
      return ok(rows);
    } catch (err) {
      return handleError(err);
    }
  });
}
