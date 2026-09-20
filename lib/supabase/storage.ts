/**
 * Supabase Storage — service-role access to the private `reports` bucket
 * (migration 176). Used by report-export.service.ts's job handler to upload
 * a generated report artifact and to mint short-lived signed URLs for it.
 *
 * Deliberately NOT the SSR client in lib/supabase/server.ts: that wrapper is
 * cookie-based (`next/headers`), built for a request/Server-Component
 * context. The job handler that uploads reports runs from lib/jobs/
 * handlers.ts, invoked by /api/cron — there is no request or cookie jar
 * there. This is a plain `@supabase/supabase-js` client instead, exactly
 * the shape createAdminClient() uses (service-role key, bypasses RLS) minus
 * the cookie plumbing neither the job handler nor this route need.
 *
 * The client singleton itself now lives in admin-client.ts, shared with
 * resume-storage.ts (Phase 12) — same env vars, same bucket either module
 * might use, no reason for two singletons.
 */
import { getSupabaseAdminClient } from './admin-client';

/** Private bucket for generated organization report artifacts (migration 176). */
export const REPORTS_BUCKET = 'reports';

/** Signed URL TTL for the interactive status-check/download path. */
export const REPORT_SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Signed URL TTL for a link mailed out by a scheduled report (Phase 5 item
 * 4). Deliberately longer than the interactive default above: an emailed
 * link may sit unread in an inbox for hours, whereas the status-check route
 * mints a fresh one on every poll (see report-export.service.ts). Still
 * bounded — never "no expiry" — just sized for "opened later today" rather
 * than "opened in the next few minutes".
 */
export const REPORT_EMAIL_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24 hours

export class ReportStorageUnavailableError extends Error {
  constructor() {
    super('Report export storage is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)');
    this.name = 'ReportStorageUnavailableError';
  }
}

/** Upload one generated report artifact. Overwrites on retry (upsert). */
export async function uploadReportArtifact(path: string, body: Buffer, contentType: string): Promise<void> {
  const sb = getSupabaseAdminClient();
  if (!sb) throw new ReportStorageUnavailableError();

  const { error } = await sb.storage.from(REPORTS_BUCKET).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`[supabase/storage] upload failed: ${error.message}`);
}

/**
 * Mint a fresh signed URL. Never stored — generated on demand each time a
 * caller needs one, so it can never outlive the TTL passed here (Phase 5
 * item 3's explicit requirement).
 */
export async function createReportSignedUrl(
  path: string,
  ttlSeconds: number = REPORT_SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const sb = getSupabaseAdminClient();
  if (!sb) throw new ReportStorageUnavailableError();

  const { data, error } = await sb.storage.from(REPORTS_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`[supabase/storage] createSignedUrl failed: ${error?.message ?? 'no URL returned'}`);
  }
  return data.signedUrl;
}
