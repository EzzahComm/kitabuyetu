export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { importService } from '@/lib/services/import.service';
import { billingService } from '@/lib/services/billing.service';
import { ok, errorResponse } from '@/lib/utils/response';

/**
 * GET /api/v1/import — list this group's import jobs (most recent first).
 * Optional ?kind=members and ?limit / ?offset.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const sp     = req.nextUrl.searchParams;
    const result = await importService.listJobs(ctx, {
      kind:   sp.get('kind')   ?? undefined,
      limit:  sp.get('limit')  ? parseInt(sp.get('limit')!,  10) : undefined,
      offset: sp.get('offset') ? parseInt(sp.get('offset')!, 10) : undefined,
    });
    return ok(result);
  });
}

/**
 * POST /api/v1/import?type=contributions — legacy single-shot contribution
 * upload. Kept for backward compatibility. New member imports go through
 * /api/v1/import/preview → /[jobId]/commit so the user sees a preview
 * before changes hit the DB.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const ctx  = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const type = req.nextUrl.searchParams.get('type') ?? 'contributions';

    if (type === 'members') {
      return errorResponse(
        'Members import now uses the two-phase preview/commit flow. POST to /api/v1/import/preview instead.',
        'GONE', 410,
      );
    }
    if (type !== 'contributions') {
      return errorResponse(`Unsupported import type: ${type}`, 'VALIDATION_ERROR', 422);
    }

    await billingService.assertFeatureAccess(ctx, 'historicalImport');

    const formData = await req.formData();
    const file     = formData.get('file') as File | null;
    if (!file) return errorResponse('No file uploaded. Send multipart/form-data with a file field.', 'VALIDATION_ERROR', 422);

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importService.importContributions(ctx, buffer);
    return ok(result);
  });
}
