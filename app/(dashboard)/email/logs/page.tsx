'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/shared/status-pill';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useEmailLogs } from '@/hooks/use-email';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function EmailLogsPage() {
  const [status, setStatus]   = useState('');
  const [category, setCategory] = useState('');
  const [days, setDays]       = useState(30);
  const [page, setPage]       = useState(1);

  const { data, isLoading } = useEmailLogs({
    status: status || undefined,
    category: category || undefined,
    days,
    page,
  });

  const logs = data?.data ?? [];
  const meta = data?.meta;

  function fmt(d: string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' });
  }

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-bold text-gray-900">Email Logs</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={status} onValueChange={(v) => { setStatus(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {['sent','queued','failed','bounced','dry_run'].map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={(v) => { setCategory(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {['transactional','billing','loan','contribution','auth','campaign','financial_report'].map((c) => (
              <SelectItem key={c} value={c} className="capitalize">{c.replace('_',' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(days)} onValueChange={(v) => { setDays(Number(v)); setPage(1); }}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 days</SelectItem>
            <SelectItem value="14">14 days</SelectItem>
            <SelectItem value="30">30 days</SelectItem>
            <SelectItem value="90">90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {meta ? `${meta.total.toLocaleString()} emails` : 'Email Logs'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>To</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Opened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs">{log.to}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">{log.subject ?? '—'}</TableCell>
                      <TableCell>
                        {log.template_key
                          ? <Badge variant="outline" className="text-xs">{log.template_key}</Badge>
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <StatusPill status={log.status} size="sm" />
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">{log.provider ?? '—'}</TableCell>
                      <TableCell className="text-xs">{fmt(log.sent_at)}</TableCell>
                      <TableCell className="text-xs">{log.opened_at ? fmt(log.opened_at) : '—'}</TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {meta && meta.total > meta.limit && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Page {meta.page} of {Math.ceil(meta.total / meta.limit)}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={page >= Math.ceil(meta.total / meta.limit)}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
