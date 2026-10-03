/**
 * Supabase Storage - service-role access to the private `group-documents`
 * bucket (created by migration 074; it has no RLS policies, so only the
 * service role can touch it). Mirrors resume-storage.ts's pattern exactly:
 * upload on submission, mint a short-lived signed URL whenever an officer
 * actually views one. Never a public URL - a registration certificate can
 * carry officials' names/IDs.
 */
import { getSupabaseAdminClient } from './admin-client';

export const GROUP_DOCUMENTS_BUCKET = 'group-documents';

/** Signed URL TTL for an officer viewing a certificate from Settings. */
export const GROUP_DOCUMENT_SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

/** One certificate per group at a fixed path: uploading again replaces it. */
export function registrationCertificatePath(groupId: string): string {
  return `${groupId}/certificate.pdf`;
}

export class GroupDocumentStorageUnavailableError extends Error {
  constructor() {
    super('Group document storage is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)');
    this.name = 'GroupDocumentStorageUnavailableError';
  }
}

/** Upload (or replace) one group's registration certificate at the given path. */
export async function uploadGroupDocument(path: string, body: Buffer, contentType: string): Promise<void> {
  const sb = getSupabaseAdminClient();
  if (!sb) throw new GroupDocumentStorageUnavailableError();

  const { error } = await sb.storage.from(GROUP_DOCUMENTS_BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`[supabase/group-document-storage] upload failed: ${error.message}`);
}

/** Mint a fresh signed URL - never stored, generated on demand each time an officer opens a certificate. */
export async function createGroupDocumentSignedUrl(
  path: string,
  ttlSeconds: number = GROUP_DOCUMENT_SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const sb = getSupabaseAdminClient();
  if (!sb) throw new GroupDocumentStorageUnavailableError();

  const { data, error } = await sb.storage.from(GROUP_DOCUMENTS_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`[supabase/group-document-storage] createSignedUrl failed: ${error?.message ?? 'no URL returned'}`);
  }
  return data.signedUrl;
}
