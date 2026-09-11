'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Landmark, MoreHorizontal, PlusCircle,
  PlayCircle, XCircle, ArrowUpRight, BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/shared/status-pill';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { PaginatedTable } from '@/components/shared/paginated-table';
import {
  useAdminOrganizations, useCreateOrganization, useUpdateOrganizationStatus,
} from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import { ORGANIZATION_PLAN_MONTHLY_FEES } from '@/types/enums';

interface AdminOrgRow {
  id:                  string;
  name:                string;
  registration_number: string | null;
  type:                string;
  group_count:         number;
  member_reach:        string;
  wallet_balance:      string;
  is_active:           boolean;
  created_at:          string;
}

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

// Fees come from ORGANIZATION_PLAN_MONTHLY_FEES, not a hardcoded copy — the
// group side's billing page used to carry its own hardcoded fee table that
// drifted from the server's, charging customers the client's stale number
// (see PLAN_MONTHLY_FEES's own history in types/enums.ts). Not repeating that.
const PLAN_TYPES: { value: 'starter' | 'growth' | 'premium' | 'premium_plus'; label: string; fee: string }[] = [
  { value: 'starter',      label: 'Starter',   fee: `${formatKES(ORGANIZATION_PLAN_MONTHLY_FEES.starter)}/mo` },
  { value: 'growth',       label: 'Growth',    fee: `${formatKES(ORGANIZATION_PLAN_MONTHLY_FEES.growth)}/mo` },
  { value: 'premium',      label: 'Premium',   fee: `${formatKES(ORGANIZATION_PLAN_MONTHLY_FEES.premium)}/mo` },
  { value: 'premium_plus', label: 'Premium+',  fee: 'Custom' },
];

