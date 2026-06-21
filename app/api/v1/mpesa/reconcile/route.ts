/**
 * POST /api/v1/mpesa/reconcile — Trigger reconciliation (group_admin+)
 * POST /api/v1/mpesa/reconcile?type=paybill — Trigger paybill sweep (group_admin+)
 * GET  /api/v1/mpesa/reconcile — List reconciliation run history
 *
 * Reconciliation types:
 *  - stk (default): finds STK Push requests stuck in 'pending' for > 5 min,
 *    queries Daraja for their actual status, and resolves mismatches.
 *  - paybill: sweeps recent C2B/paybill transactions and matches them against
 *    unreconciled contributions using account_reference. Auto-fulfils matches.
 *
 * Can be triggered by Upstash QStash, a Vercel Cron, or manually.
 * Protected by either JWT (manual trigger) or CRON_SECRET header.
 */
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { withRole } from '@/lib/auth/middleware';
import { runReconciliation, sweepPaybillTransactions } from '@/lib/services/mpesa.service';
import { ok, handleError } from '@/lib/utils/response';
import { withAdminDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = req.headers.get('x-cron-secret') ?? '';
  // Timing-safe comparison prevents secret leakage via timing side-channel.
  const ha = crypto.createHash('sha256').update(provided).digest();
  const hb = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export async function POST(req: NextRequest): Promise<Response> {
  const type = req.nextUrl.searchParams.get('type') ?? 'stk';
  
  // Allow cron-triggered calls without JWT
  if (verifyCronSecret(req)) {
    try {
      const result = type === 'paybill'
        ? await sweepPaybillTransactions(null, null)
        : await runReconciliation(null, null);
      return ok({ ...result, trigger: 'cron', reconciliationType: type });
    } catch (err) {
      return handleError(err);
    }
  }

  // Treasurer+ — matches the rest of the M-Pesa ops surface (the /mpesa
  // dashboard that links here is treasurer-accessible). Reconciliation is
  // idempotent (queries Daraja or sweeps C2B).
  return withRole(req, 'treasurer', async (auth) => {
    try {
      const result = type === 'paybill'
        ? await sweepPaybillTransactions(auth.groupId, auth.userId)
        : await runReconciliation(auth.groupId, auth.userId);
      return ok({ ...result, trigger: 'manual', reconciliationType: type });
    } catch (err) {
      return handleError(err);
    }
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
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
