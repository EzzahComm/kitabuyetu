import { NextRequest, NextResponse } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  return withPlatformRole('super_admin', async ctx => {
    try {
      const programs = await db
        .from('programs')
        .select('*, organizations(name, logo_url)')
        .eq('status', 'pending_review')
        .order('created_at', { ascending: true });

      if (programs.error) {
        return NextResponse.json({ error: 'Failed to fetch pending programs' }, { status: 500 });
      }

      return NextResponse.json({ programs: programs.data || [] });
    } catch (error) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  })(req, {});
}
