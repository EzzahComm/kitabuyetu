import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_UKOO_SUPABASE_URL!,
  process.env.UKOO_SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const productId = req.nextUrl.searchParams.get('product_id');

    let query = supabase
      .from('plans')
      .select('*, products(name)');

    if (productId) {
      query = query.eq('product_id', productId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ plans: data || [] });
  } catch (err) {
    console.error('Failed to fetch plans:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { product_id, code, name, monthly_price_kes, annual_price_kes, description, active } = body;

    const { data, error } = await supabase
      .from('plans')
      .insert([
        {
          product_id,
          code,
          name,
          monthly_price_kes,
          annual_price_kes,
          description,
          active,
        },
      ])
      .select();

    if (error) throw error;

    return NextResponse.json({ plan: data?.[0] }, { status: 201 });
  } catch (err) {
    console.error('Failed to create plan:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
