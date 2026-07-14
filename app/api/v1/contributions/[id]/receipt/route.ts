export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { withAuth } from '@/lib/auth/middleware';
import { withDb } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { errorResponse, handleError } from '@/lib/utils/response';
import { ContributionReceipt } from '@/components/pdf/contribution-receipt';
import { formatMembershipNo } from '@/lib/utils/membership-no';

interface RouteParams { params: Promise<{ id: string }> }

/**
 * GET /api/v1/contributions/[id]/receipt
 * Streams a branded PDF receipt for a completed contribution. Only completed
 * contributions get a receipt; pending/cancelled return 422.
 */
export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;

  return withAuth(req, async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

      const data = await withDb(ctx, async (client) => {
        const { rows } = await client.query<{
          id:                   string;
          amount:               string;
          status:               string;
          payment_method:       string | null;
          mpesa_receipt_number: string | null;
          contribution_date:    string;
          created_at:           string;
          group_name:           string;
          group_code:           string;
          member_first_name:    string;
          member_last_name:     string;
          membership_no:        string | null;
        }>(
          `SELECT c.id, c.amount, c.status, c.payment_method,
                  c.mpesa_receipt_number, c.contribution_date, c.created_at,
                  g.name        AS group_name,
                  g.group_code  AS group_code,
                  m.first_name  AS member_first_name,
                  m.last_name   AS member_last_name,
                  gm.membership_no AS membership_no
           FROM contributions c
           JOIN groups  g  ON g.id = c.group_id
           JOIN members m  ON m.id = c.member_id
           LEFT JOIN group_members gm ON gm.group_id = c.group_id AND gm.member_id = c.member_id
           WHERE c.group_id = $1 AND c.id = $2`,
          [ctx.groupId, id],
        );
        if (!rows[0]) throw new NotFoundError('Contribution', id);
        return rows[0];
      });

      if (data.status !== 'completed') {
        throw new ValidationError(`Only completed contributions have a receipt (this one is '${data.status}').`);
      }

      const pdfBuffer = await renderToBuffer(
        ContributionReceipt({
          groupName:        data.group_name,
          groupCode:        data.group_code,
          memberFirstName:  data.member_first_name,
          memberLastName:   data.member_last_name,
          membershipNo:     data.membership_no ? formatMembershipNo(data.membership_no) : null,
          amount:           data.amount,
          paymentMethod:    data.payment_method,
          mpesaReceipt:     data.mpesa_receipt_number,
          contributionDate: data.contribution_date,
          receiptNo:        data.id.slice(0, 8).toUpperCase(),
          issuedAt:         data.created_at,
        }),
      );

      const blob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' });
      return new Response(blob, {
        status: 200,
        headers: {
          'Content-Type':        'application/pdf',
          'Content-Disposition': `inline; filename="receipt-${data.id.slice(0, 8)}.pdf"`,
          'Cache-Control':       'private, max-age=0, must-revalidate',
        },
      });
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) {
        return handleError(err);
      }
      return errorResponse(`Failed to generate receipt: ${(err as Error).message}`, 'INTERNAL_ERROR', 500);
    }
  });
}
