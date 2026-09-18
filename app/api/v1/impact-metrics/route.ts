import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import * as ecosystemService from '@/lib/services/ecosystem.service';

/**
 * GET /api/v1/impact-metrics
 * Get organization's impact summary
 */
export const GET = withAuth(async (req: NextRequest, ctx: any) => {
  const summary = await ecosystemService.getImpactSummary(ctx.organization_id);

  if (summary.error) {
    return NextResponse.json({ success: false, error: summary.error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    ...summary.data,
  });
});

/**
 * POST /api/v1/impact-metrics
 * Record new impact metric
 */
export const POST = withAuth(async (req: NextRequest, ctx: any) => {
  const body = await req.json();
  const { metricName, metricType, currentValue, targetValue, unitName } = body;

  if (!metricName || !metricType || currentValue === undefined) {
    return NextResponse.json(
      { success: false, error: 'metricName, metricType, and currentValue are required' },
      { status: 422 },
    );
  }

  const metric = await ecosystemService.recordImpactMetric(ctx, {
    metricName,
    metricType,
    currentValue: parseFloat(currentValue),
    targetValue: targetValue ? parseFloat(targetValue) : undefined,
    unitName,
  });

  if (metric.error) {
    return NextResponse.json({ success: false, error: metric.error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      success: true,
      metric: metric.data,
    },
    { status: 201 },
  );
});
