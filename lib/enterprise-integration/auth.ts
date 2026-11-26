import { createHash } from 'node:crypto';
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { redis } from '@/lib/redis';
import { AppError } from '@/lib/utils/errors';
import { getEnterpriseIntegrations, type EnterpriseIntegrationClient, type EnterpriseScope } from './config';

const keySets = new Map<string, JWTVerifyGetKey>();
function keySet(url: string): JWTVerifyGetKey {
  const cached = keySets.get(url);
  if (cached) return cached;
  const keys = createRemoteJWKSet(new URL(url), { timeoutDuration: 3000 });
  keySets.set(url, keys);
  return keys;
}

function unauthorized(): AppError {
  return new AppError('Invalid integration access token.', 'UNAUTHORIZED', 401);
}

export async function authenticateEnterpriseClient(
  request: Request,
  scope: EnterpriseScope,
): Promise<EnterpriseIntegrationClient> {
  const clients = getEnterpriseIntegrations().clients;
  if (!clients.length) throw new AppError('Enterprise integration is unavailable.', 'INTEGRATION_UNAVAILABLE', 503);
  const authorization = request.headers.get('authorization') ?? '';
  if (authorization.length > 8192 || !authorization.startsWith('Bearer ')) throw unauthorized();
  const token = authorization.slice(7);

  let client: EnterpriseIntegrationClient;
  let tokenScopes: string[];
  try {
    const claims = decodeJwt(token);
    const selected = clients.find(
      (entry) =>
        entry.issuer === claims.iss &&
        entry.audience === claims.aud &&
        entry.clientId === claims.client_id &&
        entry.subject === claims.sub,
    );
    if (!selected) throw unauthorized();

    const { payload } = await jwtVerify(token, keySet(selected.jwksUrl), {
      issuer: selected.issuer,
      audience: selected.audience,
      subject: selected.subject,
      typ: 'at+jwt',
      algorithms: ['RS256', 'ES256'],
      requiredClaims: ['exp', 'iat', 'sub', 'client_id', 'jti'],
      maxTokenAge: '15 minutes',
      clockTolerance: 5,
    });
    if (payload.client_id !== selected.clientId) throw unauthorized();
    tokenScopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
    client = selected;
  } catch {
    throw unauthorized();
  }

  if (!client.scopes.includes(scope) || !tokenScopes.includes(scope)) {
    throw new AppError('This integration lacks the required scope.', 'SCOPE_REQUIRED', 403);
  }

  const digest = createHash('sha256')
    .update(JSON.stringify([client.issuer, client.audience, client.clientId]))
    .digest('hex');
  const base = `${process.env.REDIS_PREFIX ?? 'ky:'}enterprise-integration:${scope}:`;
  let decision: [number, number];
  try {
    decision = await redis.eval<string[], [number, number]>(
      `local results = {}
       for i, key in ipairs(KEYS) do
         local count = redis.call('INCR', key)
         if count == 1 then redis.call('EXPIRE', key, 60) end
         results[i] = count
       end
       return results`,
      [base + 'org:' + client.organizationId, base + 'client:' + digest],
      [],
    );
  } catch {
    throw new AppError('Integration rate limiter is unavailable.', 'INTEGRATION_UNAVAILABLE', 503);
  }
  if (decision[0] > 120 || decision[1] > 30) {
    throw new AppError('Integration rate limit exceeded.', 'RATE_LIMITED', 429);
  }
  const { assertEnterpriseCoverage } = await import('@/lib/services/enterprise-billing.service');
  if (scope !== 'billing.read') await assertEnterpriseCoverage(client.organizationId);
  return client;
}
