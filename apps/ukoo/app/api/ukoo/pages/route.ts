import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_UKOO_SUPABASE_URL!,
  process.env.UKOO_SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

interface SaveRevisionRequest {
  pageId: string;
  baseRevId?: string;
  content: Record<string, unknown>;
  summary: string;
  createdBy: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: SaveRevisionRequest = await req.json();

    // Call save_revision RPC
    const { data, error } = await supabase.rpc('save_revision', {
      p_page_id: body.pageId,
      p_base_rev_id: body.baseRevId || null,
      p_content: body.content,
      p_summary: body.summary,
      p_created_by: body.createdBy,
    });

    if (error) {
      console.error('RPC error:', error);

      // Check if it's a stale_base error
      if (data?.error === 'stale_base') {
        return NextResponse.json(
          {
            error: 'stale_base',
            baseRevId: data.base_rev_id,
            currentRevId: data.current_rev_id,
            baseContent: data.base_content,
            currentContent: data.current_content,
            yourContent: data.your_content,
          },
          { status: 409 } // Conflict
        );
      }

      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (data?.error === 'stale_base') {
      return NextResponse.json(data, { status: 409 });
    }

    return NextResponse.json({ revision: data }, { status: 201 });
  } catch (err) {
    console.error('Failed to save revision:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const pageId = req.nextUrl.searchParams.get('page_id');

    if (!pageId) {
      return NextResponse.json({ error: 'page_id required' }, { status: 400 });
    }

    // Fetch page + latest revision
    const { data: page, error: pageError } = await supabase
      .from('page')
      .select('*, page_revision(*)')
      .eq('id', pageId)
      .order('created_at', { ascending: false, foreignTable: 'page_revision' })
      .single();

    if (pageError || !page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    return NextResponse.json({ page });
  } catch (err) {
    console.error('Failed to fetch page:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
