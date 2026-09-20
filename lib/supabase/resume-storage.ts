/**
 * Supabase Storage — service-role access to the private `resumes` bucket
 * (migration 199). Mirrors storage.ts's report-artifact pattern exactly,
 * sharing the same client singleton (admin-client.ts) for a different
 * bucket: upload on submission, mint a short-lived signed URL whenever an
 * admin actually views one.
 */
import { getSupabaseAdminClient } from './admin-client';

export const RESUMES_BUCKET = 'resumes';

/** Signed URL TTL for an admin viewing a resume from the applications pipeline. */
export const RESUME_SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export class ResumeStorageUnavailableError extends Error {
  constructor() {
    super('Resume storage is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)');
    this.name = 'ResumeStorageUnavailableError';
  }
}

/** Upload one candidate's resume. Path should be unique per application (see careers.service.ts). */
export async function uploadResume(path: string, body: Buffer, contentType: string): Promise<void> {
  const sb = getSupabaseAdminClient();
  if (!sb) throw new ResumeStorageUnavailableError();

  const { error } = await sb.storage.from(RESUMES_BUCKET).upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(`[supabase/resume-storage] upload failed: ${error.message}`);
}

/** Mint a fresh signed URL — never stored, generated on demand each time an admin opens a resume. */
export async function createResumeSignedUrl(
  path: string,
  ttlSeconds: number = RESUME_SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const sb = getSupabaseAdminClient();
  if (!sb) throw new ResumeStorageUnavailableError();

  const { data, error } = await sb.storage.from(RESUMES_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`[supabase/resume-storage] createSignedUrl failed: ${error?.message ?? 'no URL returned'}`);
  }
  return data.signedUrl;
}
