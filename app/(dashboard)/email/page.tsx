'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useEmailAnalytics } from '@/hooks/use-email';
import { Mail, CheckCircle, XCircle, Eye, AlertTriangle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState } from 'react';

function pct(n: number, total: number) {
  if (!total) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

export default function EmailDashboardPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useEmailAnalytics(days);
  const stats = data;

  const statCards = [
    { label: 'Total Sent',  value: stats?.sent    ?? 0, icon: Mail,          color: 'text-blue-600'   },
    { label: 'Delivered',   value: stats?.sent    ?? 0, icon: CheckCircle,   color: 'text-green-600'  },
    { label: 'Failed',      value: stats?.failed  ?? 0, icon: XCircle,       color: 'text-red-600'    },
    { label: 'Opened',      value: stats?.opened  ?? 0, icon: Eye,           color: 'text-purple-600' },
    { label: 'Bounced',     value: stats?.bounced ?? 0, icon: AlertTriangle, color: 'text-amber-600'  },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Email Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor email delivery and engagement</p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className={`h-4 w-4 ${s.color}`} />
                <span className="text-xs text-gray-500">{s.label}</span>
              </div>
              {isLoading ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <div className="text-2xl font-bold text-gray-900">{s.value.toLocaleString()}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Rate cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Delivery Rate</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-3xl font-bold text-green-600">
                {pct((stats?.sent ?? 0), (stats?.total ?? 0))}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">{stats?.sent ?? 0} of {stats?.total ?? 0} emails</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Open Rate</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-3xl font-bold text-purple-600">
                {pct(stats?.opened ?? 0, stats?.sent ?? 0)}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">{stats?.opened ?? 0} opened</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Bounce Rate</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-3xl font-bold text-amber-600">
                {pct(stats?.bounced ?? 0, stats?.sent ?? 0)}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">{stats?.bounced ?? 0} bounced</p>
          </CardContent>
        </Card>
      </div>

      {/* By category */}
      <Card>
        <CardHeader><CardTitle>Emails by Category</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          ) : (
            <div className="space-y-2">
              {stats?.byCategory.map((row) => (
                <div key={row.category} className="flex items-center justify-between">
                  <Badge variant="outline" className="capitalize">{row.category.replace('_', ' ')}</Badge>
                  <span className="text-sm font-medium">{row.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily trend */}
      <Card>
        <CardHeader><CardTitle>Daily Volume</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {stats?.byDay.slice().reverse().map((row) => (
                <div key={row.date} className="flex items-center gap-3 text-sm">
                  <span className="text-gray-500 w-24 shrink-0">{new Date(row.date).toLocaleDateString('en-KE', { day:'2-digit', month:'short' })}</span>
                  <div className="flex gap-2">
                    <Badge variant="secondary">{row.sent} sent</Badge>
                    {row.failed > 0 && <Badge variant="destructive">{row.failed} failed</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
