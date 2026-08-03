'use client';

/**
 * Program budget + donor spend reports (ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md
 * Phase 4). Both reports already existed server-side
 * (organization-finance.service.ts's programBudgetReport/donorSpendReport,
 * built during the accounting-audit series) — this is the first frontend
 * page for either.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileBarChart, TrendingUp, TrendingDown, Plus } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { MoneyDisplay } from '@/components/shared/money-display';
import { EmptyState } from '@/components/ui/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { cn, getErrorMessage } from '@/lib/utils';
import { organizationApi } from '@/lib/api/endpoints';

const PROGRAM_TYPES = [
  'grant', 'revolving_fund', 'loan_capital', 'matching_contribution',
  'seed_capital', 'emergency_support', 'operational_support',
  'scholarship', 'insurance', 'investment',
] as const;

function UtilizationBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const tone = pct > 100 ? 'bg-red-500' : pct > 85 ? 'bg-amber-500' : 'bg-brand-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function BudgetReportTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['enterprise', 'reports', 'budget'],
    queryFn:  () => organizationApi.budgetReport(),
  });
  const items = data?.items ?? [];

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={FileBarChart}
        title="No funding programs yet"
        description="Budget variance appears here once you've created a funding program."
      />
    );
  }

  return (
    <div className="space-y-3">
      {items.map((p) => (
        <Card key={p.id}>
          <CardContent className="space-y-3 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium text-foreground">{p.name}</p>
                <p className="text-xs capitalize text-muted-foreground">{p.programType.replace(/_/g, ' ')} · {p.status}</p>
              </div>
              <div className="text-right">
                <MoneyDisplay amount={p.disbursed + p.reserved} size="sm" />
                <p className="text-xs text-muted-foreground">of <MoneyDisplay amount={p.budget} size="sm" className="inline" /> budget</p>
              </div>
            </div>

            <UtilizationBar pct={p.utilizationPct} />

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{p.utilizationPct.toFixed(1)}% utilized · <MoneyDisplay amount={p.remaining} size="sm" className="inline" /> remaining</span>
              {p.variancePct !== null && (
                <span className={cn('flex items-center gap-1 font-medium', p.variancePct < 0 ? 'text-amber-600' : 'text-brand-600')}>
                  {p.variancePct < 0 ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
                  {p.variancePct < 0 ? 'Behind schedule' : 'On/ahead of schedule'} ({p.variancePct > 0 ? '+' : ''}{p.variancePct.toFixed(1)}pp)
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DonorSpendTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['enterprise', 'reports', 'donor'],
    queryFn:  () => organizationApi.donorSpendReport(),
  });
  const items = data?.items ?? [];

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={FileBarChart}
        title="No donor spend to report yet"
        description="This groups settled disbursements by funding source once your programs start disbursing."
      />
    );
  }

  return (
    <div className="space-y-3">
      {items.map((d) => (
        <Card key={d.fundingSource}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{d.fundingSource}</CardTitle>
              <span className="text-xs text-muted-foreground">{d.programCount} program{d.programCount === 1 ? '' : 's'}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Budget</p>
                <MoneyDisplay amount={d.totalBudget} size="sm" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Disbursed</p>
                <MoneyDisplay amount={d.totalDisbursed} size="sm" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Remaining</p>
                <MoneyDisplay amount={d.remaining} size="sm" />
              </div>
            </div>
            <UtilizationBar pct={d.utilizationPct} />
            {d.byGroup.length > 0 && (
              <div className="border-t pt-3">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">By branch</p>
                <div className="space-y-1">
                  {d.byGroup.map((g) => (
                    <div key={g.groupId} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{g.groupName ?? 'Unknown branch'}</span>
                      <MoneyDisplay amount={g.amount} size="sm" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function NewProgramDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<unknown>;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [programType, setProgramType] = useState<typeof PROGRAM_TYPES[number]>('grant');
  const [budget, setBudget] = useState('');
  const [fundingSource, setFundingSource] = useState('');
  const [description, setDescription] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName(''); setProgramType('grant'); setBudget('');
    setFundingSource(''); setDescription(''); setStartsOn(''); setEndsOn('');
  };

  const submit = async () => {
    const parsedBudget = parseFloat(budget);
    if (name.trim().length < 3 || !(parsedBudget > 0)) {
      toast({ variant: 'destructive', title: 'Give the program a name (3+ chars) and a positive budget' });
      return;
    }
    setBusy(true);
    try {
      await organizationApi.createProgram({
        name: name.trim(),
        programType,
        budget: parsedBudget,
        fundingSource: fundingSource.trim() || undefined,
        description: description.trim() || undefined,
        startsOn: startsOn || undefined,
        endsOn: endsOn || undefined,
      });
      toast({ title: 'Funding program created' });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not create program', description: getErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New funding program</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026 Youth Enterprise Fund" />
          </div>
          <div className="space-y-1">
            <Label>Type</Label>
            <select
              value={programType}
              onChange={(e) => setProgramType(e.target.value as typeof programType)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm capitalize"
            >
              {PROGRAM_TYPES.map((t) => (
                <option key={t} value={t} className="capitalize">{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Budget (KES)</Label>
            <Input type="number" min="1" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0.00" />
          </div>
          <div className="space-y-1">
            <Label>Funding source (optional)</Label>
            <Input value={fundingSource} onChange={(e) => setFundingSource(e.target.value)} placeholder="e.g. Ford Foundation" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Starts on (optional)</Label>
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Ends on (optional)</Label>
              <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this program funds" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} loading={busy}>Create program</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ReportsPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const refreshPrograms = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['enterprise', 'reports', 'budget'] }),
    qc.invalidateQueries({ queryKey: ['enterprise', 'reports', 'donor'] }),
    qc.invalidateQueries({ queryKey: ['enterprise', 'programs'] }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Budget variance across your funding programs and spend broken down by donor."
        breadcrumbs={[{ label: 'Portfolio', href: '/enterprise' }, { label: 'Reports' }]}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={15} className="mr-2" /> New program
          </Button>
        }
      />

      <Tabs defaultValue="budget">
        <TabsList>
          <TabsTrigger value="budget">Budget variance</TabsTrigger>
          <TabsTrigger value="donor">Donor spend</TabsTrigger>
        </TabsList>
        <TabsContent value="budget" className="mt-4">
          <BudgetReportTab />
        </TabsContent>
        <TabsContent value="donor" className="mt-4">
          <DonorSpendTab />
        </TabsContent>
      </Tabs>

      <NewProgramDialog open={creating} onOpenChange={setCreating} onCreated={refreshPrograms} />
    </div>
  );
}
