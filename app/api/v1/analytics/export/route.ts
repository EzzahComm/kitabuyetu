export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOneOf } from '@/lib/auth/middleware';
import { analyticsService, EXPORT_KINDS, type ExportKind } from '@/lib/services/analytics.service';
import { errorResponse } from '@/lib/utils/response';

/**
 * GET /api/v1/analytics/export?type=members|contributions|loans|share_holdings|credit_scores
 * Streams the full dataset as CSV. Filename embeds today's date so
 * repeated exports don't clobber each other in the operator's downloads.
 *
 * Role-gated to officers/admins. A regular `member` shouldn't be able
 * to bulk-export the group's credit scores, share holdings, or loan
 * ledger — those reveal financial details about other members.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withOneOf(req, ['group_admin', 'treasurer', 'secretary', 'super_admin'], async (auth) => {
    const ctx  = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const type = (req.nextUrl.searchParams.get('type') ?? '') as ExportKind;
    if (!EXPORT_KINDS.includes(type)) {
      return errorResponse(
        `Unsupported export type: ${type || '(missing)'}. Supported: ${EXPORT_KINDS.join(', ')}.`,
        'VALIDATION_ERROR', 422,
      );
    }
    const { csv, filename } = await analyticsService.exportCsv(ctx, type);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
    });
  });
}
