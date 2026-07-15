'use client';

import type { ApiResponse } from '@/types/api.types';

const BASE        = '/api/v1';
const STORAGE_KEY = 'ky_auth';  // mirrors lib/auth/context.tsx

// Read the access token directly from localStorage on every request. This
// avoids a closure/timing race we used to have where pages would call
// `configureApiClient({ getToken: () => accessToken })` inside a useEffect —
// React runs child effects BEFORE parent effects, so the first API call from
// a dashboard child fired with the stale `getToken` from the previous (login)
// page and shipped no Authorization header → 401 → bounce back to /login.
//
// Reading from localStorage on each call keeps the api client decoupled from
// React rendering order. localStorage is updated synchronously by the auth
// context before router.push, so the dashboard's first request sees the new
// token.
function readAccessTokenFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { accessToken?: string | null };
    return parsed.accessToken ?? null;
  } catch {
    return null;
  }
}

/**
 * The current session's access token, for callers that build their own fetch
 * (e.g. the admin portal's adminFetch). Same source of truth as this client.
 */
export function getStoredAccessToken(): string | null {
  return readAccessTokenFromStorage();
}

let _onUnauthorized: (() => void) | null = null;

// Backwards-compatible signature: still accepts the old `getToken` field but
// silently ignores it (the api client now reads localStorage). Pages can drop
// the `getToken` arg in a follow-up cleanup without breaking anything.
export function configureApiClient(opts: {
  getToken?:      () => string | null;
  onUnauthorized: () => void;
}) {
  _onUnauthorized = opts.onUnauthorized;
}

function buildHeaders(body: unknown, multipart = false): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = readAccessTokenFromStorage();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!multipart && body) headers['Content-Type'] = 'application/json';
  return headers;
}

function buildRequestBody(body: unknown, multipart = false): BodyInit | undefined {
  if (multipart) return body as FormData;
  return body !== undefined ? JSON.stringify(body) : undefined;
}

/**
 * A 401 means different things depending on whether the request was
 * authenticated:
 *
 *  - We SENT a token → it was rejected → the session really is gone. Fire
 *    onUnauthorized (bounce to login) and show the session-expired message.
 *  - We sent NO token (login / register / refresh / MFA verify) → this is a
 *    credential or challenge error, not an expired session. Surface the
 *    server's real message ("Invalid email or password", "Sign-in session
 *    expired. Start again.", …) instead of the misleading generic one.
 */
async function handle401(res: Response, hadToken: boolean): Promise<never> {
  let serverError: { error?: string; code?: string } | null = null;
  try {
    serverError = await res.json() as { error?: string; code?: string };
  } catch { /* non-JSON body */ }

  if (hadToken) {
    _onUnauthorized?.();
    throw new ApiError(
      serverError?.error ?? 'Session expired. Please log in again.',
      serverError?.code  ?? 'SESSION_EXPIRED',
      401,
    );
  }

  throw new ApiError(
    serverError?.error ?? 'Authentication failed',
    serverError?.code  ?? 'UNAUTHORIZED',
    401,
  );
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: { multipart?: boolean; headers?: Record<string, string> },
): Promise<T> {
  const headers = { ...buildHeaders(body, options?.multipart), ...options?.headers };
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: buildRequestBody(body, options?.multipart),
  });

  if (res.status === 401) {
    return handle401(res, Boolean(headers['Authorization']));
  }

  const json = await res.json() as ApiResponse<T>;

  if (!json.success) {
    throw new ApiError(json.error, json.code, res.status);
  }

  return (json as { success: true; data: T }).data;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Fetches a binary endpoint (e.g. a PDF) with the Bearer header and opens the
 * resulting blob in a new tab. Plain <a href> links can't be used for API
 * routes because the middleware requires an Authorization header, which anchor
 * navigations don't send.
 */
async function openBlob(path: string): Promise<void> {
  const headers = buildHeaders(undefined);
  const res = await fetch(`${BASE}${path}`, { headers });
  if (res.status === 401) {
    await handle401(res, Boolean(headers['Authorization']));
  }
  if (!res.ok) {
    // Binary endpoints still return JSON errors via handleError.
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json() as { error?: string };
      if (j.error) msg = j.error;
    } catch { /* non-JSON body */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  // Revoke after a tick so the new tab has time to load the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const api = {
  get:    <T>(path: string)                           => request<T>('GET',    path),
  post:   <T>(path: string, body: unknown, opts?: { headers?: Record<string, string> }) =>
                                                          request<T>('POST',   path, body, opts),
  patch:  <T>(path: string, body: unknown)            => request<T>('PATCH',  path, body),
  put:    <T>(path: string, body: unknown)            => request<T>('PUT',    path, body),
  delete: <T>(path: string)                           => request<T>('DELETE', path),
  upload: <T>(path: string, formData: FormData)       => request<T>('POST',   path, formData, { multipart: true }),
  openBlob,
};
