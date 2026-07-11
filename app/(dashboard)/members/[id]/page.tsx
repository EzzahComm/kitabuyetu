'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Phone, Mail, MapPin, Calendar, Shield, CreditCard, Landmark, Users, Plus, Trash2, Briefcase, Archive, RotateCcw, AlertTriangle, Smartphone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useMember, memberKeys } from '@/hooks/use-members';
import { useContributions } from '@/hooks/use-contributions';
import { useLoans } from '@/hooks/use-loans';
import { formatKES, formatDate, getInitials } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nextOfKinApi, membersApi } from '@/lib/api/endpoints';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';

const roleVariant: Record<string, any> = {
  chairperson: 'default',
  treasurer:   'success',
  secretary:   'secondary',
  member:      'outline',
};

const roleLabels: Record<string, string> = {
  chairperson: 'Chairperson',
  treasurer:   'Treasurer',
  secretary:   'Secretary',
  auditor:     'Auditor',
  member:      'Member',
};

const STATUS_BADGE: Record<string, any> = {
  pending_verification: 'warning',
  active:               'success',
  inactive:             'secondary',
  suspended:            'warning',
  rejected:             'destructive',
  blacklisted:          'destructive',
  exited:               'secondary',
  archived:             'outline',
};

interface NextOfKin {
  id: string;
  full_name: string;
  relationship: string;
  phone: string;
  alternative_phone: string | null;
  email: string | null;
  address: string | null;
  national_id: string | null;
  priority: number;
  notes: string | null;
  created_at: string;
}

