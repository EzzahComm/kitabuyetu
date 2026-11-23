import { z } from 'zod';

export const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/,
    'Enter the full public hostname without a protocol, port or path.',
  )
  .refine((host) => !/\.(?:local|localhost|internal|test|invalid|example|onion)$/.test(host), 'Enter a public domain.');
export const scopeSchema = z.enum(['identity', 'group.read', 'meetings.write']);
export type DomainScope = z.infer<typeof scopeSchema>;
const tokenCharacters = /^[A-Za-z0-9_-]+$/;
export const grantRequest = z
  .object({
    hostname: hostnameSchema,
    state: z.string().min(22).max(128).regex(tokenCharacters),
    code_challenge: z.string().length(43).regex(tokenCharacters),
    code_challenge_method: z.literal('S256'),
    scope: scopeSchema.default('identity'),
  })
  .strict();
export const exchangeRequest = z
  .object({
    hostname: hostnameSchema,
    code: z.string().length(43).regex(tokenCharacters),
    code_verifier: z
      .string()
      .min(43)
      .max(128)
      .regex(/^[A-Za-z0-9._~-]+$/),
  })
  .strict();
export const callbackFor = (hostname: string) => 'https://' + hostname + '/kitabuyetu/callback';

const readPaths = new Set([
  '/api/v1/billing/entitlements',
  '/api/v1/meetings',
  '/api/v1/contributions',
  '/api/v1/reports',
  '/api/v1/campaigns',
  '/api/v1/sms/credits',
]);
export function domainScopeFor(method: string, path: string): DomainScope | null {
  if (method === 'GET' && path === '/api/v1/auth/domain-identity') return 'identity';
  if (method === 'GET' && readPaths.has(path)) return 'group.read';
  if (method === 'POST' && path === '/api/v1/meetings') return 'meetings.write';
  return null;
}
export function permits(granted: DomainScope, needed: DomainScope) {
  return granted === needed || needed === 'identity' || (granted === 'meetings.write' && needed === 'group.read');
}
export const isDomainToken = (value: string) => /^kyd_[A-Za-z0-9_-]{43}$/.test(value);

// Limit the native login continuation to a local connect page and parse its parameters again there.
export function connectionReturn(value: string | null): string | null {
  if (!value || value.length > 1000 || !/^\/connect\/[a-z0-9.-]+(?:\?[^#\\]*)?$/.test(value)) return null;
  const url = new URL(value, 'https://kitabu.invalid');
  if (!hostnameSchema.safeParse(url.pathname.slice('/connect/'.length)).success) return null;
  return url.pathname + url.search;
}
