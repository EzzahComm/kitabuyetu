'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { api } from '@/lib/api/client';
import { authApi } from '@/lib/api/endpoints';
import { resolvePostLoginPath } from '@/lib/auth/post-login-path';
import type { grantRequest } from '@/lib/group-domains/protocol';
import type { MemberRole } from '@/types/enums';
import { getErrorMessage } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
export function DomainConsent({
  hostname,
  groupId,
  groupName,
  grant,
}: {
  hostname: string;
  groupId: string;
  groupName: string;
  grant: z.infer<typeof grantRequest> | null;
}) {
  const { user, isLoading, login, logout } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const tenant = isTenantUser(user) ? user : null;
  function signIn() {
    if (user) logout();
    router.push('/login?connect=' + encodeURIComponent(window.location.pathname + window.location.search));
  }
  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (!tenant) {
        signIn();
        return;
      }
      if (tenant.groupId !== groupId) {
        login(await authApi.switchGroup(groupId));
        return;
      }
      const result = await api.post<{ redirect?: string; role?: MemberRole }>(
        '/auth/domain-consent',
        grant ?? { hostname },
      );
      if (result.redirect) window.location.assign(result.redirect);
      else router.push(await resolvePostLoginPath(result.role));
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{groupName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>
          {grant ? 'Connect your Kitabu Yetu account to ' : 'Open the group workspace from '}
          <strong>{hostname}</strong>.
        </p>
        {grant && (
          <div>
            <p>The website is requesting access for 15 minutes to</p>
            <ul className="list-disc pl-5">
              <li>Confirm your member ID, group and leadership role.</li>
              {grant.scope !== 'identity' && (
                <li>
                  Read permitted group meetings, contributions, reports, campaigns, SMS credits and product access.
                </li>
              )}
              {grant.scope === 'meetings.write' && <li>Create meetings using your group permissions.</li>}
            </ul>
          </div>
        )}
        {tenant && (
          <p>
            Signed in as {tenant.firstName} {tenant.lastName} in {tenant.groupName}.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <Button onClick={submit} disabled={busy || isLoading}>
          {!tenant
            ? 'Sign in with Kitabu Yetu'
            : tenant.groupId !== groupId
              ? 'Switch to ' + groupName
              : grant
                ? 'Allow and return to website'
                : 'Open group workspace'}
        </Button>
        {tenant && (
          <button className="block underline" onClick={signIn}>
            Use another account
          </button>
        )}
        {grant && (
          <a className="block underline" href={'https://' + hostname + '/'}>
            Cancel and return to website
          </a>
        )}
      </CardContent>
    </Card>
  );
}