export default function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: member, isLoading: loadingMember } = useMember(id);
  const { data: contribData } = useContributions({ memberId: id, limit: 10 });
  const { data: loanData }    = useLoans({ memberId: id, limit: 10 });

  // Next of kin (Phase E2)
  const { data: kinRows = [], isLoading: loadingKin } = useQuery<NextOfKin[]>({
    queryKey: ['next-of-kin', id],
    queryFn:  () => nextOfKinApi.list(id) as Promise<NextOfKin[]>,
    enabled:  !!id,
  });

  const [kinDialogOpen, setKinDialogOpen] = useState(false);
  const [statusDialog,  setStatusDialog]  = useState<null | { target: string }>(null);
  const [stkOpen,       setStkOpen]       = useState(false);

  if (loadingMember) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!member) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Member not found.</p>
        <Link href="/members"><Button variant="outline" className="mt-4">Back to Members</Button></Link>
      </div>
    );
  }

  const m = member as any;
  const contributions = (contribData as any)?.items ?? [];
  const loans         = (loanData as any)?.items ?? [];
  const totalContributed = contributions.reduce((sum: number, c: any) =>
    sum + parseFloat(c.amount ?? '0'), 0);
  const currentStatus: string = m.groupStatus ?? m.group_status
    ?? ((m.isActive ?? m.is_active) ? 'active' : 'inactive');

  const fullName = [
    m.firstName ?? m.first_name,
    m.middleName ?? m.middle_name,
    m.lastName  ?? m.last_name,
  ].filter(Boolean).join(' ');

  return (
    <div className="space-y-6">
      <Link href="/members" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={16} /> Back to Members
      </Link>

      {/* Profile header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <Avatar className="h-16 w-16 text-lg">
              <AvatarFallback className="bg-brand-100 text-brand-700 font-bold text-xl">
                {getInitials(m.firstName ?? m.first_name ?? '?', m.lastName ?? m.last_name ?? '')}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold">{fullName}</h1>
                <Badge variant={roleVariant[m.groupRole ?? m.group_role] ?? 'outline'}>
                  {roleLabels[m.groupRole ?? m.group_role] ?? (m.groupRole ?? m.group_role)}
                </Badge>
                <Badge variant={STATUS_BADGE[currentStatus] ?? 'outline'} className="capitalize">
                  {currentStatus.replace('_', ' ')}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                {m.phone && <span className="flex items-center gap-1"><Phone size={13} /> {m.phone}</span>}
                {(m.alternativePhone ?? m.alternative_phone) && (
                  <span className="flex items-center gap-1"><Phone size={13} /> Alt: {m.alternativePhone ?? m.alternative_phone}</span>
                )}
                {m.email   && <span className="flex items-center gap-1"><Mail size={13} /> {m.email}</span>}
                {m.address && <span className="flex items-center gap-1"><MapPin size={13} /> {m.address}</span>}
                {m.occupation && <span className="flex items-center gap-1"><Briefcase size={13} /> {m.occupation}</span>}
                {(m.joinedAt ?? m.joined_at) && (
                  <span className="flex items-center gap-1"><Calendar size={13} /> Joined {formatDate(m.joinedAt ?? m.joined_at)}</span>
                )}
              </div>
            </div>

            {/* Status action buttons (visible to caller with manage rights;
                RLS will reject the request server-side if not authorised). */}
            <div className="flex gap-2 flex-shrink-0">
              {m.phone && (
                <Button size="sm" onClick={() => setStkOpen(true)}>
                  <Smartphone size={14} className="mr-1" /> Request payment
                </Button>
              )}
              {currentStatus === 'archived' ? (
                <Button size="sm" variant="outline" onClick={() => setStatusDialog({ target: 'active' })}>
                  <RotateCcw size={14} className="mr-1" /> Restore
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => setStatusDialog({ target: 'suspended' })}>
                    <AlertTriangle size={14} className="mr-1" /> Suspend
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setStatusDialog({ target: 'archived' })}>
                    <Archive size={14} className="mr-1" /> Archive
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Contributed</p>
            <p className="text-xl font-bold mt-1 text-brand-600">{formatKES(totalContributed)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active Loans</p>
            <p className="text-xl font-bold mt-1">
              {loans.filter((l: any) => l.status === 'active' || l.status === 'disbursed').length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Next of kin</p>
            <p className="text-xl font-bold mt-1">{kinRows.length}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="contributions">
        <TabsList>
          <TabsTrigger value="contributions">
            <CreditCard size={14} className="mr-1" /> Contributions ({contributions.length})
          </TabsTrigger>
          <TabsTrigger value="loans">
            <Landmark size={14} className="mr-1" /> Loans ({loans.length})
          </TabsTrigger>
          <TabsTrigger value="kin">
            <Users size={14} className="mr-1" /> Next of kin ({kinRows.length})
          </TabsTrigger>
          <TabsTrigger value="info">
            <Shield size={14} className="mr-1" /> Details
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contributions" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              {contributions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No contributions recorded</p>
              ) : (
                <div className="divide-y">
                  {contributions.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between py-3 text-sm">
                      <div>
                        <p className="font-medium">
                          {c.periodYear ?? c.period_year}-{String(c.periodMonth ?? c.period_month ?? '').padStart(2,'0')}
                        </p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {(c.paymentMethod ?? c.payment_method)?.replace('_',' ')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-brand-600">{formatKES(c.amount)}</p>
                        <Badge variant={c.status === 'completed' ? 'success' : 'warning'} className="text-xs">{c.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="loans" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              {loans.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No loans found</p>
              ) : (
                <div className="divide-y">
                  {loans.map((l: any) => (
                    <div key={l.id} className="flex items-center justify-between py-3 text-sm">
                      <div>
                        <p className="font-medium">{formatKES(l.principalAmount ?? l.principal_amount)}</p>
                        <p className="text-xs text-muted-foreground">
                          {l.loanTermMonths ?? l.loan_term_months}m @ {l.interestRate ?? l.interest_rate}%
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge variant={l.status === 'active' ? 'success' : 'secondary'} className="text-xs capitalize">{l.status}</Badge>
                        {(l.outstandingBalance ?? l.outstanding_balance) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Balance: {formatKES(l.outstandingBalance ?? l.outstanding_balance)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kin" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Emergency contacts</CardTitle>
              <Button size="sm" onClick={() => setKinDialogOpen(true)}>
                <Plus size={14} className="mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent>
              {loadingKin ? (
                <Skeleton className="h-24 w-full" />
              ) : kinRows.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No emergency contacts on file. Add at least one primary contact (priority 1).
                </p>
              ) : (
                <div className="divide-y">
                  {kinRows.map((k) => (
                    <KinRow key={k.id} memberId={id} kin={k} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="info" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {[
                  ['Middle name', m.middleName ?? m.middle_name ?? '—'],
                  ['Occupation', m.occupation ?? '—'],
                  ['National ID', m.nationalId ?? m.national_id ?? '—'],
                  ['Gender', m.gender ?? '—'],
                  ['Date of Birth', (m.dateOfBirth ?? m.date_of_birth) ? formatDate(m.dateOfBirth ?? m.date_of_birth) : '—'],
                  ['Platform Role', m.platformRole ?? m.platform_role ?? '—'],
                  ['Email Verified', (m.emailVerified ?? m.email_verified) ? 'Yes' : 'No'],
                  ['Phone Verified', (m.phoneVerified ?? m.phone_verified) ? 'Yes' : 'No'],
                  ['Last Login', m.lastLoginAt ?? m.last_login_at ? formatDate(m.lastLoginAt ?? m.last_login_at) : '—'],
                  ['Member Since', formatDate(m.createdAt ?? m.created_at)],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</dt>
                    <dd className="mt-0.5 font-medium capitalize">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddKinDialog
        open={kinDialogOpen}
        onClose={() => setKinDialogOpen(false)}
        memberId={id}
        existingPrimary={kinRows.some((k) => k.priority === 1)}
      />

      <StatusDialog
        memberId={id}
        target={statusDialog?.target ?? null}
        onClose={() => setStatusDialog(null)}
        onApplied={() => qc.invalidateQueries({ queryKey: memberKeys.detail(id) })}
      />

      <StkPromptDialog
        open={stkOpen}
        onClose={() => setStkOpen(false)}
        phone={m.phone ?? ''}
        memberName={fullName}
      />
    </div>
  );
}

// ─── STK push prompt ────────────────────────────────────────────────────

function StkPromptDialog({
  open, onClose, phone, memberName,
}: { open: boolean; onClose: () => void; phone: string; memberName: string }) {
  const { toast } = useToast();
  const [amount, setAmount]   = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus]   = useState<string | null>(null);

  const send = async () => {
    const amt = parseInt(amount, 10);
    if (!amt || amt <= 0) { toast({ variant: 'destructive', title: 'Enter a whole-shilling amount' }); return; }
    setSending(true);
    setStatus(null);
    try {
      const res = await fetchStk(amt, phone);
      const checkoutId = res?.checkoutRequestId;
      toast({ title: 'STK push sent', description: 'Ask the member to enter their M-Pesa PIN.' });
      if (checkoutId) void pollStatus(checkoutId, setStatus);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'STK push failed', description: err?.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setAmount(''); setStatus(null); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Request M-Pesa payment</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Prompt <span className="font-medium text-foreground">{memberName}</span> ({phone}) to pay a contribution.
          </p>
          <div className="space-y-1">
            <Label>Amount (KES)</Label>
            <Input type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500" />
          </div>
          {status && (
            <p className={`text-sm ${status === 'completed' ? 'text-green-600' : status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
              Status: {status}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={send} loading={sending}>Send prompt</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function fetchStk(amount: number, phone: string): Promise<{ checkoutRequestId?: string }> {
  const { api } = await import('@/lib/api/client');
  return api.post<{ checkoutRequestId?: string }>('/mpesa/stk-push', {
    phone,
    amount,
    accountReference: 'CONTRIB',
    description:      'Contribution',
    purpose:          'contribution',
  });
}

async function pollStatus(checkoutId: string, setStatus: (s: string) => void): Promise<void> {
  const { api } = await import('@/lib/api/client');
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await api.get<{ status: string }>(`/mpesa/status?checkoutRequestId=${encodeURIComponent(checkoutId)}`);
      setStatus(res.status);
      if (res.status === 'completed' || res.status === 'failed') return;
    } catch {
      // keep polling — transient
    }
  }
}

// ─── Next-of-kin row + delete ───────────────────────────────────────────

function KinRow({ memberId, kin }: { memberId: string; kin: NextOfKin }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const del = useMutation({
    mutationFn: () => nextOfKinApi.remove(memberId, kin.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['next-of-kin', memberId] });
      toast({ title: 'Contact removed' });
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Failed', description: err.message });
    },
  });

  return (
    <div className="flex items-start justify-between py-3 gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium truncate">{kin.full_name}</p>
          {kin.priority === 1 && <Badge variant="success" className="text-xs">Primary</Badge>}
          <Badge variant="outline" className="text-xs capitalize">{kin.relationship.replace('_',' ')}</Badge>
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
          <span>📱 {kin.phone}</span>
          {kin.alternative_phone && <span>Alt: {kin.alternative_phone}</span>}
          {kin.email   && <span>✉ {kin.email}</span>}
          {kin.address && <span>📍 {kin.address}</span>}
        </div>
        {kin.notes && <p className="text-xs text-muted-foreground mt-1 italic">{kin.notes}</p>}
      </div>
      <Button
        size="sm" variant="ghost" type="button"
        onClick={() => { if (confirm(`Remove ${kin.full_name}?`)) del.mutate(); }}
        disabled={del.isPending}
        aria-label={`Remove ${kin.full_name}`}
        title="Remove"
      >
        <Trash2 size={14} className="text-destructive" />
      </Button>
    </div>
  );
}

// ─── Add next-of-kin dialog ─────────────────────────────────────────────

interface KinFormValues {
  fullName: string;
  relationship: string;
  phone: string;
  alternativePhone?: string;
  email?: string;
  address?: string;
  nationalId?: string;
  priority: number;
  notes?: string;
}

function AddKinDialog({
  open, onClose, memberId, existingPrimary,
}: {
  open: boolean;
  onClose: () => void;
  memberId: string;
  existingPrimary: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<KinFormValues>({
    defaultValues: {
      priority: existingPrimary ? 2 : 1,
      relationship: 'spouse',
    },
  });

  const create = useMutation({
    mutationFn: (body: unknown) => nextOfKinApi.create(memberId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['next-of-kin', memberId] });
      toast({ title: 'Contact added' });
      reset();
      onClose();
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Failed to add contact', description: err.message });
    },
  });

  const onSubmit = (v: KinFormValues) => {
    const body: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === '' || val === undefined) continue;
      body[k] = val;
    }
    create.mutate(body);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add emergency contact</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="space-y-1">
            <Label>Full name</Label>
            <Input {...register('fullName', { required: 'Required', minLength: 2 })} />
            {errors.fullName && <p className="text-xs text-destructive">{errors.fullName.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Relationship</Label>
              <select
                {...register('relationship', { required: true })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="spouse">Spouse</option>
                <option value="parent">Parent</option>
                <option value="child">Child</option>
                <option value="sibling">Sibling</option>
                <option value="guardian">Guardian</option>
                <option value="grandparent">Grandparent</option>
                <option value="grandchild">Grandchild</option>
                <option value="in_law">In-law</option>
                <option value="friend">Friend</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Priority</Label>
              <select
                {...register('priority', { valueAsNumber: true })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value={1} disabled={existingPrimary}>1 — Primary{existingPrimary ? ' (already set)' : ''}</option>
                <option value={2}>2 — Secondary</option>
                <option value={3}>3 — Tertiary</option>
                <option value={4}>4 — Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input placeholder="0712345678" {...register('phone', { required: 'Required' })} />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Alt. phone</Label>
              <Input placeholder="0712345678" {...register('alternativePhone')} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Email <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input type="email" {...register('email')} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Address <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input {...register('address')} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>National ID <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input {...register('nationalId')} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Notes</Label>
              <Input {...register('notes')} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" loading={isSubmitting || create.isPending}>Add contact</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status transition dialog ───────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  active:      'Reactivate',
  archived:    'Archive',
  suspended:   'Suspend',
  blacklisted: 'Blacklist',
  exited:      'Mark as exited',
  rejected:    'Reject',
};

const REASON_REQUIRED = new Set(['suspended', 'rejected', 'blacklisted', 'exited']);

function StatusDialog({
  memberId, target, onClose, onApplied,
}: {
  memberId: string;
  target: string | null;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');

  const apply = useMutation({
    mutationFn: () => membersApi.transitionStatus(memberId, target!, reason || undefined),
    onSuccess: () => {
      toast({ title: `Status updated → ${target}` });
      setReason('');
      onApplied();
      onClose();
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Failed to update status', description: err.message });
    },
  });

  const reasonRequired = target ? REASON_REQUIRED.has(target) : false;

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{target ? STATUS_LABELS[target] ?? `Change to ${target}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This will set the member&apos;s status to <strong className="capitalize">{target}</strong>.
            {reasonRequired && ' A reason is required and stored in the audit trail.'}
          </p>
          <div className="space-y-1">
            <Label>Reason {reasonRequired && <span className="text-destructive">*</span>}</Label>
            <Input
              placeholder="Why?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setReason(''); onClose(); }}>Cancel</Button>
          <Button
            onClick={() => apply.mutate()}
            disabled={apply.isPending || (reasonRequired && reason.trim().length === 0)}
            loading={apply.isPending}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
