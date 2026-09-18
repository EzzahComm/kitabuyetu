import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import * as ecosystemService from '@/lib/services/ecosystem.service';

/**
 * GET /api/v1/programs
 * List organization's programs
 */
export const GET = withAuth(async (req: NextRequest, ctx: any) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');

  const programs = await ecosystemService.listProgramsByOrg(ctx, { status: status || undefined });

  if (programs.error) {
    return NextResponse.json({ success: false, error: programs.error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    programs: programs.data,
    count: programs.data?.length || 0,
  });
});

/**
 * POST /api/v1/programs
 * Create new program
 */
export const POST = withAuth(async (req: NextRequest, ctx: any) => {
  const body = await req.json();

  const { name, slug, description, targetAmount, impactMetricName, impactMetricTarget, startDate, endDate } = body;

  if (!name || !slug) {
    return NextResponse.json(
      { success: false, error: 'name and slug are required' },
      { status: 422 },
    );
  }

  const program = await ecosystemService.createProgram(ctx, {
    name,
    slug,
    description,
    targetAmount: targetAmount ? parseFloat(targetAmount) : undefined,
    impactMetricName,
    impactMetricTarget: impactMetricTarget ? parseFloat(impactMetricTarget) : undefined,
    startDate,
    endDate,
  });

  if (program.error) {
    return NextResponse.json({ success: false, error: program.error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      success: true,
      program: program.data,
    },
    { status: 201 },
  );
});
