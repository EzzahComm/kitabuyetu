'use client';

import type { ApiResponse } from '@/types/api.types';

const BASE = '/api/v1';

let _getToken: (() => string | null) | null = null;
let _onUnauthorized: (() => void) | null = null;

export function configureApiClient(opts: {
  getToken:      () => string | null;
  onUnauthorized: () => void;
}) {
  _getToken       = opts.getToken;
  _onUnauthorized = opts.onUnauthorized;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: { multipart?: boolean },
): Promise<T> {
  const headers: Record<string, string> = {};

  const token = _getToken?.();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  if (!options?.multipart && body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: options?.multipart
      ? (body as FormData)
      : body !== undefined
        ? JSON.stringify(body)
        : undefined,
  });

  if (res.status === 401) {
    _onUnauthorized?.();
    throw new Error('Session expired. Please log in again.');
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

export const api = {
  get:    <T>(path: string)                           => request<T>('GET',    path),
  post:   <T>(path: string, body: unknown)            => request<T>('POST',   path, body),
  patch:  <T>(path: string, body: unknown)            => request<T>('PATCH',  path, body),
  put:    <T>(path: string, body: unknown)            => request<T>('PUT',    path, body),
  delete: <T>(path: string)                           => request<T>('DELETE', path),
  upload: <T>(path: string, formData: FormData)       => request<T>('POST',   path, formData, { multipart: true }),
};
