'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { organizationApi } from '@/lib/api/endpoints';
import { enterpriseKeys } from '@/lib/api/enterprise-keys';

export default function ReportExportPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: enterpriseKeys.reportExport(id),
    queryFn: () => organizationApi.reportExport(id),
    refetchInterval: ({ state }) =>
      state.status === 'success' && (state.data?.status === 'pending' || state.data?.status === 'processing')
        ? 5000
        : false,
    staleTime: 0,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Report export"
        breadcrumbs={[{ label: 'Reports', href: '/enterprise/reports' }, { label: 'Export' }]}
      />
      {isPending && <p>Loading report…</p>}
      {isError && (
        <div role="alert" className="space-y-2">
          <p>This report is unavailable. Check that you are signed in to the correct organization.</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      )}
      {!isError && data?.status === 'completed' && data.downloadUrl && (
        <Button asChild>
          <a href={data.downloadUrl}>Download report ({data.format.toUpperCase()})</a>
        </Button>
      )}
      {!isError && data && !data.downloadUrl && data.status !== 'failed' && (
        <>
          <p role="status">
            {data.status === 'completed'
              ? 'The download is temporarily unavailable.'
              : 'Your report is being generated.'}
          </p>
          <Button variant="outline" onClick={() => void refetch()}>
            Refresh report
          </Button>
        </>
      )}
      {!isError && data?.status === 'failed' && <p>This report could not be generated.</p>}
    </div>
  );
}
