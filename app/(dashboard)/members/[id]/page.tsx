'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Phone, Mail, MapPin, Calendar, Shield, CreditCard, Landmark, Users, Plus, Trash2, Briefcase, Archive, RotateCcw, AlertTriangle, Smartphone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/shared/stat-card';
import { StatusPill } from '@/components/shared/status-pill';
import type { Tone } from '@/lib/ui/tokens';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useMember, memberKeys } from '@/hooks/use-members';
import { useContributions } from '@/hooks/use-contributions';
import { useLoans } from '@/hooks/use-loans';
import { formatKES, formatDate, getInitials, getErrorMessage } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nextOfKinApi, membersApi } from '@/lib/api/endpoints';
import { api } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { StkPromptDialog } from '@/components/mpesa/stk-prompt-dialog';

// SUPER_ADMIN_PLATFORM_AUDIT.md §2.6 — credit-scores.service.ts already
// computes this composite financial+social reliability score; it was just
// never linked from the member profile. Same tier palette as
// app/(dashboard)/credit-scores/[memberId]/page.tsx.
type CreditTier = 'excellent' | 'good' | 'fair' | 'poor' | 'high_risk';
// `high_risk` is a real STATUS_TONE key already; the rest have no natural
// auto-derived mapping, so mirror credit-scores/page.tsx's TIER_BADGE colors
// (excellent/good both green-leaning, fair neutral, poor amber) explicitly.
const TIER_TONE: Record<CreditTier, Tone> = {
  excellent: 'positive', good: 'positive', fair: 'neutral', poor: 'warning', high_risk: 'negative',
};
const TIER_LABEL: Record<CreditTier, string> = {
  excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor', high_risk: 'High risk',
};
interface MemberCreditScore {
  overall_score: string;
  reliability_tier: CreditTier;
}

const roleVariant: Record<string, 'default' | 'success' | 'secondary' | 'outline'> = {
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

  const creditScoreQ = useQuery<MemberCreditScore>({
    queryKey: ['credit-score', id, 'latest'],
    queryFn:  () => api.get<MemberCreditScore>(`/credit-scores/${id}`),
    enabled:  !!id,
    retry:    false,
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

  const m = member;
  const contributions = contribData?.items ?? [];
  const loans         = loanData?.items ?? [];
  const totalContributed = contributions.reduce((sum, c) =>
    sum + parseFloat(c.amount ?? '0'), 0);
  const currentStatus: string = m.group_status ?? (m.is_active ? 'active' : 'inactive');

  const fullName = [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(' ');

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
                {getInitials(m.first_name ?? '?', m.last_name ?? '')}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold">{fullName}</h1>
                <Badge variant={roleVariant[m.group_role] ?? 'outline'}>
                  {roleLabels[m.group_role] ?? m.group_role}
                </Badge>
                <StatusPill status={currentStatus} />
              </div>
              <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                {m.phone && <span className="flex items-center gap-1"><Phone size={13} /> {m.phone}</span>}
                {m.alternative_phone && (
                  <span className="flex items-center gap-1"><Phone size={13} /> Alt: {m.alternative_phone}</span>
                )}
                {m.email   && <span className="flex items-center gap-1"><Mail size={13} /> {m.email}</span>}
                {m.address && <span className="flex items-center gap-1"><MapPin size={13} /> {m.address}</span>}
                {m.occupation && <span className="flex items-center gap-1"><Briefcase size={13} /> {m.occupation}</span>}
                {m.joined_at && (
                  <span className="flex items-center gap-1"><Calendar size={13} /> Joined {formatDate(m.joined_at)}</span>
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Contributed" value={formatKES(totalContributed)} />
        <StatCard
          title="Active Loans"
          value={loans.filter((l) => l.status === 'active' || l.status === 'disbursed').length}
        />
        <StatCard title="Next of kin" value={kinRows.length} />
        {/* Not a plain StatCard: the tier is a colored StatusPill living inside
            the value area, which StatCard's string|number `value` can't host.
            Kept as a Card so the tier pill stays visible next to the score. */}
        <Link href={`/credit-scores/${id}`}>
          <Card className="h-full transition-colors hover:border-brand-500">
            <CardContent className="pt-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Credit score</p>
              {creditScoreQ.isLoading ? (
                <p className="text-xl font-bold mt-1 text-muted-foreground">…</p>
              ) : creditScoreQ.data ? (
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-xl font-bold">{Number(creditScoreQ.data.overall_score).toFixed(0)}</p>
                  <StatusPill
                    status={creditScoreQ.data.reliability_tier}
                    tone={TIER_TONE[creditScoreQ.data.reliability_tier]}
                    label={TIER_LABEL[creditScoreQ.data.reliability_tier]}
                    size="sm"
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-1.5">Not scored yet</p>
              )}
            </CardContent>
          </Card>
        </Link>
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
                  {contributions.map((c) => (
                    <div key={c.id} className="flex items-center justify-between py-3 text-sm">
                      <div>
                        <p className="font-medium">{formatDate(c.contribution_date)}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {c.payment_method?.replace('_',' ')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-brand-600">{formatKES(c.amount)}</p>
                        <StatusPill status={c.status} size="sm" />
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
                  {loans.map((l) => (
                    <div key={l.id} className="flex items-center justify-between py-3 text-sm">
                      <div>
                        <p className="font-medium">{formatKES(l.principal_amount)}</p>
                        <p className="text-xs text-muted-foreground">
                          {l.loan_term_months}m @ {l.interest_rate}%
                        </p>
                      </div>
                      <div className="text-right">
                        <StatusPill status={l.status} size="sm" />
                        {l.outstanding_balance && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Balance: {formatKES(l.outstanding_balance)}
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
                  ['Middle name', m.middle_name ?? '—'],
                  ['Occupation', m.occupation ?? '—'],
                  ['National ID', m.national_id ?? '—'],
                  ['Gender', m.gender ?? '—'],
                  ['Date of Birth', m.date_of_birth ? formatDate(m.date_of_birth) : '—'],
                  ['Platform Role', m.platform_role ?? '—'],
                  ['Email Verified', m.email_verified ? 'Yes' : 'No'],
                  ['Phone Verified', m.phone_verified ? 'Yes' : 'No'],
                  ['Last Login', m.last_login_at ? formatDate(m.last_login_at) : '—'],
                  ['Member Since', formatDate(m.created_at)],
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
        member={{ name: fullName, phone: m.phone }}
      />
    </div>
  );
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
    onError: (err: unknown) => {
      toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
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
    onError: (err: unknown) => {
      toast({ variant: 'destructive', title: 'Failed to add contact', description: getErrorMessage(err) });
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
    onError: (err: unknown) => {
      toast({ variant: 'destructive', title: 'Failed to update status', description: getErrorMessage(err) });
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
