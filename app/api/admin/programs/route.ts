import { NextRequest, NextResponse } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin'], async () => {
    try {
      const supabase = await createClient();
      const { data: programs, error } = await supabase
        .from('programs')
        .select('*, organizations(name, logo_url)')
        .eq('status', 'pending_review')
        .order('created_at', { ascending: true });

      if (error) {
        return NextResponse.json({ error: 'Failed to fetch pending programs' }, { status: 500 });
      }

      return NextResponse.json({ programs: programs || [] });
    } catch (error) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
