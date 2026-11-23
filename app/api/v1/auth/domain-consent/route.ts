import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { consent } from '@/lib/group-domains/service';
import { grantRequest, hostnameSchema } from '@/lib/group-domains/protocol';
import { readConnectionJson } from '@/lib/group-domains/request';
import { ok } from '@/lib/utils/response';
const request = z.union([grantRequest, z.object({ hostname: hostnameSchema }).strict()]);
export function POST(req: NextRequest) {
  return withAuth(req, async (auth) => {
    const input = request.parse(await readConnectionJson(req));
    const response = ok(await consent(auth, input.hostname, 'state' in input ? input : undefined));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  });
}
