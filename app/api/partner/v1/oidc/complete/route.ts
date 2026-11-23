import { NextRequest, NextResponse } from 'next/server';
import {
  consumeEnterpriseOidcHandoff,
  handoffCookie,
  oidcCookieOptions,
  oidcOrigin,
} from '@/lib/enterprise-integration/oidc';
import { errorResponse, handleError, ok } from '@/lib/utils/response';

export async function POST(request: NextRequest): Promise<Response> {
  let response: NextResponse;
  try {
    if (request.headers.get('origin') !== oidcOrigin()) {
      return errorResponse('Invalid sign-in origin.', 'OIDC_ORIGIN', 403);
    }
    const id = request.cookies.get(handoffCookie)?.value;
    response = id?.match(/^[A-Za-z0-9_-]{43}$/)
      ? ok(await consumeEnterpriseOidcHandoff(id))
      : errorResponse('Enterprise sign-in has expired. Start again.', 'OIDC_EXPIRED', 401);
  } catch (error) {
    response = handleError(error);
  }
  response.cookies.set(handoffCookie, '', { ...oidcCookieOptions, maxAge: 0 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