const EMPTY_CUSTOM = {
  monthlyFee: '', maxLinkedGroups: '', maxStaff: '', maxFundingPrograms: '', smsAllowanceIncluded: '',
  supportTier: 'priority_plus' as 'standard' | 'priority' | 'priority_plus',
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
  const [planType, setPlanType] = useState<'starter' | 'growth' | 'premium' | 'premium_plus'>('starter');
  const [custom, setCustom] = useState({ ...EMPTY_CUSTOM });
  const [confirm, setConfirm] = useState<{ id: string; name: string; action: 'activate' | 'deactivate' } | null>(null);

  const { data, isLoading, isError, error } = useAdminOrganizations({ page, limit: 25, search, type, status });
  const createOrg    = useCreateOrganization();
  const updateStatus = useUpdateOrganizationStatus();

  const items: AdminOrgRow[] = data?.items ?? [];
  const total        = data?.total ?? 0;
  const totalPages   = Math.ceil(total / 25);

  const submitOnboard = async () => {
    if (form.name.trim().length < 2) {
      toast({ variant: 'destructive', title: 'Organization name is required' });
      return;
    }
    if (planType === 'premium_plus' && !(parseFloat(custom.monthlyFee) >= 0)) {
      toast({ variant: 'destructive', title: 'Premium+ requires a monthly fee', description: 'Every term is negotiated per contract.' });
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
        planType,
        custom: planType === 'premium_plus' ? {
          monthlyFee:           parseFloat(custom.monthlyFee),
          maxLinkedGroups:      custom.maxLinkedGroups      ? parseInt(custom.maxLinkedGroups, 10)      : null,
          maxStaff:             custom.maxStaff             ? parseInt(custom.maxStaff, 10)             : null,
          maxFundingPrograms:   custom.maxFundingPrograms   ? parseInt(custom.maxFundingPrograms, 10)   : null,
          smsAllowanceIncluded: custom.smsAllowanceIncluded ? parseFloat(custom.smsAllowanceIncluded)   : undefined,
          supportTier:          custom.supportTier,
        } : undefined,
      });
      toast({ title: `${form.name.trim()} onboarded on the ${PLAN_TYPES.find((p) => p.value === planType)?.label} plan` });
      setOnboardOpen(false);
      setForm({ ...EMPTY_FORM });
      setPlanType('starter');
      setCustom({ ...EMPTY_CUSTOM });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not onboard', description: getErrorMessage(e) });
    }
  };

  const runStatus = async () => {
    if (!confirm) return;
    try {
      await updateStatus.mutateAsync({ id: confirm.id, action: confirm.action });
      toast({ title: `${confirm.name} ${confirm.action}d` });
      setConfirm(null);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader
        title="Organizations"
        description={`${total.toLocaleString()} total · banks, SACCOs & foundations that oversee groups`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => router.push('/admin/organizations/compare')}>
              <BarChart3 size={15} className="mr-2" /> Compare
            </Button>
            <Button size="sm" onClick={() => setOnboardOpen(true)}>
              <PlusCircle size={15} className="mr-2" /> Onboard organization
            </Button>
          </div>
        }
      />

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
      <PaginatedTable<AdminOrgRow>
        data={{ items, total, page, pageSize: 25, totalPages }}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={setPage}
        emptyMessage="No organizations yet"
        emptyDescription="Onboard a bank, SACCO, or foundation to get started."
        emptyIcon={Landmark}
        onRowClick={(org) => router.push(`/admin/organizations/${org.id}`)}
        columns={[
          {
            key: 'org', header: 'Organization',
            render: (org) => (
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
            ),
          },
          {
            key: 'type', header: 'Type',
            render: (org) => (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TYPE_BADGE[org.type] ?? 'bg-gray-100 text-gray-600'}`}>
                {TYPE_LABEL[org.type] ?? org.type}
              </span>
            ),
          },
          { key: 'groups', header: 'Groups', className: 'text-right', render: (org) => <span className="font-medium">{org.group_count}</span> },
          { key: 'memberReach', header: 'Member Reach', className: 'text-right', render: (org) => <span className="font-medium">{Number(org.member_reach).toLocaleString()}</span> },
          { key: 'wallet', header: 'Wallet', className: 'text-right', render: (org) => <span className="text-green-600 font-medium">{formatKES(org.wallet_balance)}</span> },
          {
            key: 'status', header: 'Status',
            render: (org) => <StatusPill status={org.is_active ? 'active' : 'inactive'} size="sm" />,
          },
          { key: 'onboarded', header: 'Onboarded', render: (org) => <span className="text-xs text-gray-500">{formatDate(org.created_at)}</span> },
          {
            key: 'actions', header: '', className: 'text-right',
            render: (org) => (
              <div onClick={(e) => e.stopPropagation()}>
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
              </div>
            ),
          },
        ]}
      />

      {/* Onboard dialog */}
      <Dialog open={onboardOpen} onOpenChange={(o) => {
        if (!o) { setOnboardOpen(false); setForm({ ...EMPTY_FORM }); setPlanType('starter'); setCustom({ ...EMPTY_CUSTOM }); }
      }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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

          {/* Plan — required. Organizations never self-serve a plan; this is
              the only place one is ever chosen for the first time. */}
          <div className="space-y-2 border-t pt-3">
            <Label>Plan <span className="text-red-500">*</span></Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PLAN_TYPES.map((p) => (
                <button
                  key={p.value} type="button"
                  onClick={() => setPlanType(p.value)}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    planType === p.value ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/40'
                  }`}
                >
                  <p className="font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground">{p.fee}</p>
                </button>
              ))}
            </div>

            {planType === 'premium_plus' && (
              <div className="grid gap-3 sm:grid-cols-2 rounded-md border bg-muted/20 p-3">
                <p className="sm:col-span-2 text-xs text-muted-foreground">
                  Premium+ is negotiated per contract — every term below is entered by hand. Blank limits mean unlimited.
                </p>
                <div className="space-y-1">
                  <Label>Monthly fee (KES) <span className="text-red-500">*</span></Label>
                  <Input type="number" min={0} value={custom.monthlyFee}
                    onChange={(e) => setCustom({ ...custom, monthlyFee: e.target.value })} placeholder="e.g. 15000" />
                </div>
                <div className="space-y-1">
                  <Label>Support tier</Label>
                  <select
                    value={custom.supportTier}
                    onChange={(e) => setCustom({ ...custom, supportTier: e.target.value as typeof custom.supportTier })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="priority_plus">Priority+</option>
                    <option value="priority">Priority</option>
                    <option value="standard">Standard</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Max linked groups</Label>
                  <Input type="number" min={1} value={custom.maxLinkedGroups}
                    onChange={(e) => setCustom({ ...custom, maxLinkedGroups: e.target.value })} placeholder="Unlimited" />
                </div>
                <div className="space-y-1">
                  <Label>Max staff seats</Label>
                  <Input type="number" min={1} value={custom.maxStaff}
                    onChange={(e) => setCustom({ ...custom, maxStaff: e.target.value })} placeholder="Unlimited" />
                </div>
                <div className="space-y-1">
                  <Label>Max funding programs</Label>
                  <Input type="number" min={1} value={custom.maxFundingPrograms}
                    onChange={(e) => setCustom({ ...custom, maxFundingPrograms: e.target.value })} placeholder="Unlimited" />
                </div>
                <div className="space-y-1">
                  <Label>SMS allowance/month</Label>
                  <Input type="number" min={0} value={custom.smsAllowanceIncluded}
                    onChange={(e) => setCustom({ ...custom, smsAllowanceIncluded: e.target.value })} placeholder="0" />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setOnboardOpen(false); setForm({ ...EMPTY_FORM }); setPlanType('starter'); setCustom({ ...EMPTY_CUSTOM });
            }}>Cancel</Button>
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
