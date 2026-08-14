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
import { useToast } from '@/hooks/use-toast';
import { useSmsPricingConfig, useActivateSmsTiers, useSetSmsProviderCost } from '@/hooks/use-admin';
import { getErrorMessage } from '@/lib/utils';

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="SMS Pricing"
        description="What customers pay per message, and what each band earns. Internal — provider cost is never shown to customers."
      />

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
    </div>
  );
}
