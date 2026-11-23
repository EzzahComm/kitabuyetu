'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { websiteInbox } from '@/lib/services/website-enquiries.service';
export function WebsiteInbox({ site }: { site: string }) {
  const path = '/organization/website/enquiries';
  const query = useQuery({
    queryKey: ['website-inbox', site],
    queryFn: () => adminApi.get<Awaited<ReturnType<typeof websiteInbox>>>(path),
  });
  const [error, setError] = useState('');
  async function handle(id: string) {
    try {
      await adminApi.patch(path, { id });
      await query.refetch();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }
  return (
    <section className="space-y-3 rounded-xl border bg-background p-5">
      <h2 className="text-xl font-semibold">Website enquiries</h2>
      {query.error || error ? (
        <p role="alert">{error || getErrorMessage(query.error)}</p>
      ) : query.data?.length === 0 ? (
        <p>No enquiries received.</p>
      ) : null}
      {query.data?.map((v) => (
        <article key={v.id} className="space-y-2 border-t pt-3">
          <p>
            {v.email} · {new Date(v.received).toLocaleDateString()}
          </p>
          <p className="whitespace-pre-wrap">{v.message}</p>
          {v.handled ? (
            <p>Handled</p>
          ) : (
            <Button variant="outline" onClick={() => handle(v.id)}>
              Mark handled
            </Button>
          )}
        </article>
      ))}
    </section>
  );
}
