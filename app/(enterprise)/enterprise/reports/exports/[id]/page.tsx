'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { adminApi } from '@/lib/api/client';
import type { ExportRow } from '@/lib/services/report-export.service';

export default function ReportExportPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['enterprise', 'report-export', id],
    queryFn: () => adminApi.get<ExportRow & { downloadUrl: string | null }>(`/organization/reports/export/${id}`),
    staleTime: 0,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Report export"
        breadcrumbs={[{ label: 'Reports', href: '/enterprise/reports' }, { label: 'Export' }]}
      />
      {isPending && <p>Loading report…</p>}
      {isError && <p>This report is unavailable. Check that you are signed in to the correct organisation.</p>}
      {!isError && data?.status === 'completed' && data.downloadUrl && (
        <Button asChild>
          <a href={data.downloadUrl}>Download report ({data.format.toUpperCase()})</a>
        </Button>
      )}
      {!isError && data && !data.downloadUrl && data.status !== 'failed' && (
        <>
          <p>
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
