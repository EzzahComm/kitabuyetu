import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { domainSettings, registerDomain, verifyDomain, disconnectDomain } from '@/lib/group-domains/service';
import { hostnameSchema } from '@/lib/group-domains/protocol';
import { readConnectionJson } from '@/lib/group-domains/request';
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register'), hostname: hostnameSchema }).strict(),
  z.object({ action: z.literal('verify'), hostname: hostnameSchema }).strict(),
  z.object({ action: z.literal('disconnect'), id: z.string().uuid() }).strict(),
]);
export function GET(req: NextRequest) {
  return withAuth(req, async (auth) => ok(await domainSettings(auth)));
}
export function POST(req: NextRequest) {
  return withAuth(req, async (auth) => {
    const input = command.parse(await readConnectionJson(req));
    if (input.action === 'register') return ok(await registerDomain(auth, input.hostname));
    if (input.action === 'verify') return ok(await verifyDomain(auth, input.hostname));
    await disconnectDomain(auth, input.id);
    return ok(null);
  });
}
