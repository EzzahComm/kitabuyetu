'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Phone, Mail, MapPin, Calendar, Shield, CreditCard, Landmark, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useMember } from '@/hooks/use-members';
import { useContributions } from '@/hooks/use-contributions';
import { useLoans } from '@/hooks/use-loans';
import { formatKES, formatDate, getInitials } from '@/lib/utils';

const roleVariant: Record<string, any> = {
  group_admin: 'default',
  treasurer:   'success',
  secretary:   'secondary',
  member:      'outline',
};

const roleLabels: Record<string, string> = {
  group_admin: 'Admin / Chairperson',
  treasurer:   'Treasurer',
  secretary:   'Secretary',
  auditor:     'Auditor',
  member:      'Member',
};

export default function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: member, isLoading: loadingMember } = useMember(id);
  const { data: contribData } = useContributions({ memberId: id, limit: 10 });
  const { data: loanData }    = useLoans({ memberId: id, limit: 10 });

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
    sum + parseFloat(c.amount ?? c.amount ?? '0'), 0);

  return (
    <div className="space-y-6">
      {/* Back */}
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
                <h1 className="text-xl font-bold">
                  {m.firstName ?? m.first_name} {m.lastName ?? m.last_name}
                </h1>
                <Badge variant={roleVariant[m.groupRole ?? m.group_role] ?? 'outline'}>
                  {roleLabels[m.groupRole ?? m.group_role] ?? (m.groupRole ?? m.group_role)}
                </Badge>
                <Badge variant={(m.isActive ?? m.is_active) ? 'success' : 'secondary'}>
                  {(m.isActive ?? m.is_active) ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                {(m.phone) && (
                  <span className="flex items-center gap-1"><Phone size={13} /> {m.phone}</span>
                )}
                {(m.email) && (
                  <span className="flex items-center gap-1"><Mail size={13} /> {m.email}</span>
                )}
                {(m.address) && (
                  <span className="flex items-center gap-1"><MapPin size={13} /> {m.address}</span>
                )}
                {(m.joinedAt ?? m.joined_at) && (
                  <span className="flex items-center gap-1"><Calendar size={13} /> Joined {formatDate(m.joinedAt ?? m.joined_at)}</span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Contributed</p>
            <p className="text-xl font-bold mt-1 text-green-600">{formatKES(totalContributed)}</p>
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
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">National ID</p>
            <p className="text-sm font-medium mt-1 font-mono">{m.nationalId ?? m.national_id ?? '—'}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: contributions + loans */}
      <Tabs defaultValue="contributions">
        <TabsList>
          <TabsTrigger value="contributions">
            <CreditCard size={14} className="mr-1" /> Contributions ({contributions.length})
          </TabsTrigger>
          <TabsTrigger value="loans">
            <Landmark size={14} className="mr-1" /> Loans ({loans.length})
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
                        <p className="font-semibold text-green-600">{formatKES(c.amount)}</p>
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

        <TabsContent value="info" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {[
                  ['Gender', m.gender ?? '—'],
                  ['Date of Birth', m.dateOfBirth ?? m.date_of_birth ? formatDate(m.dateOfBirth ?? m.date_of_birth) : '—'],
                  ['Platform Role', m.platformRole ?? m.platform_role ?? '—'],
                  ['Email Verified', (m.emailVerified ?? m.email_verified) ? 'Yes' : 'No'],
                  ['Phone Verified', (m.phoneVerified ?? m.phone_verified) ? 'Yes' : 'No'],
                  ['Last Login', formatDate(m.lastLoginAt ?? m.last_login_at)],
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
    </div>
  );
}
