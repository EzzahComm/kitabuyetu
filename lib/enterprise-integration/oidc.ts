import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod/v3';
import { withAdminDb } from '@/lib/db';
import { signMfaChallenge } from '@/lib/auth/jwt';
import { redis } from '@/lib/redis';
import { AppError } from '@/lib/utils/errors';

const https = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  });
const connectionSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]{1,50}$/),
  organizationId: z.string().uuid(),
  issuer: https,
  authorizationUrl: https,
  tokenUrl: https,
  jwksUrl: https,
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  members: z.record(z.string().uuid()),
});
const connectionsSchema = z
  .array(connectionSchema)
  .max(30)
  .refine((connections) => new Set(connections.map((connection) => connection.name)).size === connections.length);
const sessionSchema = z.object({ connection: z.string(), nonce: z.string(), verifier: z.string(), state: z.string() });
const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export const transactionCookie = '__Host-ky-oidc-transaction';
export const handoffCookie = '__Host-ky-oidc-handoff';
export const oidcCookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;
const prefix = (suffix: string) => `${process.env.REDIS_PREFIX ?? 'ky:'}enterprise-oidc:${suffix}`;

function randomValue(): string {
  return randomBytes(32).toString('base64url');
}

function connection(name: string) {
  let entries: z.infer<typeof connectionsSchema> = [];
  try {
    entries = connectionsSchema.parse(JSON.parse(process.env.ENTERPRISE_OIDC_CONNECTIONS ?? '[]'));
  } catch {
    throw new AppError('Enterprise sign-in configuration is unavailable.', 'OIDC_UNAVAILABLE', 503);
  }
  const entry = entries.find((item) => item.name === name);
  if (!entry) throw new AppError('Enterprise sign-in connection was not found.', 'OIDC_UNAVAILABLE', 404);
  return entry;
}

export function oidcOrigin(): string {
  const url = new URL(process.env.NEXT_PUBLIC_APP_URL ?? '');
  if (url.protocol !== 'https:') throw new Error('Enterprise sign-in requires a canonical HTTPS origin.');
  return url.origin;
}

const callback = () => `${oidcOrigin()}/api/partner/v1/oidc/callback`;

export async function startEnterpriseOidc(name: string) {
  const selected = connection(name);
  const id = randomValue();
  const transaction = { connection: name, nonce: randomValue(), verifier: randomValue(), state: randomValue() };
  await redis.set(prefix('transaction:' + id), transaction, { ex: 300 });
  const destination = new URL(selected.authorizationUrl);
  for (const [key, value] of Object.entries({
    client_id: selected.clientId,
    redirect_uri: callback(),
    response_type: 'code',
    scope: 'openid',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(transaction.verifier).digest('base64url'),
    nonce: transaction.nonce,
    state: transaction.state,
  }))
    destination.searchParams.set(key, value);
  return { destination, id };
}

export async function finishEnterpriseOidc(id: string, state: string, code: string): Promise<string> {
  const transaction = sessionSchema.parse(await redis.getdel(prefix('transaction:' + id)));
  if (
    state.length !== transaction.state.length ||
    Buffer.byteLength(state) !== Buffer.byteLength(transaction.state) ||
    !timingSafeEqual(Buffer.from(state), Buffer.from(transaction.state))
  )
    throw new Error('Invalid OIDC state.');
  const selected = connection(transaction.connection);
  const result = await fetch(selected.tokenUrl, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callback(),
      client_id: selected.clientId,
      client_secret: selected.clientSecret,
      code_verifier: transaction.verifier,
    }),
  });
  if (!result.ok) throw new Error('OIDC code exchange failed.');
  const token = z.object({ id_token: z.string().max(8192) }).parse(await result.json()).id_token;
  let keys = jwksByUrl.get(selected.jwksUrl);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(selected.jwksUrl), { timeoutDuration: 3000 });
    jwksByUrl.set(selected.jwksUrl, keys);
  }
  const { payload } = await jwtVerify(token, keys, {
    issuer: selected.issuer,
    audience: selected.clientId,
    algorithms: ['RS256', 'ES256'],
    requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub', 'nonce'],
    maxTokenAge: '5 minutes',
    clockTolerance: 5,
  });
  if (
    payload.nonce !== transaction.nonce ||
    payload.aud !== selected.clientId ||
    (payload.azp !== undefined && payload.azp !== selected.clientId) ||
    !payload.sub ||
    !Object.hasOwn(selected.members, payload.sub)
  )
    throw new Error('Unrecognized OIDC identity.');
  const memberId = selected.members[payload.sub];
  const eligible = await withAdminDb(async (db) => {
    const { rows } = await db.query(
      `SELECT 1 FROM members m
       JOIN organization_members om ON om.member_id = m.id
       JOIN organizations o ON o.id = om.organization_id
       JOIN member_mfa_secrets mfa ON mfa.member_id = m.id
       WHERE m.id = $1 AND om.organization_id = $2 AND m.is_active AND o.is_active
         AND m.platform_role = 'organization_coordinator' AND om.status = 'active'`,
      [memberId, selected.organizationId],
    );
    return rows.length > 0;
  });
  if (!eligible) throw new Error('OIDC account is unavailable.');
  const handoff = randomValue();
  const challenge = signMfaChallenge({ sub: memberId, kind: 'verify', lockedOrganizationId: selected.organizationId });
  await redis.set(prefix('handoff:' + handoff), challenge, { ex: 180 });
  return handoff;
}

export async function consumeEnterpriseOidcHandoff(id: string) {
  const challenge = await redis.getdel<string>(prefix('handoff:' + id));
  if (!challenge) throw new AppError('Enterprise sign-in has expired. Start again.', 'OIDC_EXPIRED', 401);
  return { challenge };
}
