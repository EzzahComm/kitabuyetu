'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Inbox, RefreshCw, AlertTriangle, ArrowRightLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { api } from '@/lib/api/client';
import { formatKES, formatDate } from '@/lib/utils';

interface MpesaTxn {
  id:                   string;
  transaction_type:     string;
  direction:            'inbound' | 'outbound';
  mpesa_receipt_number: string | null;
  phone_number:         string | null;
  amount:               string;
  status:               string;
  reference:            string | null;
  description:          string | null;
  failure_reason:       string | null;
  created_at:           string;
  completed_at:         string | null;
}
interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; totalPages: number }

const TYPES   = ['', 'stk_push', 'c2b', 'b2c', 'b2b', 'reversal', 'balance_query', 'transaction_status'];
const STATUSES = ['', 'initiated', 'pending', 'completed', 'failed', 'timeout', 'cancelled', 'reversed'];

const statusVariant: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  completed: 'success',
  pending:   'warning',
  initiated: 'warning',
  failed:    'destructive',
  timeout:   'destructive',
  cancelled: 'secondary',
  reversed:  'secondary',
};

export default function MpesaPage() {
  const [page, setPage]     = useState(1);
  const [type, setType]     = useState('');
  const [status, setStatus] = useState('');
  const [phone, setPhone]   = useState('');

  const qs = new URLSearchParams({ page: String(page), limit: '25' });
  if (type)   qs.set('type', type);
  if (status) qs.set('status', status);
  if (phone)  qs.set('phone', phone);

  const { data, isLoading, refetch, isFetching } = useQuery<Paged<MpesaTxn>>({
    queryKey: ['mpesa', 'transactions', page, type, status, phone],
    queryFn:  () => api.get<Paged<MpesaTxn>>(`/mpesa/transactions?${qs.toString()}`),
  });

  const columns = [
    {
      key: 'type', header: 'Type',
      render: (r: MpesaTxn) => (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="uppercase text-[10px]">{r.transaction_type}</Badge>
          <span className={`text-[10px] ${r.direction === 'inbound' ? 'text-green-600' : 'text-amber-600'}`}>
            {r.direction === 'inbound' ? '↓ in' : '↑ out'}
          </span>
        </div>
      ),
    },
    { key: 'amount',  header: 'Amount', render: (r: MpesaTxn) => <span className="font-semibold">{formatKES(Number(r.amount))}</span> },
    { key: 'phone',   header: 'Phone',  render: (r: MpesaTxn) => r.phone_number ?? '—' },
    { key: 'receipt', header: 'Receipt', render: (r: MpesaTxn) => r.mpesa_receipt_number ?? <span className="text-muted-foreground">—</span> },
    { key: 'ref',     header: 'Reference', render: (r: MpesaTxn) => r.reference ?? '—' },
    {
      key: 'status', header: 'Status',
      render: (r: MpesaTxn) => (
        <div>
          <Badge variant={statusVariant[r.status] ?? 'secondary'}>{r.status}</Badge>
          {r.failure_reason && <p className="text-[10px] text-destructive mt-0.5 max-w-[180px] truncate">{r.failure_reason}</p>}
        </div>
      ),
    },
    { key: 'date', header: 'Date', render: (r: MpesaTxn) => formatDate(r.completed_at ?? r.created_at) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">M-Pesa transactions</h1>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} records</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/mpesa/unrouted">
            <Button variant="outline" size="sm"><Inbox size={15} className="mr-2" /> Unrouted</Button>
          </Link>
          <Link href="/mpesa/reallocations">
            <Button variant="outline" size="sm"><ArrowRightLeft size={15} className="mr-2" /> Corrections</Button>
          </Link>
          <Link href="/mpesa/reconciliations">
            <Button variant="outline" size="sm"><AlertTriangle size={15} className="mr-2" /> Reconciliations</Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Type</label>
          <select
            value={type}
            onChange={(e) => { setType(e.target.value); setPage(1); }}
            className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {TYPES.map((t) => <option key={t} value={t}>{t || 'All types'}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Phone</label>
          <Input
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setPage(1); }}
            placeholder="2547…"
            className="h-9 w-40"
          />
        </div>
      </div>

      <PaginatedTable
        data={data}
        isLoading={isLoading}
        columns={columns}
        onPageChange={setPage}
        emptyMessage="No M-Pesa transactions match these filters"
      />
    </div>
  );
}
