import { exchange } from '@/lib/group-domains/service';
import { exchangeRequest } from '@/lib/group-domains/protocol';
import { readConnectionJson } from '@/lib/group-domains/request';
import { handleError } from '@/lib/utils/response';
export async function POST(req: Request) {
  try {
    const input = exchangeRequest.parse(await readConnectionJson(req));
    return Response.json(await exchange(input.hostname, input.code, input.code_verifier), {
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    });
  } catch (e) {
    return handleError(e);
  }
}
