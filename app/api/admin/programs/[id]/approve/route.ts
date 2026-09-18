import { NextRequest, NextResponse } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPlatformRole(req, ['super_admin'], async (ctx: any) => {
    try {
      const { id } = await params;
      const supabase = await createClient();

      // Verify program exists and is pending
      const { data: program, error: fetchError } = await supabase
        .from('programs')
        .select('*')
        .eq('id', id)
        .eq('status', 'pending_review')
        .single();

      if (fetchError || !program) {
        return NextResponse.json({ error: 'Program not found or not pending review' }, { status: 404 });
      }

      // Approve program
      const { data: updated, error: updateError } = await supabase
        .from('programs')
        .update({
          status: 'active',
          reviewed_by: ctx.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select();

      if (updateError) {
        return NextResponse.json({ error: 'Failed to approve program' }, { status: 500 });
      }

      // Log audit entry
      await supabase.from('audit_logs').insert({
        organization_id: program.organization_id,
        action: 'program_approved',
        actor_id: ctx.user.id,
        entity_type: 'program',
        entity_id: id,
        changes: { status: { from: 'pending_review', to: 'active' } },
      });

      return NextResponse.json({ program: updated?.[0] });
    } catch (error) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
