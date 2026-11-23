'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/utils';
type Domain = { id: string; hostname: string; challenge: string; verified_until: string | null };
export function DomainSettings({ groupId, userId }: { groupId: string; userId: string }) {
  const query = useQuery({
    queryKey: ['group-domain', groupId, userId],
    queryFn: () => api.get<Domain | null>('/auth/group-domain'),
    retry: false,
  });
  const [hostname, setHostname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  async function act(cmd: { action: 'register' | 'verify'; hostname: string } | { action: 'disconnect'; id: string }) {
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/group-domain', cmd);
      setDisconnecting(false);
      await query.refetch({ throwOnError: true });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const domain = query.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Group website sign-in</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? (
          <p>Loading domain…</p>
        ) : query.error ? (
          <p role="alert">{getErrorMessage(query.error)}</p>
        ) : domain ? (
          <>
            <p>
              <strong>{domain.hostname}</strong>
            </p>
            <p>Add this TXT record at your DNS host. Keep the record in place for automatic renewal.</p>
            <dl className="space-y-2 break-all">
              <div>
                <dt>Record name</dt>
                <dd>
                  <code>_kitabuyetu.{domain.hostname}</code>
                </dd>
              </div>
              <div>
                <dt>Record value</dt>
                <dd>
                  <code>kitabuyetu={domain.challenge}</code>
                </dd>
              </div>
            </dl>
            {domain.verified_until && new Date(domain.verified_until) > new Date() ? (
              <>
                <p>
                  Verified until {new Date(domain.verified_until).toLocaleDateString()}. Add this sign-in link to your
                  website.
                </p>
                <code className="block break-all">
                  {window.location.origin}/connect/{domain.hostname}
                </code>
              </>
            ) : (
              <p>Verification is required to enable sign-in.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => act({ action: 'verify', hostname: domain.hostname })}>
                Verify DNS
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setDisconnecting(!disconnecting)}>
                Disconnect domain
              </Button>
            </div>
            {disconnecting && (
              <div>
                <p>Disconnecting revokes this website’s active access tokens immediately.</p>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => act({ action: 'disconnect', id: domain.id })}
                >
                  Confirm disconnect
                </Button>
              </div>
            )}
          </>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: 'register', hostname });
            }}
          >
            <label className="block space-y-2">
              Website hostname
              <Input
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                required
                placeholder="www.yourgroup.org"
              />
            </label>
            <Button disabled={busy}>Connect domain</Button>
          </form>
        )}
        {error && <p role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
