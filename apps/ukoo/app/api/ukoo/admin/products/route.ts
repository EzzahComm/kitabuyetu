import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_UKOO_SUPABASE_URL!,
  process.env.UKOO_SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ products: data || [] });
  } catch (err) {
    console.error('Failed to fetch products:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code, name, description, active } = body;

    const { data, error } = await supabase
      .from('products')
      .insert([{ code, name, description, active }])
      .select();

    if (error) throw error;

    return NextResponse.json({ product: data?.[0] }, { status: 201 });
  } catch (err) {
    console.error('Failed to create product:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
