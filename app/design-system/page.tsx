'use client';

import * as React from 'react';
import {
  Users, Wallet, TrendingUp, AlertTriangle, Plus, FileText, Inbox,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/shared/status-pill';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { MoneyDisplay } from '@/components/shared/money-display';
import { ConfirmDialog, MoneyActionDialog } from '@/components/shared/confirm-dialog';
import { ChartCard, TrendChart, BarSeriesChart, DonutChart, Sparkline } from '@/components/shared/charts';
import { StatCardsSkeleton, TableSkeleton, ListSkeleton } from '@/components/shared/skeletons';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { FormSection, FormFieldGroup, FormDivider } from '@/components/shared/form-section';
import { PageSection, FormActions } from '@/components/shared/page-section';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { PortalSidebar } from '@/components/shared/portal-sidebar';
import { brandGreen, brandNavy, chartPalette } from '@/lib/ui/tokens';

const trendData = [
  { month: 'Jan', savings: 120000, loans: 40000 },
  { month: 'Feb', savings: 145000, loans: 52000 },
  { month: 'Mar', savings: 138000, loans: 61000 },
  { month: 'Apr', savings: 172000, loans: 58000 },
  { month: 'May', savings: 195000, loans: 73000 },
  { month: 'Jun', savings: 221000, loans: 80000 },
];
const portfolio = [
  { name: 'Savings', value: 620000 },
  { name: 'Loans out', value: 340000 },
  { name: 'Welfare', value: 95000 },
];
const sparkData = trendData.map((d) => ({ v: d.savings }));

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ name, hex }: { name: string; hex: string }) {
  return (
    <div className="space-y-1">
      <div className="h-12 w-full rounded-md border" style={{ backgroundColor: hex }} />
      <p className="text-xs font-medium text-foreground">{name}</p>
      <p className="font-mono text-[11px] text-muted-foreground">{hex}</p>
    </div>
  );
}

