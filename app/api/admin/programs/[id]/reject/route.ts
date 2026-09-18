import { NextRequest, NextResponse } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { db } from '@/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPlatformRole('super_admin', async ctx => {
    try {
      const { id } = await params;
      const body = await req.json();
      const { reason } = body;

      if (!reason || typeof reason !== 'string') {
        return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 });
      }

      // Verify program exists and is pending
      const program = await db
        .from('programs')
        .select('*')
        .eq('id', id)
        .eq('status', 'pending_review')
        .single();

      if (program.error || !program.data) {
        return NextResponse.json({ error: 'Program not found or not pending review' }, { status: 404 });
      }

      // Reject program
      const updated = await db
        .from('programs')
        .update({
          status: 'rejected',
          rejection_reason: reason,
          reviewed_by: ctx.user_id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select();

      if (updated.error) {
        return NextResponse.json({ error: 'Failed to reject program' }, { status: 500 });
      }

      // Log audit entry
      await db.from('audit_logs').insert({
        organization_id: program.data.organization_id,
        action: 'program_rejected',
        actor_id: ctx.user_id,
        entity_type: 'program',
        entity_id: id,
        changes: { status: { from: 'pending_review', to: 'rejected' }, reason },
      });

      return NextResponse.json({ program: updated.data?.[0] });
    } catch (error) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  })(req, {});
}
