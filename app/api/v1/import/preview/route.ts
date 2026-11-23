export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { importService } from '@/lib/services/import.service';
import { billingService } from '@/lib/services/billing.service';
import { IMPORT_KINDS, type ImportKind } from '@/lib/validators/import.schema';
import { created, errorResponse, confirmedPaymentRequired } from '@/lib/utils/response';

/**
 * POST /api/v1/import/preview?type=members
 * multipart/form-data with `file` field. Parses + validates the CSV and
 * returns an import_job in 'previewed' status that the UI can render
 * before the caller confirms with /[jobId]/commit.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'import.preview', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const type = (req.nextUrl.searchParams.get('type') ?? 'members') as ImportKind;
    if (!IMPORT_KINDS.includes(type)) {
      return errorResponse(
        `Unsupported preview type: ${type}. Supported: ${IMPORT_KINDS.join(', ')}.`,
        'VALIDATION_ERROR',
        422,
      );
    }

    if (type !== 'members') return confirmedPaymentRequired();

    await billingService.assertFeatureAccess(ctx, 'historicalImport');

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file)
      return errorResponse('No file uploaded. Send multipart/form-data with a file field.', 'VALIDATION_ERROR', 422);

    // 5MB hard cap protects the lambda + DB JSONB store. CSV_MAX_ROWS in
    // the service is the real ceiling; this is the fast fail.
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return errorResponse(
        `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds 5MB cap`,
        'VALIDATION_ERROR',
        413,
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name || null;

    const job = await importService.previewMembers(ctx, buffer, filename);

    return created(job);
  });
}
