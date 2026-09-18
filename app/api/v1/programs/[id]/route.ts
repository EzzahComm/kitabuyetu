import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { db } from '@/lib/db';
import * as ecosystemService from '@/lib/services/ecosystem.service';

/**
 * GET /api/v1/programs/[id]
 * Get program details with donations
 */
export const GET = withAuth(async (req: NextRequest, ctx: any, { params }: any) => {
  const { id } = params;

  const program = await db.from('programs').select('*').eq('id', id).single();

  if (program.error || !program.data) {
    return NextResponse.json({ success: false, error: 'Program not found' }, { status: 404 });
  }

  // Verify org access
  if (program.data.organization_id !== ctx.organization_id && program.data.status !== 'active') {
    return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
  }

  // Get donations if public
  let donations = [];
  if (program.data.status === 'active' || program.data.organization_id === ctx.organization_id) {
    const donationsResult = await ecosystemService.listDonationsByProgram(id);
    donations = donationsResult.data || [];
  }

  return NextResponse.json({
    success: true,
    program: program.data,
    donations,
    stats: {
      totalRaised: program.data.current_amount,
      targetAmount: program.data.target_amount,
      donationCount: donations.length,
      progressPercent: program.data.target_amount
        ? Math.round((program.data.current_amount / program.data.target_amount) * 100)
        : 0,
      impactProgress: program.data.impact_metric_target
        ? Math.round((program.data.impact_metric_current / program.data.impact_metric_target) * 100)
        : 0,
    },
  });
});

/**
 * PATCH /api/v1/programs/[id]
 * Update program (org only)
 */
export const PATCH = withAuth(async (req: NextRequest, ctx: any, { params }: any) => {
  const { id } = params;
  const body = await req.json();

  // Verify ownership
  const program = await db
    .from('programs')
    .select('organization_id')
    .eq('id', id)
    .single();

  if (program.error || program.data.organization_id !== ctx.organization_id) {
    return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
  }

  const updated = await db
    .from('programs')
    .update({
      ...body,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (updated.error) {
    return NextResponse.json({ success: false, error: updated.error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    program: updated.data,
  });
});
