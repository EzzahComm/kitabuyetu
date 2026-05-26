export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { generateDynamicQr } from '@/lib/services/daraja.service';
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
  return withAuth(req, async () => {
    try {
      const input = Schema.parse(await req.json());
      const resp  = await generateDynamicQr(input);
      if (resp.ResponseCode !== '00') {
        return handleError(new Error(`Daraja QR error: ${resp.ResponseDescription}`));
      }
      return ok({
        qrCodePng:  `data:image/png;base64,${resp.QRCode}`,
        requestId:  resp.RequestID,
        description: resp.ResponseDescription,
      });
    } catch (err) {
      return handleError(err);
    }
  });
}
