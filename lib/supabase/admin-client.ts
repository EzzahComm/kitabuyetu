/**
 * Shared service-role Supabase client singleton, extracted from
 * storage.ts (Phase 5's report-export storage) when resume-storage.ts
 * (Phase 12) needed the exact same client for a different bucket — same
 * env vars, same lazy/optional-config behavior, same "return null rather
 * than throw" contract. Every bucket-specific module builds its own
 * typed error class and upload/signed-URL functions on top of this.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

let client: SupabaseClient | null | undefined;

/**
 * Lazily built singleton. Returns null (rather than throwing) when Storage
 * isn't configured for this environment — NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are both optional in lib/env.ts (core auth/DB
 * uses raw pg, not Supabase Auth), so a dev box without them can still run
 * everything except Storage-backed features. Callers surface that as a
 * clear, feature-specific error rather than a null-pointer crash.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    logger.warn('[supabase/admin-client] NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — Storage-backed features are unavailable');
    client = null;
    return client;
  }

  client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
