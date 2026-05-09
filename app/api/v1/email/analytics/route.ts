import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/middleware';
import { getEmailAnalytics } from '@/lib/services/delivery-tracking.service';

export async function GET(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const days = Number(new URL(req.url).searchParams.get('days') ?? 30);

  const groupId = auth.role === 'super_admin' ? null : auth.groupId;
  const analytics = await getEmailAnalytics(groupId, days);

  return NextResponse.json({ success: true, data: analytics });
}
