'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Coins, Users, TrendingUp, Layers, Settings as SettingsIcon, Wallet, ListTree, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { StatCard } from '@/components/shared/stat-card';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api/client';
import { downloadAuthenticated } from '@/lib/utils/download';
import type { PaginatedResult } from '@/types/db.types';

// ── Types ──────────────────────────────────────────────────────────────

interface ShareClass {
  id: string;
  name: string;
  code: string;
  par_value: string;
  current_value: string | null;
  voting_weight: string;
  transfer_allowed: boolean;
  is_active: boolean;
}
interface GroupSummary {
  totalClasses: number;
  totalShareholders: number;
  totalShares: number;
  totalShareCapital: string;
  totalInvested: string;
  byClass: {
    classId: string;
    code: string;
    name: string;
    sharesIssued: number;
    shareholders: number;
    effectiveValue: string;
    capitalAtValue: string;
  }[];
  topHolders: { memberId: string; firstName: string; lastName: string; totalShares: number; totalInvested: string }[];
}
interface Holding {
  member_id: string;
  share_class_id: string;
  quantity: number;
  total_invested: string;
  member_first_name: string;
  member_last_name: string;
  member_phone: string;
  share_class_name: string;
  share_class_code: string;
  share_class_par: string;
  share_class_current: string | null;
}
interface ShareTxn {
  id: string;
  type: string;
  status: string;
  quantity: number;
  unit_price: string;
  total_amount: string;
  certificate_serial: string | null;
  posted_at: string;
  member_first_name: string;
  member_last_name: string;
  share_class_code: string;
  counterparty_first_name: string | null;
  counterparty_last_name: string | null;
  notes: string | null;
}
const fmtMoney = (v: string | number | null | undefined) => {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(n);
};
const fmtInt = (v: number) => new Intl.NumberFormat('en-KE').format(v);

const TYPE_BADGE: Record<string, 'default' | 'success' | 'secondary' | 'warning' | 'destructive' | 'outline'> = {
  allocation: 'secondary',
  purchase: 'success',
  transfer_in: 'default',
  transfer_out: 'outline',
  redemption: 'warning',
  adjustment: 'destructive',
};

