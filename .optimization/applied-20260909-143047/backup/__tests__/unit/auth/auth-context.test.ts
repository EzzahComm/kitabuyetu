import { NextRequest } from 'next/server';
import { getAuthContext, getBackofficeContext } from '@/lib/auth/middleware';
import { UnauthorizedError, ForbiddenError } from '@/lib/utils/errors';

function req(headers: Record<string, string>): NextRequest {
  return new NextRequest(new URL('http://localhost/api/v1/loans/x'), { headers });
}

describe('getAuthContext', () => {
  it('throws UnauthorizedError when headers are missing entirely (request bypassed middleware)', () => {
    expect(() => getAuthContext(req({}))).toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when groupId is missing', () => {
    expect(() =>
      getAuthContext(req({ 'x-user-id': 'u1', 'x-role': 'treasurer' })),
    ).toThrow(UnauthorizedError);
  });

  it('throws ForbiddenError when a backoffice token (x-aud: backoffice) hits a tenant route', () => {
    expect(() =>
      getAuthContext(req({
        'x-user-id': 'u1', 'x-group-id': 'g1', 'x-role': 'treasurer', 'x-aud': 'backoffice',
      })),
    ).toThrow(ForbiddenError);
  });

  it('returns the auth context when required headers are present', () => {
    const auth = getAuthContext(req({ 'x-user-id': 'u1', 'x-group-id': 'g1', 'x-role': 'treasurer' }));
    expect(auth).toMatchObject({ userId: 'u1', groupId: 'g1', role: 'treasurer' });
  });
});

describe('getBackofficeContext', () => {
  it('throws ForbiddenError when a tenant token (no x-aud: backoffice) hits a backoffice route', () => {
    expect(() =>
      getBackofficeContext(req({ 'x-user-id': 'u1', 'x-platform-role': 'super_admin' })),
    ).toThrow(ForbiddenError);
  });

  it('throws UnauthorizedError when userId or platformRole is missing', () => {
    expect(() =>
      getBackofficeContext(req({ 'x-aud': 'backoffice', 'x-user-id': 'u1' })),
    ).toThrow(UnauthorizedError);
  });

  it('throws ForbiddenError for a platform role outside the allowed set', () => {
    expect(() =>
      getBackofficeContext(req({ 'x-aud': 'backoffice', 'x-user-id': 'u1', 'x-platform-role': 'member' })),
    ).toThrow(ForbiddenError);
  });

  it('returns the backoffice context for a valid super_admin token', () => {
    const ctx = getBackofficeContext(req({
      'x-aud': 'backoffice', 'x-user-id': 'u1', 'x-platform-role': 'super_admin',
    }));
    expect(ctx).toMatchObject({ userId: 'u1', platformRole: 'super_admin' });
  });
});
