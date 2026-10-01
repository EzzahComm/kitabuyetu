import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_UKOO_SUPABASE_URL!,
  process.env.UKOO_SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const personId = params.id;

    const { data: person, error } = await supabase
      .from('person')
      .select('*')
      .eq('id', personId)
      .single();

    if (error || !person) {
      return NextResponse.json({ error: 'Person not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: person.id,
      displayName: person.display_name,
      sex: person.sex,
      birthFuzzy: person.birth_fuzzy,
      deathFuzzy: person.death_fuzzy,
      privacy: person.privacy,
    });
  } catch (err) {
    console.error('Failed to fetch person:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
