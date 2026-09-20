import { NextRequest, NextResponse } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPlatformRole(req, ['super_admin'], async (ctx) => {
    try {
      const { id } = await params;
      const body = await req.json();
      const { reason } = body;

      if (!reason || typeof reason !== 'string') {
        return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 });
      }

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

      // Reject program
      const { data: updated, error: updateError } = await supabase
        .from('programs')
        .update({
          status: 'rejected',
          rejection_reason: reason,
          reviewed_by: ctx.userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select();

      if (updateError) {
        return NextResponse.json({ error: 'Failed to reject program' }, { status: 500 });
      }

      // Log audit entry
      await supabase.from('audit_logs').insert({
        organization_id: program.organization_id,
        action: 'program_rejected',
        actor_id: ctx.userId,
        entity_type: 'program',
        entity_id: id,
        changes: { status: { from: 'pending_review', to: 'rejected' }, reason },
      });

      return NextResponse.json({ program: updated?.[0] });
    } catch (error) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
