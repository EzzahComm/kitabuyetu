import { NextRequest, NextResponse } from 'next/server';
import {
  oidcCookieOptions,
  oidcOrigin,
  transactionCookie,
  startEnterpriseOidc,
} from '@/lib/enterprise-integration/oidc';
import { handleError } from '@/lib/utils/response';
import { ValidationError } from '@/lib/utils/errors';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const name = request.nextUrl.searchParams.get('connection');
    if (!name?.match(/^[a-z0-9-]{1,50}$/)) throw new ValidationError('Choose an Enterprise sign-in connection.');
    const origin = oidcOrigin();
    if (request.nextUrl.origin !== origin) {
      const url = new URL('/api/partner/v1/oidc/start', origin);
      url.searchParams.set('connection', name);
      return NextResponse.redirect(url, 302);
    }
    const { destination, id } = await startEnterpriseOidc(name);
    const response = NextResponse.redirect(destination, { status: 302, headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(transactionCookie, id, { ...oidcCookieOptions, maxAge: 300 });
    return response;
  } catch (error) {
    return handleError(error);
  }
}
