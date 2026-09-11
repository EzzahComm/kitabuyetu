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
  /** RBAC permission activation — simulates the resolved x-permissions claim without a real login round trip. */
  permissions?: string[];
  /** Simulates the token's authVersion/sessionVersion epoch claims — only set when a test needs to exercise assertAuthFresh's live DB re-check (both omitted = no-op, matching legacy tokens). */
  authVersion?: number;
  sessionVersion?: number;
}

export function authHeaders(input: AuthHeaderInput): Record<string, string> {
  const headers: Record<string, string> = {
    'x-user-id': input.userId,
    'x-group-id': input.groupId,
    'x-role': input.role,
  };
  if (input.organizationId) headers['x-organization-id'] = input.organizationId;
  if (input.membershipId) headers['x-membership-id'] = input.membershipId;
  if (input.permissions?.length) headers['x-permissions'] = input.permissions.join(',');
  if (input.authVersion != null) headers['x-auth-version'] = String(input.authVersion);
  if (input.sessionVersion != null) headers['x-session-version'] = String(input.sessionVersion);
  return headers;
}

/**
 * Header set for a BACKOFFICE caller — what proxy.ts stamps from a verified
 * `aud: 'backoffice'` token. Used by the organization tree
 * (/api/admin/organization/*), whose coordinator holds a backoffice token
 * carrying an organization and no group at all; `getBackofficeContext` reads
 * exactly these.
 */
export function backofficeHeaders(input: {
  userId: string;
  platformRole: 'super_admin' | 'support' | 'organization_coordinator';
  organizationId?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'x-aud': 'backoffice',
    'x-user-id': input.userId,
    'x-platform-role': input.platformRole,
  };
  if (input.organizationId) headers['x-organization-id'] = input.organizationId;
  return headers;
}

export function buildRequest(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): NextRequest {
  const headers = new Headers(opts.headers);
  const init: RequestInit = { method: opts.method ?? 'GET', headers };
  if (opts.body !== undefined) {
    if (opts.body instanceof FormData) {
      // Pass through as-is — fetch/undici sets the correct multipart
      // boundary Content-Type itself; JSON.stringify would corrupt it.
      // Used by routes that call req.formData() (e.g. CSV import uploads).
      init.body = opts.body;
    } else {
      init.body = JSON.stringify(opts.body);
      headers.set('content-type', 'application/json');
    }
  }
  return new NextRequest(new URL(path, 'http://localhost'), init);
}
