import { NextRequest, NextResponse } from 'next/server';
import {
  finishEnterpriseOidc,
  handoffCookie,
  oidcCookieOptions,
  oidcOrigin,
  transactionCookie,
} from '@/lib/enterprise-integration/oidc';
import { errorResponse } from '@/lib/utils/response';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const origin = oidcOrigin();
    const destination = new URL('/enterprise/login', origin);
    let handoff: string | undefined;
    try {
      const id = request.cookies.get(transactionCookie)?.value;
      const state = request.nextUrl.searchParams.get('state');
      const code = request.nextUrl.searchParams.get('code');
      if (
        request.nextUrl.origin !== origin ||
        !id?.match(/^[A-Za-z0-9_-]{43}$/) ||
        !state ||
        state.length > 100 ||
        !code ||
        code.length > 8192
      )
        throw new Error('Invalid callback.');
      handoff = await finishEnterpriseOidc(id, state, code);
    } catch {
      // OAuth response parameters and credentials must stay out of logs.
    }
    destination.searchParams.set('oidc', handoff ? 'ready' : 'failed');
    const response = NextResponse.redirect(destination, {
      status: 302,
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
    response.cookies.set(transactionCookie, '', { ...oidcCookieOptions, maxAge: 0 });
    response.cookies.set(handoffCookie, handoff ?? '', { ...oidcCookieOptions, maxAge: handoff ? 180 : 0 });
    return response;
  } catch {
    return errorResponse('Enterprise sign-in is unavailable.', 'OIDC_UNAVAILABLE', 503);
  }
}