export default function DesignSystemPage() {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [moneyOpen, setMoneyOpen] = React.useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-12 p-6 lg:p-10">
      <PageHeader
        title="Kitabu Yetu — Design System"
        description="Living reference for tokens and shared components. Build every portal screen from these primitives."
        breadcrumbs={[{ label: 'Internal', href: '#' }, { label: 'Design System' }]}
        actions={<Badge variant="secondary">v1</Badge>}
      />

      {/* Colours */}
      <Section id="color" title="Brand colour">
        <Card>
          <CardHeader><CardTitle className="text-base">Green — primary (CTAs, positive)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-10">
            {Object.entries(brandGreen).map(([k, v]) => <Swatch key={k} name={k} hex={v} />)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Navy — headings, sidebar, nav</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-10">
            {Object.entries(brandNavy).map(([k, v]) => <Swatch key={k} name={k} hex={v} />)}
          </CardContent>
        </Card>
      </Section>

      {/* Typography */}
      <Section id="type" title="Typography">
        <Card>
          <CardContent className="space-y-3 p-6">
            <p className="font-display text-4xl font-semibold">Display / Fraunces</p>
            <p className="text-3xl font-bold tracking-tight">Heading 1 — Inter Bold</p>
            <p className="text-xl font-semibold">Heading 2 — Inter Semibold</p>
            <p className="text-base">Body — Inter Regular. Build vibrant communities.</p>
            <p className="text-sm text-muted-foreground">Muted caption — supporting copy.</p>
            <p className="money font-mono text-lg">KES 1,234,567.00 — DM Mono, tabular figures</p>
          </CardContent>
        </Card>
      </Section>

      {/* Buttons & badges */}
      <Section id="controls" title="Buttons, badges & status">
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex flex-wrap gap-2">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button loading>Loading</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="destructive">Destructive</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {['paid', 'pending', 'overdue', 'failed', 'reconciled', 'unrouted', 'under_review', 'reversed', 'active'].map((s) => (
                <StatusPill key={s} status={s} />
              ))}
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* Stat cards + money */}
      <Section id="stats" title="Stat cards & money">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total members" value="248" icon={Users} trend={{ value: 12, label: 'vs last month' }} />
          <StatCard title="Group wallet" value="KES 1.2M" icon={Wallet} trend={{ value: 8, label: 'this month' }} />
          <StatCard title="Loans out" value="KES 340K" icon={TrendingUp} trend={{ value: -3, label: 'vs last month' }} />
          <Card>
            <CardContent className="space-y-2 p-6">
              <p className="text-sm text-muted-foreground">Money display</p>
              <MoneyDisplay amount={221000} size="xl" color="green" />
              <Sparkline data={sparkData} dataKey="v" />
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* Charts */}
      <Section id="charts" title="Charts">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Savings vs loans" description="Last 6 months" height={240}>
            <TrendChart
              data={trendData}
              xKey="month"
              series={[{ key: 'savings', label: 'Savings' }, { key: 'loans', label: 'Loans' }]}
            />
          </ChartCard>
          <ChartCard title="Monthly repayments" height={240}>
            <BarSeriesChart data={trendData} xKey="month" series={[{ key: 'loans', label: 'Repaid' }]} />
          </ChartCard>
          <ChartCard title="Portfolio split" height={240}>
            <DonutChart data={portfolio} />
          </ChartCard>
          <Card>
            <CardHeader><CardTitle className="text-base">Palette</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-4 gap-3">
              {chartPalette.map((c, i) => <Swatch key={i} name={`c${i}`} hex={c} />)}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* Alerts */}
      <Section id="alerts" title="Alerts">
        <Alert>
          <FileText className="h-4 w-4" />
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>Your monthly statement is ready to download.</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Fraud warning</AlertTitle>
          <AlertDescription>This payment looks unusual for this member. Review before approving.</AlertDescription>
        </Alert>
      </Section>

      {/* Empty + loading */}
      <Section id="states" title="Empty & loading states">
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Inbox}
              title="No contributions yet"
              description="Once members start contributing, their payments will appear here. Record the first one to get going."
              action={<Button><Plus className="h-4 w-4" /> Record contribution</Button>}
              secondaryAction={<Button variant="ghost">Learn how</Button>}
            />
          </CardContent>
        </Card>
        <StatCardsSkeleton />
        <div className="grid gap-4 lg:grid-cols-2">
          <TableSkeleton />
          <ListSkeleton />
        </div>
      </Section>

      {/* Dialogs */}
      <Section id="dialogs" title="Confirmation UX for money actions">
        <Card>
          <CardContent className="flex flex-wrap gap-2 p-6">
            <Button variant="outline" onClick={() => setConfirmOpen(true)}>Open confirm dialog</Button>
            <Button onClick={() => setMoneyOpen(true)}>Open money action dialog</Button>
          </CardContent>
        </Card>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          variant="danger"
          title="Suspend this member?"
          description="They will lose access until reactivated. Existing balances are unaffected."
          confirmLabel="Suspend member"
          onConfirm={() => new Promise((r) => setTimeout(r, 800))}
        />
        <MoneyActionDialog
          open={moneyOpen}
          onOpenChange={setMoneyOpen}
          title="Disburse loan"
          amount={50000}
          details={[
            { label: 'Recipient', value: 'Jane Wanjiku' },
            { label: 'M-Pesa', value: '+254 712 •• 345' },
            { label: 'Processing fee', value: 'KES 0' },
          ]}
          warning="Loan disbursements cannot be reversed once sent."
          onConfirm={() => new Promise((r) => setTimeout(r, 1000))}
        />
      </Section>

      {/* Tabs */}
      <Section id="tabs" title="Tabs">
        <Card>
          <CardContent className="p-6">
            <Tabs defaultValue="tab1">
              <TabsList>
                <TabsTrigger value="tab1">Tab one</TabsTrigger>
                <TabsTrigger value="tab2">Tab two</TabsTrigger>
                <TabsTrigger value="tab3">Tab three</TabsTrigger>
              </TabsList>
              <TabsContent value="tab1" className="mt-4 text-sm text-muted-foreground">
                Content for tab one — use for switching between related datasets or views.
              </TabsContent>
              <TabsContent value="tab2" className="mt-4 text-sm text-muted-foreground">
                Content for tab two — maintains scroll position and form state between switches.
              </TabsContent>
              <TabsContent value="tab3" className="mt-4 text-sm text-muted-foreground">
                Content for tab three — keyboard accessible (arrow keys + Home/End).
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </Section>

      {/* Select */}
      <Section id="select" title="Select dropdown">
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col gap-6">
              <div className="max-w-xs">
                <label className="mb-2 block text-sm font-medium text-foreground">Choose an option</label>
                <Select defaultValue="option1">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="option1">First option</SelectItem>
                    <SelectItem value="option2">Second option</SelectItem>
                    <SelectItem value="option3">Third option</SelectItem>
                    <SelectItem value="option4" disabled>Disabled option</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* Tables */}
      <Section id="tables" title="Paginated table">
        <Card>
          <CardContent className="p-0">
            <PaginatedTable
              data={singlePage([
                { id: '1', name: 'Jane Wanjiku', email: 'jane@example.com', status: 'active', amount: 'KES 15,000' },
                { id: '2', name: 'John Kipchoge', email: 'john@example.com', status: 'active', amount: 'KES 8,500' },
                { id: '3', name: 'Mary Ochieng', email: 'mary@example.com', status: 'paused', amount: 'KES 22,000' },
              ])}
              isLoading={false}
              columns={[
                { key: 'name', header: 'Name', render: (row) => <p className="font-medium">{row.name}</p> },
                { key: 'email', header: 'Email', render: (row) => <p className="text-sm text-muted-foreground">{row.email}</p> },
                { key: 'status', header: 'Status', render: (row) => <StatusPill status={row.status} tone={row.status === 'active' ? 'positive' : 'neutral'} size="sm" /> },
                { key: 'amount', header: 'Balance', render: (row) => <p className="text-right font-mono text-sm">{row.amount}</p> },
              ]}
              onPageChange={() => {}}
              emptyMessage="No data"
            />
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground">
          Shows paginated data with responsive column hiding, error states, and loading skeletons. Handles permission denials and fetch failures with semantic <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">isError</code> variant.
        </p>
      </Section>

      {/* Layout shells */}
      <Section id="shells" title="Portal layout shells">
        <Card>
          <CardContent className="space-y-4 p-6">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">PortalSidebar + TopBar</h3>
              <p className="text-sm text-muted-foreground">
                Standardized layout for all authenticated portals (dashboard, admin, enterprise, member, reminder). Sidebar handles navigation, TopBar shows breadcrumbs/actions. See <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">components/shared/portal-sidebar.tsx</code>.
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">SiteHeader + SiteFooter</h3>
              <p className="text-sm text-muted-foreground">
                Marketing pages (public routes). Wraps each page with navigation and footer. See <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">components/marketing/site-header.tsx</code>.
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">PageShell</h3>
              <p className="text-sm text-muted-foreground">
                Legacy wrapper; most marketing pages now use SiteHeader/SiteFooter directly. Still used in a few places for compatibility.
              </p>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* Form components */}
      <Section id="forms" title="Form components (helpers)">
        <Card>
          <CardContent className="space-y-6 p-6">
            <div>
              <h3 className="mb-3 text-sm font-semibold text-foreground">FormSection</h3>
              <div className="space-y-3">
                <FormSection label="Email address" required hint="We'll never share your email">
                  <Input placeholder="jane@example.com" />
                </FormSection>
                <FormSection label="Phone" error="Invalid format">
                  <Input placeholder="+254 712 345 678" />
                </FormSection>
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-foreground">FormFieldGroup</h3>
              <FormFieldGroup columns={2}>
                <FormSection label="First name" required>
                  <Input placeholder="Jane" />
                </FormSection>
                <FormSection label="Last name" required>
                  <Input placeholder="Wanjiku" />
                </FormSection>
              </FormFieldGroup>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-foreground">FormDivider</h3>
              <FormDivider label="Contact information" />
            </div>
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground">
          Standardized form field wrappers for Label + Input/Select/Textarea. Use <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">FormSection</code> for individual fields with optional error/hint, <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">FormFieldGroup</code> for side-by-side fields, and <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">FormDivider</code> to separate form sections.
        </p>
      </Section>

      {/* Page structure components */}
      <Section id="page-structure" title="Page structure components (helpers)">
        <Card>
          <CardContent className="space-y-6 p-6">
            <div>
              <h3 className="mb-3 text-sm font-semibold text-foreground">PageSection</h3>
              <PageSection
                title="Account settings"
                description="Manage your profile and preferences"
                action={<Button size="sm">Edit</Button>}
              >
                <p className="text-sm text-muted-foreground">Content area with consistent Card wrapper and padding.</p>
              </PageSection>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-foreground">FormActions</h3>
              <div className="rounded-md border p-4 bg-muted/30">
                <p className="text-sm text-muted-foreground mb-4">Bottom of form with consistent spacing:</p>
                <FormActions>
                  <Button variant="outline">Cancel</Button>
                  <Button>Save changes</Button>
                </FormActions>
              </div>
            </div>
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground">
          Page layout wrappers for consistent structure. <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">PageSection</code> wraps content areas in Card with optional title/description/action. <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">FormActions</code> groups buttons at the bottom with separator and consistent alignment options.
        </p>
      </Section>
    </div>
  );
}
