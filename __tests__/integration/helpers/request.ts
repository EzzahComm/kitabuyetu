import { NextRequest } from 'next/server';

/**
 * Header set matching exactly what proxy.ts stamps from a verified JWT
 * (lib/auth/middleware.ts's getAuthContext reads these directly, with no
 * signature verification at that layer) — for a backoffice/org-coordinator
 * caller, pass organizationId; x-auth-version/x-session-version are omitted
 * on purpose (membership-guard's assertAuthFresh no-ops when both are absent,
 * matching how legacy tokens behave).
 */
export interface AuthHeaderInput {
  userId: string;
  groupId: string;
  role: string;
  organizationId?: string;
  membershipId?: string;
}

export function authHeaders(input: AuthHeaderInput): Record<string, string> {
  const headers: Record<string, string> = {
    'x-user-id': input.userId,
    'x-group-id': input.groupId,
    'x-role': input.role,
  };
  if (input.organizationId) headers['x-organization-id'] = input.organizationId;
  if (input.membershipId) headers['x-membership-id'] = input.membershipId;
  return headers;
}

export function buildRequest(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): NextRequest {
  const headers = new Headers(opts.headers);
  const init: RequestInit = { method: opts.method ?? 'GET', headers };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    headers.set('content-type', 'application/json');
  }
  return new NextRequest(new URL(path, 'http://localhost'), init);
}
