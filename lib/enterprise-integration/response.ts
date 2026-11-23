import { handleError, ok } from '@/lib/utils/response';

export async function enterpriseResponse(load: () => Promise<unknown>): Promise<Response> {
  let response: Response;
  try {
    response = ok(await load());
  } catch (error) {
    response = handleError(error);
    if (response.status === 429) response.headers.set('Retry-After', '60');
    if (response.status === 401) response.headers.set('WWW-Authenticate', 'Bearer');
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
