export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { generateDynamicQr } from '@/lib/services/daraja.service';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ok, handleError } from '@/lib/utils/response';

/**
 * POST /api/v1/mpesa/qr
 *
 * Generate a Daraja Dynamic QR code for in-person payments. Returns a
 * base64-encoded PNG the frontend renders inline.
 *
 * Use cases:
 *   - Group meeting: project a QR for the day's contribution amount.
 *   - Event collections: per-event QR with a known CPI (paybill/till).
 *
 * NOT a substitute for STK Push — there's no callback flow tied to a QR
 * scan; reconciliation happens via the regular C2B confirmation when the
 * customer's M-Pesa app completes the payment.
 */
const Schema = z.object({
  merchantName: z.string().min(1).max(22),
  refNo:        z.string().min(1).max(80),
  /** Whole shillings. 0 lets the customer enter the amount in the M-Pesa app. */
  amount:       z.number().int().nonnegative(),
  trxCode:      z.enum(['BG', 'PB', 'WA', 'SB', 'SM', 'SS']),
  /** Paybill / Till / phone — depends on trxCode. */
  cpi:          z.string().min(1).max(20),
  size:         z.number().int().positive().max(800).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    try {
      const input = Schema.parse(await req.json());
      const resp  = await generateDynamicQr(input);
      if (resp.ResponseCode !== '00') {
        return handleError(new Error(`Daraja QR error: ${resp.ResponseDescription}`));
      }

      // Persist for audit / reprint. Non-blocking — a logging failure must not
      // deny the caller the QR they successfully generated.
      const qrId = await withAdminDb((db) =>
        db.query<{ id: string }>(
          `INSERT INTO mpesa_qr_codes
             (group_id, merchant_name, ref_no, amount, trx_code, cpi, size_px,
              daraja_request_id, generated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [
            auth.groupId, input.merchantName, input.refNo, input.amount,
            input.trxCode, input.cpi, input.size ?? 300,
            resp.RequestID ?? null, auth.userId,
          ],
        ).then((r) => r.rows[0]?.id ?? null),
      ).catch((err) => {
        logger.error('[mpesa/qr] failed to persist QR record', { err: String(err) });
        return null;
      });

      return ok({
        id:          qrId,
        qrCodePng:   `data:image/png;base64,${resp.QRCode}`,
        requestId:   resp.RequestID,
        description: resp.ResponseDescription,
      });
    } catch (err) {
      return handleError(err);
    }
  });
}