export default function SharesPage() {
  const { toast } = useToast();
  const summaryQ = useQuery<GroupSummary>({
    queryKey: ['shares', 'summary'],
    queryFn: () => api.get<GroupSummary>('/shares/summary'),
  });
  const classesQ = useQuery<{ items: ShareClass[] }>({
    queryKey: ['shares', 'classes'],
    queryFn: () => api.get<{ items: ShareClass[] }>('/share-classes?active=true'),
  });
  const holdingsQ = useQuery<PaginatedResult<Holding>>({
    queryKey: ['shares', 'holdings'],
    queryFn: () => api.get<PaginatedResult<Holding>>('/shares/holdings?limit=50'),
  });
  const ledgerQ = useQuery<PaginatedResult<ShareTxn>>({
    queryKey: ['shares', 'ledger'],
    queryFn: () => api.get<PaginatedResult<ShareTxn>>('/shares/transactions?limit=50'),
  });

  const summary = summaryQ.data;
  const classes = classesQ.data?.items ?? [];
  const noClasses = !classesQ.isLoading && classes.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Share Capital"
        description="View member share holdings and transaction history."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/shares/classes">
                <SettingsIcon size={16} className="mr-2" /> Share classes
              </Link>
            </Button>
          </>
        }
      />

      {noClasses && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Layers className="h-10 w-10 text-muted-foreground" />
            <p className="text-base font-medium">No share classes yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Create at least one share class (e.g. &ldquo;Ordinary Shares&rdquo; at KES 100 par value) before you can
              allocate, purchase, or transfer shares.
            </p>
            <Button asChild>
              <Link href="/shares/classes">Create a share class</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {!noClasses && (
        <>
          {/* Summary cards */}
          <div className="grid gap-3 md:grid-cols-4">
            <StatCard
              title="Share capital"
              value={summaryQ.isLoading ? '—' : fmtMoney(summary?.totalShareCapital)}
              icon={Coins}
            />
            <StatCard
              title="Shares issued"
              value={summaryQ.isLoading ? '—' : fmtInt(summary?.totalShares ?? 0)}
              icon={TrendingUp}
            />
            <StatCard
              title="Shareholders"
              value={summaryQ.isLoading ? '—' : fmtInt(summary?.totalShareholders ?? 0)}
              icon={Users}
            />
            <StatCard
              title="Share classes"
              value={summaryQ.isLoading ? '—' : fmtInt(summary?.totalClasses ?? 0)}
              icon={Layers}
            />
          </div>

          {/* By-class breakdown */}
          {(summary?.byClass.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By class</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {summary!.byClass.map((c) => (
                    <div key={c.classId} className="rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{c.name}</p>
                        <Badge variant="outline">{c.code}</Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <div>
                          <p>Issued</p>
                          <p className="text-sm text-foreground">{fmtInt(c.sharesIssued)}</p>
                        </div>
                        <div>
                          <p>Holders</p>
                          <p className="text-sm text-foreground">{fmtInt(c.shareholders)}</p>
                        </div>
                        <div>
                          <p>Capital</p>
                          <p className="text-sm text-foreground">{fmtMoney(c.capitalAtValue)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="holdings">
            <TabsList>
              <TabsTrigger value="holdings">Holdings</TabsTrigger>
              <TabsTrigger value="ledger">Ledger</TabsTrigger>
              <TabsTrigger value="topholders">Top holders</TabsTrigger>
            </TabsList>

            <TabsContent value="holdings" className="mt-4">
              <PaginatedTable
                data={singlePage(
                  (holdingsQ.data?.items ?? []).map((h) => ({ ...h, id: `${h.member_id}-${h.share_class_id}` })),
                )}
                isLoading={holdingsQ.isLoading}
                isError={holdingsQ.isError}
                error={holdingsQ.error}
                onPageChange={() => {}}
                emptyMessage="No shareholders yet"
                emptyIcon={Wallet}
                columns={[
                  {
                    key: 'member',
                    header: 'Member',
                    render: (h) => (
                      <>
                        <p className="font-medium">
                          {h.member_first_name} {h.member_last_name}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">{h.member_phone}</p>
                      </>
                    ),
                  },
                  {
                    key: 'class',
                    header: 'Class',
                    render: (h) => <Badge variant="outline">{h.share_class_code}</Badge>,
                  },
                  {
                    key: 'shares',
                    header: 'Shares',
                    className: 'text-right',
                    render: (h) => <span className="font-mono">{fmtInt(h.quantity)}</span>,
                  },
                  {
                    key: 'invested',
                    header: 'Invested',
                    className: 'text-right',
                    render: (h) => <span className="font-mono">{fmtMoney(h.total_invested)}</span>,
                  },
                  {
                    key: 'value',
                    header: 'Value',
                    className: 'text-right',
                    render: (h) => {
                      const value = h.quantity * Number(h.share_class_current ?? h.share_class_par);
                      return <span className="font-mono">{fmtMoney(value)}</span>;
                    },
                  },
                  {
                    key: 'appreciation',
                    header: 'Appreciation',
                    className: 'text-right',
                    render: (h) => {
                      const value = h.quantity * Number(h.share_class_current ?? h.share_class_par);
                      const appreciation = value - Number(h.total_invested);
                      return (
                        <span
                          className={`font-mono ${appreciation > 0 ? 'text-green-600' : appreciation < 0 ? 'text-red-600' : ''}`}
                        >
                          {appreciation > 0 ? '+' : ''}
                          {fmtMoney(appreciation)}
                        </span>
                      );
                    },
                  },
                ]}
              />
            </TabsContent>

            <TabsContent value="ledger" className="mt-4">
              <PaginatedTable
                data={singlePage(ledgerQ.data?.items)}
                isLoading={ledgerQ.isLoading}
                isError={ledgerQ.isError}
                error={ledgerQ.error}
                onPageChange={() => {}}
                emptyMessage="No transactions yet"
                emptyIcon={ListTree}
                columns={[
                  {
                    key: 'date',
                    header: 'Date',
                    render: (t) => (
                      <span className={`font-mono text-xs ${t.status === 'reversed' ? 'opacity-60 line-through' : ''}`}>
                        {new Date(t.posted_at).toLocaleDateString()}
                      </span>
                    ),
                  },
                  {
                    key: 'type',
                    header: 'Type',
                    render: (t) => (
                      <span className={t.status === 'reversed' ? 'opacity-60 line-through' : ''}>
                        <Badge variant={TYPE_BADGE[t.type] ?? 'outline'} className="capitalize">
                          {t.type.replace('_', ' ')}
                        </Badge>
                      </span>
                    ),
                  },
                  {
                    key: 'member',
                    header: 'Member',
                    render: (t) => (
                      <span className={t.status === 'reversed' ? 'opacity-60 line-through' : ''}>
                        <p>
                          {t.member_first_name} {t.member_last_name}
                        </p>
                        {t.counterparty_first_name && (
                          <p className="text-xs text-muted-foreground">
                            ↔ {t.counterparty_first_name} {t.counterparty_last_name}
                          </p>
                        )}
                      </span>
                    ),
                  },
                  {
                    key: 'class',
                    header: 'Class',
                    render: (t) => (
                      <span className={t.status === 'reversed' ? 'opacity-60 line-through' : ''}>
                        <Badge variant="outline">{t.share_class_code}</Badge>
                      </span>
                    ),
                  },
                  {
                    key: 'qty',
                    header: 'Qty',
                    className: 'text-right',
                    render: (t) => (
                      <span
                        className={`font-mono ${t.quantity > 0 ? 'text-green-600' : 'text-red-600'} ${t.status === 'reversed' ? 'opacity-60 line-through' : ''}`}
                      >
                        {t.quantity > 0 ? '+' : ''}
                        {fmtInt(t.quantity)}
                      </span>
                    ),
                  },
                  {
                    key: 'amount',
                    header: 'Amount',
                    className: 'text-right',
                    render: (t) => (
                      <span className={`font-mono ${t.status === 'reversed' ? 'opacity-60 line-through' : ''}`}>
                        {fmtMoney(t.total_amount)}
                      </span>
                    ),
                  },
                  {
                    key: 'certificate',
                    header: 'Certificate',
                    render: (t) => (
                      <span className={`font-mono text-xs ${t.status === 'reversed' ? 'opacity-60 line-through' : ''}`}>
                        {t.certificate_serial ? (
                          <button
                            type="button"
                            onClick={() => {
                              // Auth'd download — JWT is in localStorage,
                              // a plain <a target=_blank> would 401.
                              downloadAuthenticated(`/api/v1/shares/transactions/${t.id}/certificate`, {
                                fallbackFilename: `share-certificate-${t.certificate_serial}.pdf`,
                                openInNewTab: true,
                              }).catch((err: Error) =>
                                toast({
                                  variant: 'destructive',
                                  title: 'Could not open certificate',
                                  description: err.message,
                                }),
                              );
                            }}
                            className="text-primary hover:underline"
                            title="Open share certificate PDF"
                          >
                            {t.certificate_serial}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </span>
                    ),
                  },
                ]}
              />
            </TabsContent>

            <TabsContent value="topholders" className="mt-4">
              <PaginatedTable
                data={singlePage((summary?.topHolders ?? []).map((h, i) => ({ ...h, id: h.memberId, rank: i + 1 })))}
                isLoading={summaryQ.isLoading}
                isError={summaryQ.isError}
                error={summaryQ.error}
                onPageChange={() => {}}
                emptyMessage="No shareholders yet"
                emptyIcon={Trophy}
                columns={[
                  { key: 'rank', header: 'Rank', render: (h) => <span className="font-mono">#{h.rank}</span> },
                  {
                    key: 'member',
                    header: 'Member',
                    render: (h) => (
                      <>
                        {h.firstName} {h.lastName}
                      </>
                    ),
                  },
                  {
                    key: 'totalShares',
                    header: 'Total shares',
                    className: 'text-right',
                    render: (h) => <span className="font-mono">{fmtInt(h.totalShares)}</span>,
                  },
                  {
                    key: 'totalInvested',
                    header: 'Invested',
                    className: 'text-right',
                    render: (h) => <span className="font-mono">{fmtMoney(h.totalInvested)}</span>,
                  },
                ]}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
