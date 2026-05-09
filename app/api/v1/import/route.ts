export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { importService } from '@/lib/services/import.service';
import { billingService } from '@/lib/services/billing.service';
import { ok, errorResponse } from '@/lib/utils/response';

export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    // Historical import is a Growth+ feature
    await billingService.assertFeatureAccess(ctx, 'historicalImport');

    const type = req.nextUrl.searchParams.get('type') ?? 'contributions';
    if (!['contributions', 'members'].includes(type)) {
      return errorResponse('type must be contributions or members', 'VALIDATION_ERROR', 422);
    }

    const formData = await req.formData();
    const file     = formData.get('file') as File | null;
    if (!file) return errorResponse('No file uploaded. Send multipart/form-data with a file field.', 'VALIDATION_ERROR', 422);

    const buffer = Buffer.from(await file.arrayBuffer());

    const result = type === 'members'
      ? await importService.importMembers(ctx, buffer)
      : await importService.importContributions(ctx, buffer);

    return ok(result);
  });
}
