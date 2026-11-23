'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/context';
import { adminApi } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export function WebsiteGrant({ orgId }: { orgId: string }) {
  const { user } = useAuth();
  const allowed = user?.platformRole === 'super_admin';
  const path = '/organizations/' + orgId + '/website';
  const query = useQuery({
    queryKey: ['website-grant', orgId],
    queryFn: () => adminApi.get<{ slug: string; enabled: boolean } | null>(path),
    enabled: allowed,
    retry: false,
  });
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!allowed) return null;
  async function update() {
    setBusy(true);
    setError('');
    try {
      await adminApi.put(path, { slug: query.data?.slug ?? slug, enabled: !query.data?.enabled });
      await query.refetch({ throwOnError: true });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl border bg-background p-5">
      <h2 className="font-semibold">Organization website</h2>
      {query.data ? (
        <p>
          /sites/{query.data.slug} · {query.data.enabled ? 'Access enabled' : 'Suspended'}
        </p>
      ) : (
        <label className="block max-w-md">
          Website address under /sites/
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="organization-name" />
        </label>
      )}
      <Button
        variant="outline"
        disabled={busy || query.isLoading || !!query.error || (!query.data && !slug)}
        onClick={update}
      >
        {query.data ? (query.data.enabled ? 'Suspend website' : 'Restore website') : 'Create private website draft'}
      </Button>
      {(error || query.error) && <p role="alert">{error || getErrorMessage(query.error)}</p>}
    </section>
  );
}
