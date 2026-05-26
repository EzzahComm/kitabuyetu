'use client';

/**
 * Download a server-side file (CSV, PDF, etc.) through the authenticated
 * /api/v1 surface.
 *
 * Why this exists: a plain `<a href="/api/v1/…" download>` looks like the
 * obvious solution but it 401s. The proxy enforces JWT on /api/v1/*, and
 * the JWT lives in localStorage — browsers do NOT include localStorage
 * values on navigation/download requests, so the request goes out without
 * any Authorization header.
 *
 * This helper does the fetch with the bearer header, then triggers a
 * download from the resulting Blob via createObjectURL. The server's
 * Content-Disposition filename wins; the fallback is used only when the
 * server doesn't send one.
 *
 * Use this for any authenticated download trigger (CSV exports, PDF
 * certificates, import templates).
 */

const STORAGE_KEY = 'ky_auth'; // mirrors lib/auth/context.tsx + lib/api/client.ts

function readAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as { accessToken?: string | null }).accessToken ?? null;
  } catch {
    return null;
  }
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  // Match `filename="..."` or `filename=...` (no quotes); RFC 5987's
  // `filename*=UTF-8''...` form is not handled because no current endpoint
  // emits it — add only when needed.
  const m = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return m?.[1] ?? null;
}

export interface DownloadOptions {
  /** Used when the server doesn't send a Content-Disposition filename. */
  fallbackFilename: string;
  /** Open the response in a new tab instead of triggering a download. */
  openInNewTab?: boolean;
}

/**
 * Fetch `url` with the user's JWT and either trigger a download (default)
 * or open it in a new tab.
 *
 * Throws on non-OK responses, surfacing the API's JSON `error` message
 * when available so callers can toast it.
 */
export async function downloadAuthenticated(
  url: string,
  options: DownloadOptions,
): Promise<void> {
  const token = readAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // Body wasn't JSON — keep the HTTP status as the error message.
    }
    throw new Error(detail);
  }

  const filename =
    filenameFromContentDisposition(res.headers.get('content-disposition'))
    ?? options.fallbackFilename;

  const blob      = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  if (options.openInNewTab) {
    window.open(objectUrl, '_blank', 'noopener,noreferrer');
    // Give the new tab a moment to load before revoking the URL.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return;
  }

  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
