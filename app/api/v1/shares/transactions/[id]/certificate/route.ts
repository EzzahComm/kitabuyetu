export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { withAuth } from '@/lib/auth/middleware';
import { withDb } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { errorResponse, handleError } from '@/lib/utils/response';
import { ShareCertificate, type ShareCertificateProps } from '@/components/pdf/share-certificate';

interface RouteParams { params: Promise<{ id: string }> }

/**
 * GET /api/v1/shares/transactions/[id]/certificate
 * Renders the share certificate for an inflow transaction as a PDF.
 *
 * Only inflow types (allocation, purchase, transfer_in) have a certificate
 * serial; outflows (redemption, transfer_out, negative adjustment) return 422.
 */
export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;

  return withAuth(req, async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

      const data = await withDb(ctx, async (client) => {
        const { rows } = await client.query<{
          // share_transactions
          id:                  string;
          type:                ShareCertificateProps['txnType'] | 'transfer_out' | 'redemption' | 'adjustment';
          quantity:            number;
          unit_price:          string;
          total_amount:        string;
          certificate_serial:  string | null;
          posted_at:           string;
          // joined
          group_name:          string;
          group_code:          string;
          is_gov_registered:   boolean;
          registration_no:     string | null;
          member_first_name:   string;
          member_last_name:    string;
          member_code:         string | null;
          member_national_id:  string | null;
          share_class_name:    string;
          share_class_code:    string;
          voting_weight:       string;
        }>(
          `SELECT
             t.id, t.type, t.quantity, t.unit_price, t.total_amount,
             t.certificate_serial, t.posted_at,
             g.name                          AS group_name,
             g.group_code                    AS group_code,
             g.is_government_registered      AS is_gov_registered,
             g.registration_number           AS registration_no,
             m.first_name                    AS member_first_name,
             m.last_name                     AS member_last_name,
             gm.member_code                  AS member_code,
             m.national_id                   AS member_national_id,
             c.name                          AS share_class_name,
             c.code                          AS share_class_code,
             c.voting_weight                 AS voting_weight
           FROM share_transactions t
           JOIN groups        g  ON g.id  = t.group_id
           JOIN members       m  ON m.id  = t.member_id
           JOIN group_members gm ON gm.group_id = t.group_id AND gm.member_id = t.member_id
           JOIN share_classes c  ON c.id  = t.share_class_id
          WHERE t.group_id = $1 AND t.id = $2`,
          [ctx.groupId, id],
        );
        if (!rows[0]) throw new NotFoundError('Share transaction', id);
        return rows[0];
      });

      // Only inflow transactions have a certificate.
      if (!['allocation', 'purchase', 'transfer_in'].includes(data.type)) {
        throw new ValidationError(
          `Transaction type '${data.type}' does not issue a share certificate (only allocation, purchase, transfer_in do).`,
        );
      }
      if (!data.certificate_serial) {
        throw new ValidationError(
          'This transaction has no certificate serial — likely a pre-E4 record. Contact admin to backfill.',
        );
      }

      // total_value = quantity × unit_price; service computes this at insert
      // time as total_amount, but for allocation transactions total_amount
      // can be 0 (free shares) so the cert should show face value instead.
      const totalValue = (data.quantity * Number(data.unit_price)).toFixed(2);

      const pdfBuffer = await renderToBuffer(
        ShareCertificate({
          groupName:        data.group_name,
          groupCode:        data.group_code,
          isGovRegistered:  data.is_gov_registered,
          registrationNo:   data.registration_no,
          memberFirstName:  data.member_first_name,
          memberLastName:   data.member_last_name,
          memberCode:       data.member_code,
          memberNationalId: data.member_national_id,
          shareClassName:   data.share_class_name,
          shareClassCode:   data.share_class_code,
          quantity:         data.quantity,
          unitPrice:        data.unit_price,
          totalValue,
          votingWeight:     data.voting_weight,
          certificateSerial: data.certificate_serial,
          issuedAt:          data.posted_at,
          txnType:           data.type as ShareCertificateProps['txnType'],
          txnId:             data.id,
        }),
      );

      // Filename: clean serial for the download filename.
      const filename = `share-cert-${data.certificate_serial}.pdf`;
      // Wrap in Blob — Buffer/Uint8Array trip the strict BodyInit checks in
      // this codebase's TS lib set; Blob is unambiguously BodyInit.
      // Inline disposition so clicking opens the PDF in a new tab; the user
      // can still save it from the browser's viewer.
      const blob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' });
      return new Response(blob, {
        status: 200,
        headers: {
          'Content-Type':        'application/pdf',
          'Content-Disposition': `inline; filename="${filename}"`,
          'Cache-Control':       'private, max-age=0, must-revalidate',
        },
      });
    } catch (err) {
      // withAuth's normal handleError chain doesn't run because we're outside
      // the wrapper's promise chain — call it manually.
      if (err instanceof ValidationError || err instanceof NotFoundError) {
        return handleError(err);
      }
      // PDF render failure or unexpected; surface as 500.
      return errorResponse(
        `Failed to generate certificate: ${(err as Error).message}`,
        'INTERNAL_ERROR', 500,
      );
    }
  });
}
