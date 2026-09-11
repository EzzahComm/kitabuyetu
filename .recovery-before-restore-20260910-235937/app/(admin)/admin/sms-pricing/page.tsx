'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Coins } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionHeader } from '@/components/dashboard/sms/shared';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  useSmsPricingConfig, useActivateSmsTiers, useSetSmsProviderCost, useSmsMargin,
  useAdminTopUpOrganizationSmsCredits, useSetOrganizationSmsRate,
} from '@/hooks/use-admin';
import { getErrorMessage, formatKES } from '@/lib/utils';

/**
 * Super-admin SMS pricing (spec §12).
 *
 * Unlike the tenant surface, this one uses the real vocabulary — bands,
 * provider cost, margin — because §18's plain-language rule is about not making
 * customers understand billing internals, not about hiding them from the people
 * whose job is to set them.
 *
 * The margin column is the point of the screen: §19 says not to assume a price
 * is sustainable, so every band shows what it actually earns BEFORE anyone
 * makes it live.
 */

/**
 * Row shapes are NOT redeclared here. They come from the hooks, which derive
 * them from `sms-pricing-admin.service.ts`'s own return types — a local copy is
 * how a screen ends up rendering fields the server stopped sending.
 */
export default function SmsPricingPage() {
  const { toast } = useToast();
  const [newCost, setNewCost] = useState('');

  const { data, isLoading } = useSmsPricingConfig();
  const activate = useActivateSmsTiers();
  const saveCost = useSetSmsProviderCost();
  const { data: margin, isLoading: marginLoading } = useSmsMargin();

  const topUpOrg = useAdminTopUpOrganizationSmsCredits();
  const setOrgRate = useSetOrganizationSmsRate();
  const [topUpTarget, setTopUpTarget] = useState<{ id: string; name: string } | null>(null);
  const [rateTarget, setRateTarget]   = useState<{ id: string; name: string } | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [newRate, setNewRate]         = useState('');

  const cost = data?.providerCost ? Number(data.providerCost.unit_cost) : null;
  /** What a band earns per message. Null when no provider cost is on record. */
  const marginOf = (price: number) => (cost === null ? null : price - cost);

  const tiersNamed = (pred: (name: string) => boolean) =>
    (data?.tiers ?? []).filter((t) => pred(t.name)).map((t) => t.id);

  const handleSaveCost = () =>
    saveCost.mutate(Number(newCost), {
      onSuccess: () => { setNewCost(''); toast({ title: 'Provider cost recorded' }); },
      onError:   (e) => toast({ variant: 'destructive', title: 'Could not save cost', description: getErrorMessage(e) }),
    });

  /**
   * An empty `tierIds` is schema-legal and means "deactivate everything", which
   * would leave custom quantities unpriced. Before the fetch resolves, or if a
   * band gets renamed, `tiersNamed()` legitimately returns [] — so a click that
   * lands early would send exactly that. Refusing it here means the only way to
   * clear the live set is to mean it.
   */
  const handleActivate = (tierIds: string[]) => {
    if (!tierIds.length) {
      toast({
        variant: 'destructive',
        title: 'No matching bands',
        description: isLoading ? 'Still loading the price list — try again in a moment.' : 'Nothing was activated.',
      });
      return;
    }
    activate.mutate(tierIds, {
      onSuccess: () => toast({ title: 'Price list updated' }),
      onError:   (e) => toast({ variant: 'destructive', title: 'Could not switch price list', description: getErrorMessage(e) }),
    });
  };

  const handleTopUp = () => {
    if (!topUpTarget) return;
    topUpOrg.mutate(
      { organizationId: topUpTarget.id, amountKes: Number(topUpAmount) },
      {
        onSuccess: (r) => {
          toast({ title: 'SMS credits added', description: `${r.creditsAdded.toLocaleString()} credits — new balance ${r.newBalance.toLocaleString()}.` });
          setTopUpTarget(null); setTopUpAmount('');
        },
        onError: (e) => toast({ variant: 'destructive', title: 'Top-up failed', description: getErrorMessage(e) }),
      },
    );
  };

  const handleSetRate = () => {
    if (!rateTarget) return;
    setOrgRate.mutate(
      { organizationId: rateTarget.id, rate: Number(newRate) },
      {
        onSuccess: () => {
          toast({ title: 'Rate updated' });
          setRateTarget(null); setNewRate('');
        },
        onError: (e) => toast({ variant: 'destructive', title: 'Could not save rate', description: getErrorMessage(e) }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="SMS Pricing"
        description="What customers pay per message, and what each band earns. Internal — provider cost is never shown to customers."
      />

      <Tabs defaultValue="pricing">
        <TabsList>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="revenue">Revenue &amp; Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="pricing" className="space-y-6 pt-4">

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-5">
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Coins size={14} /> Provider cost per SMS (KES)
            </p>
            <p className="text-2xl font-semibold text-foreground">
              {cost !== null ? cost.toFixed(4) : '— not recorded'}
            </p>
            {data?.providerCost && (
              <p className="text-xs text-muted-foreground">
                In force since {new Date(data.providerCost.effective_from).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="ml-auto flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="cost">New cost</Label>
              <Input
                id="cost" className="w-32" inputMode="decimal" placeholder="0.35"
                value={newCost} onChange={(e) => setNewCost(e.target.value)}
              />
            </div>
            <Button
              onClick={handleSaveCost}
              loading={saveCost.isPending}
              disabled={!newCost || Number.isNaN(Number(newCost))}
            >
              Record change
            </Button>
          </div>
        </CardContent>
      </Card>
      <p className="-mt-4 text-xs text-muted-foreground">
        Recording a new cost closes the current one rather than overwriting it, so margin on past
        sales keeps using the cost that applied when they were sold.
      </p>

      <div className="space-y-3">
        <SectionHeader
          title="Price bands"
          subtitle="Only active bands price anything. Activating replaces the whole live set at once."
        />
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Band</th>
                  <th className="px-4 py-3 text-left">Volume</th>
                  <th className="px-4 py-3 text-left">Price</th>
                  <th className="px-4 py-3 text-left">Margin</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
                ) : data?.tiers.map((t) => {
                  const price  = Number(t.unit_price);
                  const margin = marginOf(price);
                  const loss   = margin !== null && margin <= 0;
                  return (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium text-foreground">{t.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {t.min_credits.toLocaleString()}
                        {t.max_credits === null ? '+' : `–${t.max_credits.toLocaleString()}`}
                      </td>
                      <td className="px-4 py-3">{price.toFixed(4)}</td>
                      <td className="px-4 py-3">
                        {margin === null ? (
                          // Unknown is not the same as fine. Saying so beats a
                          // reassuring number nobody can stand behind.
                          <span className="text-muted-foreground">unknown</span>
                        ) : (
                          <span className={loss ? 'font-medium text-destructive' : 'text-foreground'}>
                            {margin.toFixed(4)}
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({price > 0 ? ((margin / price) * 100).toFixed(0) : '0'}%)
                            </span>
                            {loss && <AlertTriangle size={13} className="ml-1 inline text-destructive" />}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {t.is_active
                          ? <Badge className="bg-emerald-600 text-white">Live</Badge>
                          : <Badge variant="outline">Inactive</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            loading={activate.isPending}
            disabled={isLoading || activate.isPending}
            onClick={() => handleActivate(tiersNamed((n) => n === 'Standard'))}
          >
            Use the flat rate
          </Button>
          <Button
            loading={activate.isPending}
            disabled={isLoading || activate.isPending}
            onClick={() => handleActivate(tiersNamed((n) => n.startsWith('Volume')))}
          >
            Switch to volume pricing
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The whole set changes in one step. If the chosen bands overlap, nothing changes at all —
          a half-applied price list would leave some volumes unpriced.
        </p>
      </div>

      <div className="space-y-3">
        <SectionHeader title="Packages" subtitle="Fixed bundles customers can buy." />
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Package</th>
                  <th className="px-4 py-3 text-left">Credits</th>
                  <th className="px-4 py-3 text-left">Price</th>
                  <th className="px-4 py-3 text-left">Effective rate</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.packages.map((p) => {
                  const price = Number(p.price);
                  const per   = p.credits > 0 ? price / p.credits : 0;
                  return (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {p.name}
                        {p.is_recommended && <CheckCircle2 size={13} className="ml-1 inline text-brand-600" />}
                      </td>
                      <td className="px-4 py-3">{p.credits.toLocaleString()}</td>
                      <td className="px-4 py-3">KES {price.toLocaleString()}</td>
                      <td className="px-4 py-3 text-muted-foreground">{per.toFixed(4)}/SMS</td>
                      <td className="px-4 py-3">
                        {p.is_active
                          ? <Badge className="bg-emerald-600 text-white">On sale</Badge>
                          : <Badge variant="outline">Not on sale</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

        </TabsContent>

        <TabsContent value="revenue" className="space-y-6 pt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue</p>
                <p className="text-xl font-semibold text-foreground">
                  {marginLoading ? '—' : formatKES(margin?.summary.revenue ?? 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Provider cost</p>
                <p className="text-xl font-semibold text-foreground">
                  {marginLoading ? '—' : formatKES(margin?.summary.providerCost ?? 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gross margin</p>
                <p className={`text-xl font-semibold ${(margin?.summary.grossMargin ?? 0) < 0 ? 'text-destructive' : 'text-foreground'}`}>
                  {marginLoading ? '—' : formatKES(margin?.summary.grossMargin ?? 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Margin %</p>
                <p className="text-xl font-semibold text-foreground">
                  {marginLoading || margin?.summary.marginPct === null || margin?.summary.marginPct === undefined
                    ? '—' : `${margin.summary.marginPct.toFixed(1)}%`}
                </p>
              </CardContent>
            </Card>
          </div>
          {!marginLoading && (margin?.summary.creditsWithoutCost ?? 0) > 0 && (
            <p className="-mt-3 flex items-center gap-1.5 text-xs text-amber-600">
              <AlertTriangle size={13} />
              {margin!.summary.creditsWithoutCost.toLocaleString()} sold credits have no recorded provider cost for
              their period — margin above is understated by whatever those cost.
            </p>
          )}

          <div className="space-y-3">
            <SectionHeader
              title="SMS by group"
              subtitle="Every group, highest revenue first. A group that has only ever sent on its bundled allowance shows revenue of zero, not a missing row."
            />
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Group</th>
                      <th className="px-4 py-3 text-left">Credits purchased</th>
                      <th className="px-4 py-3 text-left">Revenue</th>
                      <th className="px-4 py-3 text-left">Credits consumed</th>
                      <th className="px-4 py-3 text-left">Gross margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marginLoading ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
                    ) : !margin?.topCustomers.length ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No groups yet.</td></tr>
                    ) : margin.topCustomers.map((g) => (
                      <tr key={g.groupId} className="border-b last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{g.groupName}</p>
                          <p className="text-xs text-muted-foreground">{g.groupCode}</p>
                        </td>
                        <td className="px-4 py-3">{g.creditsSold.toLocaleString()}</td>
                        <td className="px-4 py-3">{formatKES(g.revenue)}</td>
                        <td className="px-4 py-3">{g.creditsConsumed.toLocaleString()}</td>
                        <td className={`px-4 py-3 ${g.grossMargin < 0 ? 'text-destructive' : ''}`}>
                          {formatKES(g.grossMargin)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <SectionHeader
              title="SMS by organization"
              subtitle="Credits an organization pays for centrally on a group's behalf (payer_organization_id), separate from the group's own purchases above."
            />
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Organization</th>
                      <th className="px-4 py-3 text-left">Credits consumed</th>
                      <th className="px-4 py-3 text-left">Current balance</th>
                      <th className="px-4 py-3 text-left">Credits purchased</th>
                      <th className="px-4 py-3 text-left">Revenue</th>
                      <th className="px-4 py-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marginLoading ? (
                      <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
                    ) : !margin?.byOrganization.length ? (
                      <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No organizations yet.</td></tr>
                    ) : margin.byOrganization.map((o) => (
                      <tr key={o.organizationId} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium text-foreground">{o.organizationName}</td>
                        <td className="px-4 py-3">{o.creditsConsumed.toLocaleString()}</td>
                        <td className="px-4 py-3">{o.currentBalance.toLocaleString()}</td>
                        <td className="px-4 py-3">{o.creditsPurchased.toLocaleString()}</td>
                        <td className="px-4 py-3">{formatKES(o.revenue)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            <Button
                              size="sm" variant="outline" className="h-7 px-2 text-xs"
                              onClick={() => setTopUpTarget({ id: o.organizationId, name: o.organizationName })}
                            >
                              Top up
                            </Button>
                            <Button
                              size="sm" variant="outline" className="h-7 px-2 text-xs"
                              onClick={() => setRateTarget({ id: o.organizationId, name: o.organizationName })}
                            >
                              Set rate
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">
              Organizations have no real-time M-Pesa collection today — a top-up here (or one the
              organization&apos;s own coordinator records in the Funding Portal) is a manual entry, trusted the
              same way a group&apos;s general capital deposit already is. &quot;Set rate&quot; controls the
              negotiated per-SMS price a top-up&apos;s credits are computed at.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {/* Top up an organization's SMS credits — super_admin correcting/granting a
          balance, previously impossible: there was no admin tool for this at all. */}
      <Dialog open={!!topUpTarget} onOpenChange={(o) => { if (!o) setTopUpTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Top up {topUpTarget?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Amount (KES)</Label>
              <Input
                type="number" min={1} value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)} placeholder="5000"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Credits are computed at this organization&apos;s current negotiated rate. Recorded as a manual
              top-up — no M-Pesa payment is collected here.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopUpTarget(null)}>Cancel</Button>
            <Button
              onClick={handleTopUp} loading={topUpOrg.isPending}
              disabled={!topUpAmount || Number.isNaN(Number(topUpAmount)) || Number(topUpAmount) <= 0}
            >
              Add credits
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set an organization's negotiated per-SMS rate — the column has existed
          since migration 051 but nothing has ever written to it before this. */}
      <Dialog open={!!rateTarget} onOpenChange={(o) => { if (!o) setRateTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Set SMS rate for {rateTarget?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Rate (KES per SMS)</Label>
              <Input
                inputMode="decimal" value={newRate}
                onChange={(e) => setNewRate(e.target.value)} placeholder="0.90"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Applies to future top-ups only — past purchases keep the rate they were bought at.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRateTarget(null)}>Cancel</Button>
            <Button
              onClick={handleSetRate} loading={setOrgRate.isPending}
              disabled={!newRate || Number.isNaN(Number(newRate)) || Number(newRate) <= 0}
            >
              Save rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
