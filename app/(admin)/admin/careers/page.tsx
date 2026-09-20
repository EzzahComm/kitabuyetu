'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { useApplications } from '@/hooks/use-admin';
import { formatDate } from '@/lib/utils';
import { JOB_APPLICATION_STAGES } from '@/lib/validators/careers.schema';

const STAGE_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  applied: 'secondary', screening: 'default', interview: 'default',
  offer: 'default', hired: 'default', rejected: 'destructive',
};

export default function CareersApplicationsPage() {
  const [stage, setStage] = useState('');
  const { data: applications, isLoading } = useApplications({ stage: stage || undefined });

  const counts = JOB_APPLICATION_STAGES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = applications?.filter((a) => a.stage === s).length ?? 0;
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <PageHeader
        title="Careers — Applications"
        description="Candidates who applied through the public careers pages."
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {JOB_APPLICATION_STAGES.map((s) => (
          <StatCard key={s} title={s.replace('_', ' ')} value={counts[s]} icon={Users} accent={s === 'hired' ? 'green' : s === 'rejected' ? 'red' : 'blue'} />
        ))}
      </div>

      <Card>
        <CardContent className="pt-4">
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">All stages</option>
            {JOB_APPLICATION_STAGES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : !applications || applications.length === 0 ? (
            <p className="p-16 text-center text-sm text-muted-foreground">No applications match these filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead>Stage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/admin/careers/${a.id}`} className="font-medium hover:underline">
                        {a.applicant_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{a.applicant_email}</p>
                    </TableCell>
                    <TableCell>{a.job_title}</TableCell>
                    <TableCell>{formatDate(a.created_at)}</TableCell>
                    <TableCell><Badge variant={STAGE_VARIANT[a.stage]}>{a.stage.replace('_', ' ')}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
