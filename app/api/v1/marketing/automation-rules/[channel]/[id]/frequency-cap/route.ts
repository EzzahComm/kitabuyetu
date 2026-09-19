export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import {
  listFrequencyCaps, upsertFrequencyCap, type FrequencyCapCategory,
} from '@/lib/services/automation-rules.service';
import { ok, badRequest } from '@/lib/utils/response';

interface Params { params: { channel: string; id: string } }

const CATEGORIES: FrequencyCapCategory[] = ['transactional', 'marketing', 'promotional'];

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  return withPermission(request, 'crm.view', async (auth) => {
    if (params.channel !== 'email') return badRequest('Frequency caps only apply to email rules');
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const caps = await listFrequencyCaps(ctx, params.id);
    return ok(caps);
  });
}

export async function PUT(request: NextRequest, { params }: Params): Promise<Response> {
  return withPermission(request, 'crm.manage', async (auth) => {
    if (params.channel !== 'email') return badRequest('Frequency caps only apply to email rules');
    const body = await request.json();
    const { category, max_per_day } = body;

    if (!category || !CATEGORIES.includes(category)) return badRequest('category must be transactional, marketing, or promotional');
    if (!max_per_day || typeof max_per_day !== 'number') return badRequest('max_per_day is required');

    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const cap = await upsertFrequencyCap(ctx, params.id, { category, max_per_day });
    return ok(cap);
  });
}
