import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { db } from '@/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async ctx => {
    try {
      const { id } = await params;

      // Verify program exists and belongs to user's organization
      const program = await db
        .from('programs')
        .select('*')
        .eq('id', id)
        .eq('organization_id', ctx.organization_id)
        .eq('status', 'draft')
        .single();

      if (program.error || !program.data) {
        return NextResponse.json(
          { error: 'Program not found or not in draft status' },
          { status: 404 }
        );
      }

      // Submit for review
      const updated = await db
        .from('programs')
        .update({
          status: 'pending_review',
        })
        .eq('id', id)
        .select();

      if (updated.error) {
        return NextResponse.json({ error: 'Failed to submit for review' }, { status: 500 });
      }

      // Log audit entry
      await db.from('audit_logs').insert({
        organization_id: ctx.organization_id,
        action: 'program_submitted_for_review',
        actor_id: ctx.user_id,
        entity_type: 'program',
        entity_id: id,
        changes: { status: { from: 'draft', to: 'pending_review' } },
      });

      return NextResponse.json({ program: updated.data?.[0] });
    } catch (error) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  })(req, {});
}
