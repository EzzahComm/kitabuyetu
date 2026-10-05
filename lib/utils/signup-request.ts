/**
 * Sign-up request parsing shared by /auth/register and /auth/create-group.
 *
 * The body is JSON. The one exception is a registrant who attaches their
 * registration certificate: that request is multipart/form-data carrying the
 * same JSON in a `payload` field and the PDF in a `certificate` field.
 *
 * The PDF rides along with the sign-up request instead of being a follow-up
 * call because a brand-new group cannot call any other tenant route yet: the
 * proxy answers 403 PENDING_VERIFICATION to everything but the verification
 * endpoints, and once verified the subscription gate answers 402 to everything
 * but the pay-from-locked paths until the group has paid.
 */
import type { NextRequest } from 'next/server';
import { ValidationError } from '@/lib/utils/errors';
import { CERTIFICATE_LIMIT_MB, MAX_CERTIFICATE_BYTES } from '@/lib/utils/certificate-limits';

export interface CertificateUpload {
  buffer: Buffer;
  contentType: 'application/pdf';
}

export interface CertificateCheck {
  certificate?: CertificateUpload;
  /** Why the file was not accepted — safe to show the registrant. Absent when no file was attached. */
  rejected?: string;
}

/**
 * Validate an attached certificate. Never throws: a bad attachment must not
 * block sign-up (registration data is optional and can be supplied later), so
 * the caller carries on without it and reports `rejected` back.
 */
export async function checkCertificate(file: File | null | undefined): Promise<CertificateCheck> {
  if (!file || file.size === 0) return {};
  if (file.size > MAX_CERTIFICATE_BYTES) {
    return {
      rejected: `The certificate is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${CERTIFICATE_LIMIT_MB} MB.`,
    };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  // The browser-declared type is a hint; the file signature is what proves it is a PDF.
  if (file.type !== 'application/pdf' || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return { rejected: 'The certificate must be a PDF.' };
  }
  return { certificate: { buffer, contentType: 'application/pdf' } };
}

/**
 * What to tell the client about an attached certificate. Nothing at all when
 * none was attached, so the common response stays exactly what it was.
 */
export function certificateOutcome(
  attached: boolean,
  rejected: string | undefined,
  stored: boolean,
): { certificateUploaded?: boolean; certificateNote?: string } {
  if (!attached) return {};
  if (stored) return { certificateUploaded: true };
  return { certificateUploaded: false, certificateNote: rejected ?? 'We could not save the certificate right now.' };
}

function isFile(value: unknown): value is File {
  return typeof value === 'object' && value !== null && typeof (value as File).arrayBuffer === 'function';
}

/** Read a sign-up body: plain JSON, or multipart with the JSON under `payload` and the PDF under `certificate`. */
export async function readSignupBody(req: NextRequest): Promise<{ body: unknown; certificateFile: File | null }> {
  const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('multipart/form-data')) {
    return { body: await req.json(), certificateFile: null };
  }

  const form = await req.formData();
  const payload = form.get('payload');
  if (typeof payload !== 'string') throw new ValidationError('Missing sign-up details');

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    throw new ValidationError('Sign-up details are not valid JSON');
  }
  const file = form.get('certificate');
  return { body, certificateFile: isFile(file) ? file : null };
}
