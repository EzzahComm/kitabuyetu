/**
 * Sign-up request parsing + registration-certificate validation
 * (lib/utils/signup-request.ts). The properties that matter:
 *
 *  - A certificate is accepted only if it is genuinely a PDF (by file signature,
 *    not by the browser-declared type) and fits under Vercel's 4.5 MB body limit.
 *  - A bad attachment is REPORTED, never thrown: it must not block sign-up.
 *  - The ordinary JSON sign-up still parses exactly as before.
 */
import { NextRequest } from 'next/server';
import { certificateOutcome, checkCertificate, readSignupBody } from '@/lib/utils/signup-request';
import { MAX_CERTIFICATE_BYTES } from '@/lib/utils/certificate-limits';

/** A file of exactly `size` BYTES that starts with the PDF signature. */
function pdfFile(size = 2048, name = 'certificate.pdf', type = 'application/pdf'): File {
  const head = Buffer.from('%PDF-1.7\n', 'latin1');
  const body = Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 0x78)]);
  return new File([body], name, { type });
}

function signupRequest(init: { json?: unknown; multipart?: Record<string, string | File> }): NextRequest {
  if (init.multipart) {
    const form = new FormData();
    for (const [key, value] of Object.entries(init.multipart)) form.append(key, value);
    return new NextRequest('http://localhost/api/v1/auth/register', { method: 'POST', body: form });
  }
  return new NextRequest('http://localhost/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(init.json),
  });
}

describe('checkCertificate', () => {
  it('accepts a real PDF', async () => {
    const result = await checkCertificate(pdfFile());
    expect(result.rejected).toBeUndefined();
    expect(result.certificate?.contentType).toBe('application/pdf');
    expect(result.certificate?.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('treats no file, or an empty one, as "nothing attached" rather than a rejection', async () => {
    expect(await checkCertificate(null)).toEqual({});
    expect(await checkCertificate(undefined)).toEqual({});
    expect(await checkCertificate(new File([], 'empty.pdf', { type: 'application/pdf' }))).toEqual({});
  });

  it('rejects a file over the size limit and says why', async () => {
    const result = await checkCertificate(pdfFile(MAX_CERTIFICATE_BYTES + 1));
    expect(result.certificate).toBeUndefined();
    expect(result.rejected).toMatch(/limit is 4 MB/);
  });

  it('accepts a file exactly at the limit', async () => {
    const result = await checkCertificate(pdfFile(MAX_CERTIFICATE_BYTES));
    expect(result.rejected).toBeUndefined();
    expect(result.certificate).toBeDefined();
  });

  it('rejects a non-PDF declared as application/pdf - the signature is what counts', async () => {
    const disguised = new File(['<html>not a pdf</html>'], 'certificate.pdf', { type: 'application/pdf' });
    const result = await checkCertificate(disguised);
    expect(result.certificate).toBeUndefined();
    expect(result.rejected).toBe('The certificate must be a PDF.');
  });

  it('rejects a real PDF that is declared as something else', async () => {
    const result = await checkCertificate(pdfFile(2048, 'certificate.png', 'image/png'));
    expect(result.certificate).toBeUndefined();
    expect(result.rejected).toBe('The certificate must be a PDF.');
  });
});

describe('readSignupBody', () => {
  const body = { groupName: 'Umoja Chama', isGovernmentRegistered: true, registrationNumber: 'CBO/1/2026' };

  it('reads a plain JSON sign-up exactly as before, with no certificate', async () => {
    const parsed = await readSignupBody(signupRequest({ json: body }));
    expect(parsed.body).toEqual(body);
    expect(parsed.certificateFile).toBeNull();
  });

  it('reads a multipart sign-up: JSON under `payload`, the PDF under `certificate`', async () => {
    const parsed = await readSignupBody(
      signupRequest({ multipart: { payload: JSON.stringify(body), certificate: pdfFile() } }),
    );
    expect(parsed.body).toEqual(body);
    expect(parsed.certificateFile).not.toBeNull();
    expect(parsed.certificateFile?.size).toBeGreaterThan(0);
  });

  it('reads a multipart sign-up that carries no file', async () => {
    const parsed = await readSignupBody(signupRequest({ multipart: { payload: JSON.stringify(body) } }));
    expect(parsed.body).toEqual(body);
    expect(parsed.certificateFile).toBeNull();
  });

  it('rejects multipart with no payload', async () => {
    await expect(readSignupBody(signupRequest({ multipart: { certificate: pdfFile() } }))).rejects.toThrow(
      /Missing sign-up details/,
    );
  });

  it('rejects multipart whose payload is not JSON', async () => {
    await expect(readSignupBody(signupRequest({ multipart: { payload: '{not json' } }))).rejects.toThrow(
      /not valid JSON/,
    );
  });
});

describe('certificateOutcome', () => {
  it('says nothing when no certificate was attached, so the ordinary response is unchanged', () => {
    expect(certificateOutcome(false, undefined, false)).toEqual({});
  });

  it('reports a saved certificate', () => {
    expect(certificateOutcome(true, undefined, true)).toEqual({ certificateUploaded: true });
  });

  it('reports a rejected certificate with the reason', () => {
    expect(certificateOutcome(true, 'The certificate must be a PDF.', false)).toEqual({
      certificateUploaded: false,
      certificateNote: 'The certificate must be a PDF.',
    });
  });

  it('reports a storage failure with a generic note', () => {
    expect(certificateOutcome(true, undefined, false)).toEqual({
      certificateUploaded: false,
      certificateNote: 'We could not save the certificate right now.',
    });
  });
});
