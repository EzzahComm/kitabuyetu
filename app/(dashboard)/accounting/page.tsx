'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccounts, useJournals, useTrialBalance, useProfitAndLoss, useBalanceSheet, useCreateJournal } from '@/hooks/use-accounting';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate } from '@/lib/utils';
import { Plus, Trash2 } from 'lucide-react';

interface JournalLine { accountId: string; debit: number; credit: number; description: string }

export default function AccountingPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState('trial');
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<JournalLine[]>([
    { accountId: '', debit: 0, credit: 0, description: '' },
    { accountId: '', debit: 0, credit: 0, description: '' },
  ]);
  const [memo, setMemo] = useState('');

  const now = new Date();
  const from = `${now.getFullYear()}-01-01`;
  const to   = `${now.getFullYear()}-12-31`;

  const { data: accounts, isLoading: loadingAccounts } = useAccounts();
  const { data: trialBalance, isLoading: loadingTB }   = useTrialBalance();
  const { data: journals, isLoading: loadingJournals } = useJournals({ page: 1, pageSize: 20 });
  const { data: pnl, isLoading: loadingPnl }           = useProfitAndLoss(from, to);
  const asOfToday = now.toISOString().split('T')[0];
  const { data: balanceSheet, isLoading: loadingBS }   = useBalanceSheet(asOfToday);
  const createJournal = useCreateJournal();

  const totalDebits  = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (l.credit || 0), 0);
  const balanced     = Math.abs(totalDebits - totalCredits) < 0.01 && totalDebits > 0;

  const handleSubmitJournal = async () => {
    if (!balanced) { toast({ variant: 'destructive', title: 'Journal must balance (debits = credits)' }); return; }
    try {
      await createJournal.mutateAsync({ memo, lines: lines.filter((l) => l.accountId) });
      toast({ title: 'Journal entry posted' });
      setOpen(false);
      setLines([{ accountId:'',debit:0,credit:0,description:'' },{ accountId:'',debit:0,credit:0,description:'' }]);
      setMemo('');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed', description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Accounting</h1>
          <p className="text-sm text-muted-foreground">Double-entry bookkeeping</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus size={16} className="mr-2"/> New journal</Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="trial">Trial Balance</TabsTrigger>
          <TabsTrigger value="journals">Journal Entries</TabsTrigger>
          <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
          <TabsTrigger value="balance">Balance Sheet</TabsTrigger>
          <TabsTrigger value="accounts">Chart of Accounts</TabsTrigger>
        </TabsList>

        <TabsContent value="trial" className="mt-4">
          {loadingTB ? <Skeleton className="h-64 w-full"/> : (
            <Card>
              <CardHeader><CardTitle className="text-base">Trial Balance</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Code','Account','Type','Debit','Credit'].map((h)=>(
                        <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {((trialBalance as any[]) ?? []).map((row: any) => (
                      <tr key={row.id} className="border-t hover:bg-muted/20">
                        <td className="px-4 py-2 font-mono text-xs">{row.accountCode}</td>
                        <td className="px-4 py-2">{row.accountName}</td>
                        <td className="px-4 py-2 capitalize text-xs"><Badge variant="outline">{row.accountType}</Badge></td>
                        <td className="px-4 py-2 text-right">{row.debitBalance > 0 ? formatKES(row.debitBalance) : '—'}</td>
                        <td className="px-4 py-2 text-right">{row.creditBalance > 0 ? formatKES(row.creditBalance) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="journals" className="mt-4">
          {loadingJournals ? <Skeleton className="h-64 w-full"/> : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Date','Reference','Memo','Status','Lines'].map((h)=>(
                        <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {((journals as any)?.items ?? []).map((j: any) => (
                      <tr key={j.id} className="border-t hover:bg-muted/20">
                        <td className="px-4 py-2">{formatDate(j.entryDate ?? j.createdAt)}</td>
                        <td className="px-4 py-2 font-mono text-xs">{j.reference ?? j.id.slice(0,8)}</td>
                        <td className="px-4 py-2 max-w-[200px] truncate">{j.memo ?? '—'}</td>
                        <td className="px-4 py-2"><Badge variant={j.status==='posted'?'success':'warning'} className="capitalize text-xs">{j.status}</Badge></td>
                        <td className="px-4 py-2">{j.lineCount ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="pnl" className="mt-4">
          {loadingPnl ? <Skeleton className="h-64 w-full"/> : (
            <Card>
              <CardHeader><CardTitle className="text-base">Profit &amp; Loss — {now.getFullYear()}</CardTitle></CardHeader>
              <CardContent>
                <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(pnl, null, 2)}</pre>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="balance" className="mt-4">
          {loadingBS ? <Skeleton className="h-64 w-full"/> : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Balance Sheet — as of {balanceSheet ? formatDate((balanceSheet as any).asOf) : ''}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="bg-muted/50"><td colSpan={2} className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Assets</td></tr>
                    {(((balanceSheet as any)?.assets ?? []) as any[]).map((a) => (
                      <tr key={a.accountCode} className="border-t hover:bg-muted/20">
                        <td className="px-4 py-2">{a.accountName}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(a.balance))}</td>
                      </tr>
                    ))}
                    <tr className="border-t font-semibold"><td className="px-4 py-2">Total Assets</td><td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat((balanceSheet as any)?.totalAssets ?? '0'))}</td></tr>

                    <tr className="bg-muted/50"><td colSpan={2} className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Liabilities</td></tr>
                    {(((balanceSheet as any)?.liabilities ?? []) as any[]).map((a) => (
                      <tr key={a.accountCode} className="border-t hover:bg-muted/20">
                        <td className="px-4 py-2">{a.accountName}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(a.balance))}</td>
                      </tr>
                    ))}
                    <tr className="border-t font-semibold"><td className="px-4 py-2">Total Liabilities</td><td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat((balanceSheet as any)?.totalLiabilities ?? '0'))}</td></tr>

                    <tr className="bg-muted/50"><td colSpan={2} className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Equity</td></tr>
                    {(((balanceSheet as any)?.equity ?? []) as any[]).map((a) => (
                      <tr key={a.accountCode} className="border-t hover:bg-muted/20">
                        <td className="px-4 py-2">{a.accountName}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(a.balance))}</td>
                      </tr>
                    ))}
                    <tr className="border-t font-semibold"><td className="px-4 py-2">Total Equity</td><td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat((balanceSheet as any)?.totalEquity ?? '0'))}</td></tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="accounts" className="mt-4">
          {loadingAccounts ? <Skeleton className="h-64 w-full"/> : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Code','Name','Type','Balance'].map((h)=>(
                        <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {((accounts as any[]) ?? []).map((a: any) => (
                      <tr key={a.id} className="border-t hover:bg-muted/20">
                        <td className="px-4 py-2 font-mono text-xs">{a.accountCode}</td>
                        <td className="px-4 py-2">{a.accountName}</td>
                        <td className="px-4 py-2 capitalize"><Badge variant="outline" className="text-xs">{a.accountType}</Badge></td>
                        <td className="px-4 py-2 text-right font-mono">{formatKES(a.balance ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New Journal Entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Memo</Label>
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Description of transaction…"/>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left pb-2 pr-2">Account</th>
                  <th className="text-right pb-2 px-2 w-28">Debit</th>
                  <th className="text-right pb-2 px-2 w-28">Credit</th>
                  <th className="w-8"/>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx}>
                    <td className="pr-2 pb-2">
                      <select
                        value={line.accountId}
                        onChange={(e) => { const nl=[...lines]; nl[idx]={...nl[idx],accountId:e.target.value}; setLines(nl); }}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                      >
                        <option value="">Select account…</option>
                        {((accounts as any[]) ?? []).map((a:any)=>(
                          <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 pb-2">
                      <Input type="number" step="0.01" className="text-right h-9 w-28" value={line.debit || ''} onChange={(e)=>{const nl=[...lines];nl[idx]={...nl[idx],debit:+e.target.value,credit:0};setLines(nl);}}/>
                    </td>
                    <td className="px-2 pb-2">
                      <Input type="number" step="0.01" className="text-right h-9 w-28" value={line.credit || ''} onChange={(e)=>{const nl=[...lines];nl[idx]={...nl[idx],credit:+e.target.value,debit:0};setLines(nl);}}/>
                    </td>
                    <td className="pb-2">
                      <Button variant="ghost" size="icon" className="h-10 w-10" aria-label="Remove line" onClick={()=>setLines(lines.filter((_,i)=>i!==idx))}><Trash2 size={14}/></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t text-sm font-semibold">
                  <td className="pt-2">Totals</td>
                  <td className={`pt-2 text-right px-2 ${!balanced?'text-red-600':''}`}>{formatKES(totalDebits)}</td>
                  <td className={`pt-2 text-right px-2 ${!balanced?'text-red-600':''}`}>{formatKES(totalCredits)}</td>
                  <td/>
                </tr>
              </tfoot>
            </table>
            </div>
            <Button variant="outline" size="sm" onClick={()=>setLines([...lines,{accountId:'',debit:0,credit:0,description:''}])}>
              <Plus size={14} className="mr-1"/> Add line
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmitJournal} disabled={!balanced} loading={createJournal.isPending}>Post journal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
