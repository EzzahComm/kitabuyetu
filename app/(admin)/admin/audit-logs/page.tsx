'use client';

import { useState } from 'react';
import { Search, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { useAuditLogs, useAdminGroups } from '@/hooks/use-admin';
import { formatDate } from '@/lib/utils';

interface AuditLogRow {
  id:         string;
  action:     string;
  table_name: string;
  actor_name: string | null;
  group_name: string | null;
  record_id:  string | null;
  ip_address: string | null;
  created_at: string;
}

const ACTION_STYLE: Record<string, string> = {
  INSERT: 'bg-green-50 text-green-700 border-green-200',
  UPDATE: 'bg-blue-50 text-blue-700 border-blue-200',
  DELETE: 'bg-red-50 text-red-700 border-red-200',
};

export default function AuditLogsPage() {
  const [page,    setPage]    = useState(1);
  const [search,  setSearch]  = useState('');
  const [action,  setAction]  = useState('');
  const [groupId, setGroupId] = useState('');
  const [from,    setFrom]    = useState('');
  const [to,      setTo]      = useState('');

  const { data, isLoading } = useAuditLogs({ page, limit: 50, action, groupId, search, from, to });
  // Backend already supports groupId filtering (app/api/admin/audit-logs/route.ts
  // → listAuditLogs) — this dropdown was the only missing piece
  // (SUPER_ADMIN_PLATFORM_AUDIT.md §2.14). 200 is plenty for a filter dropdown;
  // this page doesn't need every group, just enough to find one by name.
  const { data: groupsData } = useAdminGroups({ limit: 200 });
  const groupOptions: { id: string; name: string }[] = groupsData?.items ?? [];

  const items: AuditLogRow[] = data?.items ?? [];
  const total        = data?.total ?? 0;
  const totalPages   = Math.ceil(total / 50);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Logs"
        description={`Immutable record of all platform data changes — ${total.toLocaleString()} entries`}
      />

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search table name…" className="pl-8 h-8 text-sm" />
            </div>
            <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}
              className="h-8 text-sm border border-input rounded-md px-2 bg-background">
              <option value="">All actions</option>
              <option value="INSERT">INSERT</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
            </select>
            <select value={groupId} onChange={(e) => { setGroupId(e.target.value); setPage(1); }}
              className="h-8 text-sm border border-input rounded-md px-2 bg-background max-w-[160px]">
              <option value="">All groups</option>
              {groupOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }}
                className="h-8 text-sm w-36" />
              <span className="text-xs text-gray-400">to</span>
              <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }}
                className="h-8 text-sm w-36" />
            </div>
            {(search || action || groupId || from || to) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs"
                onClick={() => { setSearch(''); setAction(''); setGroupId(''); setFrom(''); setTo(''); setPage(1); }}>
                Clear
              </Button>
            )}
            <span className="ml-auto text-xs text-gray-400">{total} entries</span>
          </div>
        </CardContent>
      </Card>

      {/* Log table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Action</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Table</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Actor</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Group</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Record ID</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">IP Address</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                [...Array(10)].map((_, i) => (
                  <tr key={i}>{[...Array(7)].map((__, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[120px]" /></td>
                  ))}</tr>
                ))
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-sm text-muted-foreground">No audit log entries</td></tr>
              ) : items.map((log, i) => (
                <tr key={log.id ?? i} className="hover:bg-gray-50 font-mono text-xs">
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${ACTION_STYLE[log.action] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 font-medium">{log.table_name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{log.actor_name ?? 'System'}</td>
                  <td className="px-4 py-2.5 text-gray-500">{log.group_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-400 truncate max-w-[120px]">
                    {log.record_id ? log.record_id.substring(0, 8) + '…' : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{log.ip_address ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500">{formatDate(log.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">Page {page} of {totalPages} · {total} entries</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs"
                disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs"
                disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
