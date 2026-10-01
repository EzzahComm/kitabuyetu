import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_UKOO_SUPABASE_URL;
const supabaseServiceKey = process.env.UKOO_SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_UKOO_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_UKOO_SUPABASE_URL is not set');
}

// Server-side client (with service role for RPC calls)
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    })
  : null;

// Client-side client (anon key, respects RLS)
export const supabaseClient =
  typeof window !== 'undefined' && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export function getSupabaseClient(useAdmin = false) {
  if (useAdmin) {
    if (!supabaseAdmin) {
      throw new Error('Admin client not initialized (missing service role key)');
    }
    return supabaseAdmin;
  }
  return supabaseClient;
}
