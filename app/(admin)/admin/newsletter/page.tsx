'use client';

import { useState } from 'react';
import { Download, Loader2, Mail, UserCheck, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { useNewsletterSubscribers } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { downloadAuthenticated } from '@/lib/utils/download';
import { formatDate, getErrorMessage } from '@/lib/utils';

export default function NewsletterAdminPage() {
  const { toast } = useToast();
  const { data, isLoading } = useNewsletterSubscribers();
  const [exporting, setExporting] = useState(false);

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadAuthenticated('/api/admin/newsletter/export', {
        fallbackFilename: `newsletter-subscribers-${new Date().toISOString().slice(0, 10)}.csv`,
      });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Export failed', description: getErrorMessage(e) });
    } finally {
      setExporting(false);
    }
  };

  const subscribers = data?.subscribers ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Newsletter"
        description="Public marketing-site subscribers — captured from the site footer and content pages."
        actions={
          <Button variant="outline" size="sm" onClick={onExport} disabled={exporting || !subscribers.length}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Export CSV
          </Button>
        }
      />

      {!isLoading && data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard title="Total ever subscribed" value={data.stats.total} icon={Mail} accent="blue" />
          <StatCard title="Active subscribers" value={data.stats.active} icon={UserCheck} accent="green" />
          <StatCard title="Unsubscribed" value={data.stats.unsubscribed} icon={UserX} accent="gray" />
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : subscribers.length === 0 ? (
            <p className="p-16 text-center text-sm text-muted-foreground">
              No subscribers yet — the signup form is live in the site footer and on the Resources pages.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Subscribed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscribers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.email}</TableCell>
                    <TableCell>{s.name ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{s.source}</TableCell>
                    <TableCell>{formatDate(s.subscribed_at)}</TableCell>
                    <TableCell>
                      {s.unsubscribed_at
                        ? <Badge variant="outline">Unsubscribed</Badge>
                        : <Badge>Active</Badge>}
                    </TableCell>
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
