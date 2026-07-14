'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Landmark, MoreHorizontal, PlusCircle,
  PlayCircle, XCircle, ArrowUpRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAdminOrganizations, useCreateOrganization, useUpdateOrganizationStatus,
} from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate } from '@/lib/utils';

const ORG_TYPES = [
  { value: 'bank',        label: 'Bank' },
  { value: 'sacco',       label: 'SACCO' },
  { value: 'foundation',  label: 'Foundation' },
  { value: 'ngo',         label: 'NGO' },
  { value: 'government',  label: 'Government' },
  { value: 'cooperative', label: 'Cooperative' },
  { value: 'faith_based', label: 'Faith-based' },
  { value: 'other',       label: 'Other' },
];

const TYPE_LABEL: Record<string, string> =
  Object.fromEntries(ORG_TYPES.map((t) => [t.value, t.label]));

const TYPE_BADGE: Record<string, string> = {
  bank:        'bg-blue-100 text-blue-700',
  sacco:       'bg-emerald-100 text-emerald-700',
  foundation:  'bg-purple-100 text-purple-700',
  ngo:         'bg-amber-100 text-amber-700',
  government:  'bg-slate-100 text-slate-700',
  cooperative: 'bg-teal-100 text-teal-700',
  faith_based: 'bg-rose-100 text-rose-700',
  other:       'bg-gray-100 text-gray-600',
};

const EMPTY_FORM = {
  name: '', type: 'bank', registrationNumber: '', phone: '', email: '', county: '', address: '',
};

export default function OrganizationsPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [page,   setPage]   = useState(1);
  const [search, setSearch] = useState('');
  const [type,   setType]   = useState('');
  const [status, setStatus] = useState('');

  const [onboardOpen, setOnboardOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [confirm, setConfirm] = useState<{ id: string; name: string; action: 'activate' | 'deactivate' } | null>(null);

  const { data, isLoading } = useAdminOrganizations({ page, limit: 25, search, type, status });
  const createOrg    = useCreateOrganization();
  const updateStatus = useUpdateOrganizationStatus();

  const items: any[] = data?.items ?? [];
  const total        = data?.total ?? 0;
  const totalPages   = Math.ceil(total / 25);

  const submitOnboard = async () => {
    if (form.name.trim().length < 2) {
      toast({ variant: 'destructive', title: 'Organization name is required' });
      return;
    }
    try {
      await createOrg.mutateAsync({
        name: form.name.trim(),
        type: form.type,
        registrationNumber: form.registrationNumber.trim() || undefined,
        phone:  form.phone.trim()  || undefined,
        email:  form.email.trim()  || undefined,
        county: form.county.trim() || undefined,
        address: form.address.trim() || undefined,
      });
      toast({ title: `${form.name.trim()} onboarded` });
      setOnboardOpen(false);
      setForm({ ...EMPTY_FORM });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not onboard', description: e.message });
    }
  };

  const runStatus = async () => {
    if (!confirm) return;
    try {
      await updateStatus.mutateAsync({ id: confirm.id, action: confirm.action });
      toast({ title: `${confirm.name} ${confirm.action}d` });
      setConfirm(null);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Organizations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {total.toLocaleString()} total · banks, SACCOs & foundations that oversee groups
          </p>
        </div>
        <Button size="sm" onClick={() => setOnboardOpen(true)}>
          <PlusCircle size={15} className="mr-2" /> Onboard organization
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search by name or registration…"
                className="pl-8 h-8 text-sm"
              />
            </div>

            <select
              value={type}
              onChange={(e) => { setType(e.target.value); setPage(1); }}
              className="h-8 text-sm border border-input rounded-md px-2 bg-background"
            >
              <option value="">All types</option>
              {ORG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>

            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="h-8 text-sm border border-input rounded-md px-2 bg-background"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>

            {(search || type || status) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs"
                onClick={() => { setSearch(''); setType(''); setStatus(''); setPage(1); }}>
                Clear
              </Button>
            )}

            <div className="ml-auto text-xs text-muted-foreground">
              {total} result{total !== 1 ? 's' : ''}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Organization</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Type</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Groups</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Member Reach</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Wallet</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Onboarded</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(7)].map((__, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[120px]" /></td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-sm text-muted-foreground">
                    No organizations yet. Onboard a bank, SACCO, or foundation to get started.
                  </td>
                </tr>
              ) : items.map((org) => (
                <tr
                  key={org.id}
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/admin/organizations/${org.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                        <Landmark size={13} className="text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{org.name}</p>
                        {org.registration_number && (
                          <p className="text-xs text-gray-400 font-mono">{org.registration_number}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TYPE_BADGE[org.type] ?? 'bg-gray-100 text-gray-600'}`}>
                      {TYPE_LABEL[org.type] ?? org.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{org.group_count}</td>
                  <td className="px-4 py-3 text-right font-medium">{Number(org.member_reach).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-green-600 font-medium">{formatKES(org.wallet_balance)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={org.is_active ? 'success' : 'secondary'} className="text-xs">
                      {org.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(org.created_at)}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreHorizontal size={14} /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => router.push(`/admin/organizations/${org.id}`)}>
                          <ArrowUpRight size={13} className="mr-2" /> View & assign groups
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {org.is_active ? (
                          <DropdownMenuItem className="text-red-700"
                            onClick={() => setConfirm({ id: org.id, name: org.name, action: 'deactivate' })}>
                            <XCircle size={13} className="mr-2" /> Deactivate
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem className="text-green-700"
                            onClick={() => setConfirm({ id: org.id, name: org.name, action: 'activate' })}>
                            <PlayCircle size={13} className="mr-2" /> Activate
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">Page {page} of {totalPages} · {total} organizations</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs"
                disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs"
                disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Onboard dialog */}
      <Dialog open={onboardOpen} onOpenChange={(o) => { if (!o) { setOnboardOpen(false); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Onboard organization</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Equity Bank Foundation" />
            </div>
            <div className="space-y-1">
              <Label>Type <span className="text-red-500">*</span></Label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {ORG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Registration No.</Label>
              <Input value={form.registrationNumber}
                onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
                placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label>County</Label>
              <Input value={form.county} onChange={(e) => setForm({ ...form, county: e.target.value })}
                placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOnboardOpen(false); setForm({ ...EMPTY_FORM }); }}>Cancel</Button>
            <Button onClick={submitOnboard} loading={createOrg.isPending}>Onboard</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate / deactivate confirm */}
      <Dialog open={!!confirm} onOpenChange={() => setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="capitalize">{confirm?.action} organization</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            You are about to <strong>{confirm?.action}</strong> <strong>{confirm?.name}</strong>.
            {confirm?.action === 'deactivate' && ' Its coordinator loses portal access until reactivated.'}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button onClick={runStatus} loading={updateStatus.isPending}
              className={confirm?.action === 'deactivate' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
