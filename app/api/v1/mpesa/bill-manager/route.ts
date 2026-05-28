export const dynamic = 'force-dynamic'
/**
 * Bill Manager API routes.
 *
 * POST /api/v1/mpesa/bill-manager/optin       â€” Opt-in (super_admin)
 * POST /api/v1/mpesa/bill-manager/invoice     â€” Create single invoice
 * POST /api/v1/mpesa/bill-manager/bulk        â€” Create bulk invoices
 * POST /api/v1/mpesa/bill-manager/cancel      â€” Cancel invoice(s)
 * PUT  /api/v1/mpesa/bill-manager/invoice     â€” Update single invoice
 * PUT  /api/v1/mpesa/bill-manager/bulk        â€” Update bulk invoices
 * GET  /api/v1/mpesa/bill-manager             â€” List group's BM invoices
 * POST /api/v1/mpesa/bill-manager?type=reconciliation â€” Safaricom callback
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { withRole } from '@/lib/auth/middleware';
import {
  billManagerOptIn,
  updateBillManagerOptIn,
  sendSingleInvoice,
  sendBulkInvoices,
  updateSingleInvoice,
  updateBulkInvoices,
  cancelSingleInvoice,
  cancelBulkInvoices,
  reconcileBillManagerPayment,
  type BillManagerInvoice,
} from '@/lib/services/daraja.service';
import { ok, handleError } from '@/lib/utils/response';
import { withAdminDb } from '@/lib/db';
import { isValidKenyanPhone, normalizePhone } from '@/lib/utils/phone';

const InvoiceSchema = z.object({
  externalReference: z.string().min(1).max(50),
  billedFullName:    z.string().min(1).max(100),
  billedPhoneNumber: z.string().refine(isValidKenyanPhone, 'Invalid phone'),
  billedPeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  billedPeriodEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invoiceDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountReference:  z.string().min(1).max(20),
  amount:            z.number().positive(),
  invoiceName:       z.string().min(1).max(100),
});

const ack = () => NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });

function callerIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
}

export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'group_admin', async (auth) => {
    try {
      const status = req.nextUrl.searchParams.get('status');
      const rows = await withAdminDb(async (db) => {
        const { rows } = await db.query(
          `SELECT * FROM bill_manager_invoices
           WHERE group_id=$1 ${status ? 'AND status=$2' : ''}
           ORDER BY due_date DESC LIMIT 100`,
          status ? [auth.groupId, status] : [auth.groupId],
        );
        return rows;
      });
      return ok(rows);
    } catch (err) {
      return handleError(err);
    }
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const action = req.nextUrl.searchParams.get('action');
  const type   = req.nextUrl.searchParams.get('type');
  const ip     = callerIp(req);

  // Safaricom reconciliation callback (no JWT)
  if (type === 'reconciliation') {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return ack(); }
    after(() => {
      withAdminDb((db) =>
        db.query(
          `INSERT INTO mpesa_callbacks (callback_type, caller_ip, body)
           VALUES ('bill_manager_reconciliation',$1,$2)`,
          [ip, JSON.stringify(body)],
        ),
      ).catch(() => {});
    });
    return ack();
  }

  if (action === 'optin') {
    return withRole(req, 'super_admin', async () => {
      try {
        const input = z.object({
          email:           z.string().email(),
          officialContact: z.string(),
          sendReminders:   z.union([z.literal(0), z.literal(1)]),
          logo:            z.string().url().optional(),
          callbackUrl:     z.string().url().optional(),
        }).parse(await req.json());

        await billManagerOptIn({
          ...input,
          callbackUrl: input.callbackUrl ??
            `${process.env.MPESA_CALLBACK_BASE_URL ?? ''}/api/v1/mpesa/bill-manager?type=reconciliation`,
        });
        return ok({ message: 'Bill Manager opt-in successful.' });
      } catch (err) {
        return handleError(err);
      }
    });
  }

  if (action === 'invoice') {
    return withRole(req, 'group_admin', async (auth) => {
      try {
        const input = InvoiceSchema.parse(await req.json());
        await sendSingleInvoice(input as BillManagerInvoice);

        // Persist locally
        await withAdminDb((db) =>
          db.query(
            `INSERT INTO bill_manager_invoices
               (group_id, external_reference, billed_full_name, billed_phone,
                billed_period_start, billed_period_end, amount,
                account_reference, invoice_name, due_date, sent_to_safaricom, sent_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,NOW())
             ON CONFLICT (group_id, external_reference) DO UPDATE
               SET billed_full_name=$3, amount=$7, due_date=$10,
                   sent_to_safaricom=true, sent_at=NOW()`,
            [
              auth.groupId, input.externalReference, input.billedFullName,
              normalizePhone(input.billedPhoneNumber), input.billedPeriodStart,
              input.billedPeriodEnd, input.amount.toFixed(2),
              input.accountReference, input.invoiceName, input.dueDate,
            ],
          ),
        );

        return ok({ message: 'Invoice sent to Bill Manager.' });
      } catch (err) {
        return handleError(err);
      }
    });
  }

  if (action === 'bulk') {
    return withRole(req, 'group_admin', async (auth) => {
      try {
        const invoices = z.array(InvoiceSchema).min(1).max(100).parse(await req.json());
        await sendBulkInvoices(invoices as BillManagerInvoice[]);

        // Persist all locally
        await withAdminDb(async (db) => {
          for (const inv of invoices) {
            await db.query(
              `INSERT INTO bill_manager_invoices
                 (group_id, external_reference, billed_full_name, billed_phone,
                  billed_period_start, billed_period_end, amount,
                  account_reference, invoice_name, due_date, sent_to_safaricom, sent_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,NOW())
               ON CONFLICT (group_id, external_reference) DO UPDATE
                 SET sent_to_safaricom=true, sent_at=NOW()`,
              [
                auth.groupId, inv.externalReference, inv.billedFullName,
                normalizePhone(inv.billedPhoneNumber), inv.billedPeriodStart,
                inv.billedPeriodEnd, inv.amount.toFixed(2),
                inv.accountReference, inv.invoiceName, inv.dueDate,
              ],
            );
          }
        });

        return ok({ message: `${invoices.length} invoice(s) sent to Bill Manager.` });
      } catch (err) {
        return handleError(err);
      }
    });
  }

  if (action === 'cancel') {
    return withRole(req, 'group_admin', async (auth) => {
      try {
        const { externalReferences } = z.object({
          externalReferences: z.array(z.string()).min(1),
        }).parse(await req.json());

        if (externalReferences.length === 1) {
          await cancelSingleInvoice(externalReferences[0]);
        } else {
          await cancelBulkInvoices(externalReferences);
        }

        await withAdminDb((db) =>
          db.query(
            `UPDATE bill_manager_invoices
             SET status='cancelled', cancelled_at=NOW()
             WHERE group_id=$1 AND external_reference=ANY($2)`,
            [auth.groupId, externalReferences],
          ),
        );

        return ok({ message: `${externalReferences.length} invoice(s) cancelled.` });
      } catch (err) {
        return handleError(err);
      }
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const action = req.nextUrl.searchParams.get('action');

  if (action === 'invoice') {
    return withRole(req, 'group_admin', async () => {
      try {
        const input = InvoiceSchema.parse(await req.json());
        await updateSingleInvoice(input as BillManagerInvoice);
        return ok({ message: 'Invoice updated.' });
      } catch (err) {
        return handleError(err);
      }
    });
  }

  if (action === 'bulk') {
    return withRole(req, 'group_admin', async () => {
      try {
        const invoices = z.array(InvoiceSchema).min(1).parse(await req.json());
        await updateBulkInvoices(invoices as BillManagerInvoice[]);
        return ok({ message: `${invoices.length} invoice(s) updated.` });
      } catch (err) {
        return handleError(err);
      }
    });
  }

  if (action === 'optin') {
    return withRole(req, 'super_admin', async () => {
      try {
        const input = z.object({
          email:           z.string().email().optional(),
          officialContact: z.string().optional(),
          sendReminders:   z.union([z.literal(0), z.literal(1)]).optional(),
        }).parse(await req.json());
        await updateBillManagerOptIn(input);
        return ok({ message: 'Bill Manager opt-in details updated.' });
      } catch (err) {
        return handleError(err);
      }
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
}
