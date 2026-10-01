import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_UKOO_SUPABASE_URL!,
  process.env.UKOO_SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

interface TreeNode {
  id: string;
  displayName: string;
  sex: 'male' | 'female' | 'other';
  born?: { year: number; precision: 'year' | 'month' | 'day' };
  died?: { year: number; precision: 'year' | 'month' | 'day' };
  privacy: string;
  relationshipLabel?: string;
}

interface TreeEdge {
  childId: string;
  parentId: string;
  kind: string;
}

export async function GET(req: NextRequest) {
  try {
    const focusId = req.nextUrl.searchParams.get('focus');
    const up = parseInt(req.nextUrl.searchParams.get('up') || '4', 10);
    const down = parseInt(req.nextUrl.searchParams.get('down') || '3', 10);
    const view = req.nextUrl.searchParams.get('view') || 'pedigree';

    if (!focusId) {
      return NextResponse.json({ error: 'focus parameter required' }, { status: 400 });
    }

    // Fetch focus person
    const { data: focusPerson, error: personError } = await supabase
      .from('person')
      .select('*')
      .eq('id', focusId)
      .single();

    if (personError || !focusPerson) {
      return NextResponse.json({ error: 'Person not found' }, { status: 404 });
    }

    // Fetch ancestors
    const { data: ancestors, error: ancestorsError } = await supabase
      .from('ancestry_closure')
      .select('ancestor_id, distance')
      .eq('descendant_id', focusId)
      .lte('distance', up);

    if (ancestorsError) throw ancestorsError;

    // Fetch descendants
    const { data: descendants, error: descendantsError } = await supabase
      .from('ancestry_closure')
      .select('descendant_id, distance')
      .eq('ancestor_id', focusId)
      .lte('distance', down);

    if (descendantsError) throw descendantsError;

    // Collect all person IDs
    const personIds = new Set<string>([focusId]);
    ancestors?.forEach(a => personIds.add(a.ancestor_id));
    descendants?.forEach(d => personIds.add(d.descendant_id));

    // Fetch all persons
    const { data: persons, error: personsError } = await supabase
      .from('person')
      .select('*')
      .in('id', Array.from(personIds));

    if (personsError) throw personsError;

    // Fetch parentage edges
    const { data: edges, error: edgesError } = await supabase
      .from('parentage')
      .select('child_id, parent_id, kind')
      .or(
        `child_id.in.(${Array.from(personIds).join(',')}),parent_id.in.(${Array.from(personIds).join(',')})`
      );

    if (edgesError) throw edgesError;

    // Build response
    const nodes: TreeNode[] = (persons || []).map(p => ({
      id: p.id,
      displayName: p.display_name,
      sex: p.sex,
      born: p.birth_fuzzy ? { year: p.birth_fuzzy.year, precision: p.birth_fuzzy.precision } : undefined,
      died: p.death_fuzzy ? { year: p.death_fuzzy.year, precision: p.death_fuzzy.precision } : undefined,
      privacy: p.privacy,
    }));

    const treeEdges: TreeEdge[] = (edges || []).map(e => ({
      childId: e.child_id,
      parentId: e.parent_id,
      kind: e.kind,
    }));

    return NextResponse.json({
      focus: focusPerson.id,
      nodes,
      edges: treeEdges,
      view,
    });
  } catch (err) {
    console.error('Tree fetch error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
