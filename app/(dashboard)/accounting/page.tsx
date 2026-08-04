'use client';

import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccounts, useJournals, useTrialBalance, useProfitAndLoss, useBalanceSheet, useCreateJournal, useFiscalPeriods, useClosePeriod, useReopenPeriod, useApprovalPolicies, useSetApprovalPolicy, usePostingTemplates, useSetPostingTemplate, useCashFlow, useEquityChanges } from '@/hooks/use-accounting';
import { useLoanPolicy, useSetLoanPolicy } from '@/hooks/use-loans';
import { useFinePolicy, useSetFinePolicy } from '@/hooks/use-fines';
import { useSavingsPolicy, useSetSavingsPolicy } from '@/hooks/use-contributions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useHasPermission } from '@/lib/auth/use-permission';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import { Plus, Trash2, Lock, LockOpen, SlidersHorizontal, BookOpen, CalendarClock, ListTree } from 'lucide-react';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { PageHeader } from '@/components/shared/page-header';
import type { Account } from '@/types/db.types';
import type { JournalEntry } from '@/types/api.types';

const POLICY_LABELS: Record<string, string> = {
  journal_threshold:            'Manual journal maker-checker',
  group_disbursement_threshold: 'Disbursement maker-checker',
};

interface JournalLine { accountId: string; debit: number; credit: number; description: string }

export default function AccountingPage() {
  const { toast } = useToast();
  const canManageAccounting = useHasPermission('accounting.manage');
  const [tab, setTab] = useState('trial');
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<JournalLine[]>([
    { accountId: '', debit: 0, credit: 0, description: '' },
    { accountId: '', debit: 0, credit: 0, description: '' },
  ]);
  // CreateJournalSchema requires `entryDate` and `description`; this form used
  // to send `{ memo, lines }` and nothing else, so every submit 400'd. See the
  // handleSubmitJournal comment.
  const [description, setDescription] = useState('');
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));

  const now = new Date();
  const from = `${now.getFullYear()}-01-01`;
  const to   = `${now.getFullYear()}-12-31`;

  const { data: accounts, isLoading: loadingAccounts, isError: errorAccounts, error: accountsError } = useAccounts();
  const { data: trialBalance, isLoading: loadingTB, isError: errorTB, error: tbError }   = useTrialBalance();
  const [journalPage, setJournalPage] = useState(1);
  const { data: journals, isLoading: loadingJournals, isError: errorJournals, error: journalsError } = useJournals({ page: journalPage, pageSize: 20 });
  const { data: pnl, isLoading: loadingPnl, isError: errorPnl, error: pnlError }           = useProfitAndLoss(from, to);
  const asOfToday = now.toISOString().split('T')[0];
  const { data: balanceSheet, isLoading: loadingBS, isError: errorBS, error: bsError }   = useBalanceSheet(asOfToday);
  const { data: cashFlow, isLoading: loadingCF, isError: errorCF, error: cfError }       = useCashFlow(from, to);
  const { data: equityChanges }                        = useEquityChanges(from, to);
  const createJournal = useCreateJournal();

  const { data: fiscalPeriods, isLoading: loadingFP, isError: errorFP, error: fpError } = useFiscalPeriods();
  const closePeriod  = useClosePeriod();
  const reopenPeriod = useReopenPeriod();
  const [closeOpen, setCloseOpen]   = useState(false);
  const [periodStart, setPeriodStart] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
  const [periodEnd, setPeriodEnd]     = useState(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]);
  const [reopenTarget, setReopenTarget] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState('');

  const { data: policies, isLoading: loadingPolicies, isError: errorPolicies, error: policiesError } = useApprovalPolicies();
  const setPolicy = useSetApprovalPolicy();
  const [policyEdits, setPolicyEdits] = useState<Record<string, string>>({});

  const totalDebits  = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (l.credit || 0), 0);
  const balanced     = Math.abs(totalDebits - totalCredits) < 0.01 && totalDebits > 0;

  /**
   * Found by the post-M3 client/server contract sweep. This used to post
   * `{ memo, lines }`, but `CreateJournalSchema` (lib/validators/accounting.schema.ts)
   * requires `entryDate` (a date string) and `description` (min 3) and knows
   * nothing about `memo` — so **every "Post journal" click 400'd**. Manual
   * journal entry has never worked from this UI. It went unnoticed because
   * `accountingApi.createJournal` takes `body: unknown`, so TypeScript could
   * not compare the payload against the schema; the typed `CreateJournalInput`
   * below is what stops this recurring.
   */
  const handleSubmitJournal = async () => {
    if (!balanced) { toast({ variant: 'destructive', title: 'Journal must balance (debits = credits)' }); return; }
    const payloadLines = lines.filter((l) => l.accountId);
    // Schema floor is 2 lines. The filter above drops rows with no account
    // picked, so a visually-complete 2-row form can still submit only 1.
    if (payloadLines.length < 2) {
      toast({ variant: 'destructive', title: 'Pick an account on at least 2 lines' });
      return;
    }
    if (description.trim().length < 3) {
      toast({ variant: 'destructive', title: 'Add a description', description: 'At least 3 characters.' });
      return;
    }
    try {
      await createJournal.mutateAsync({
        entryDate,
        description: description.trim(),
        lines: payloadLines.map((l) => ({
          accountId:   l.accountId,
          debit:       l.debit,
          credit:      l.credit,
          description: l.description || null,
        })),
      });
      toast({ title: 'Journal entry posted' });
      setOpen(false);
      setLines([{ accountId:'',debit:0,credit:0,description:'' },{ accountId:'',debit:0,credit:0,description:'' }]);
      setDescription('');
      setEntryDate(new Date().toISOString().slice(0, 10));
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting"
        description="Double-entry bookkeeping"
        actions={canManageAccounting ? (
          <Button onClick={() => setOpen(true)}><Plus size={16} className="mr-2"/> New journal</Button>
        ) : undefined}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="trial">Trial Balance</TabsTrigger>
          <TabsTrigger value="journals">Journal Entries</TabsTrigger>
          <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
          <TabsTrigger value="balance">Balance Sheet</TabsTrigger>
          <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
          <TabsTrigger value="periods">Fiscal Periods</TabsTrigger>
          <TabsTrigger value="accounts">Chart of Accounts</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
        </TabsList>

        <TabsContent value="trial" className="mt-4">
          {errorTB ? <p className="text-sm text-destructive">{getErrorMessage(tbError)}</p> : loadingTB ? <Skeleton className="h-64 w-full"/> : (
            <Card>
              <CardHeader><CardTitle className="text-base">Trial Balance</CardTitle></CardHeader>
              <CardContent className="p-0">
                <PaginatedTable
                  data={singlePage((trialBalance ?? []).map((line) => ({ ...line, id: line.accountCode })))}
                  isLoading={loadingTB}
                  onPageChange={() => {}}
                  emptyMessage="No trial balance data"
                  columns={[
                    { key: 'accountCode', header: 'Code', render: (row) => <span className="font-mono text-xs">{row.accountCode}</span> },
                    { key: 'accountName', header: 'Account' },
                    { key: 'accountType', header: 'Type', className: 'capitalize text-xs', render: (row) => <Badge variant="outline">{row.accountType}</Badge> },
                    { key: 'totalDebits', header: 'Debit', className: 'text-right', render: (row) => { const debit = parseFloat(row.totalDebits); return debit > 0 ? formatKES(debit) : '—'; } },
                    { key: 'totalCredits', header: 'Credit', className: 'text-right', render: (row) => { const credit = parseFloat(row.totalCredits); return credit > 0 ? formatKES(credit) : '—'; } },
                  ]}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="journals" className="mt-4">
          <PaginatedTable<JournalEntry>
            data={journals}
            isLoading={loadingJournals}
            isError={errorJournals}
            error={journalsError}
            onPageChange={setJournalPage}
            emptyMessage="No journal entries yet"
            emptyIcon={BookOpen}
            emptyDescription="Post your first entry with the New journal button above."
            columns={[
              { key: 'entryDate', header: 'Date', render: (j) => formatDate(j.entryDate) },
              { key: 'reference', header: 'Reference', render: (j) => <span className="font-mono text-xs">{j.reference ?? j.id.slice(0,8)}</span> },
              { key: 'memo', header: 'Memo', className: 'max-w-[200px] truncate', render: (j) => j.memo ?? '—' },
              { key: 'status', header: 'Status', render: (j) => <Badge variant={j.status==='posted'?'success':'warning'} className="capitalize text-xs">{j.status}</Badge> },
              { key: 'lineCount', header: 'Lines' },
            ]}
          />
        </TabsContent>

        <TabsContent value="pnl" className="mt-4">
          {errorPnl ? <p className="text-sm text-destructive">{getErrorMessage(pnlError)}</p> : loadingPnl ? <Skeleton className="h-64 w-full"/> : (
            <Card>
              <CardHeader><CardTitle className="text-base">Profit &amp; Loss — {now.getFullYear()}</CardTitle></CardHeader>
              <CardContent>
                <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(pnl, null, 2)}</pre>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="balance" className="mt-4">
          {errorBS ? <p className="text-sm text-destructive">{getErrorMessage(bsError)}</p> : loadingBS ? <Skeleton className="h-64 w-full"/> : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Balance Sheet — as of {balanceSheet ? formatDate(balanceSheet.asOf) : ''}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="bg-muted/50"><td colSpan={2} className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Assets</td></tr>
                    {(balanceSheet?.assets ?? []).map((a) => (
                      <tr key={a.accountCode} className="border-t hover:bg-muted/20">
                        <td className="px-4 py-2">{a.accountName}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(a.balance))}</td>
                      </tr>
                    ))}
                    <tr className="border-t font-semibold"><td className="px-4 py-2">Total Assets</td><td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(balanceSheet?.totalAssets ?? '0'))}</td></tr>

                    <tr className="bg-muted/50"><td colSpan={2} className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Liabilities</td></tr>
                    {(balanceSheet?.liabilities ?? []).map((a) => (
                      <tr key={a.accountCode} className="border-t hover:bg-muted/20">
                        <td className="px-4 py-2">{a.accountName}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(a.balance))}</td>
                      </tr>
                    ))}
                    <tr className="border-t font-semibold"><td className="px-4 py-2">Total Liabilities</td><td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(balanceSheet?.totalLiabilities ?? '0'))}</td></tr>

                    <tr className="bg-muted/50"><td colSpan={2} className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Equity</td></tr>
                    {(balanceSheet?.equity ?? []).map((a) => (
                      <tr key={a.accountCode} className="border-t hover:bg-muted/20">
                        <td className="px-4 py-2">{a.accountName}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(a.balance))}</td>
                      </tr>
                    ))}
                    <tr className="border-t font-semibold"><td className="px-4 py-2">Total Equity</td><td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(balanceSheet?.totalEquity ?? '0'))}</td></tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Statement of Changes in Equity — audit §12 */}
          {equityChanges ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">Statement of Changes in Equity — {now.getFullYear()}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Movement per equity account this year. The period&apos;s net surplus of{' '}
                  <span className="font-mono">{formatKES(parseFloat(equityChanges.periodNetProfit))}</span>{' '}
                  remains in income/expense accounts until a closing entry moves it to Retained Surplus.
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Account','Opening','Increases','Decreases','Closing'].map((h, i)=>(
                        <th key={h} className={`px-4 py-2 text-xs font-medium text-muted-foreground ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {equityChanges.lines.map((l) => (
                      <tr key={l.accountCode} className="border-t hover:bg-muted/20">
                        <td className="px-4 py-2">{l.accountName}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(l.opening))}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(l.increases))}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(l.decreases))}</td>
                        <td className="px-4 py-2 text-right font-mono font-semibold">{formatKES(parseFloat(l.closing))}</td>
                      </tr>
                    ))}
                    <tr className="border-t font-semibold">
                      <td className="px-4 py-2">Total</td>
                      <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(equityChanges.totalOpening))}</td>
                      <td className="px-4 py-2" colSpan={2}/>
                      <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(equityChanges.totalClosing))}</td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="cashflow" className="mt-4">
          {errorCF ? <p className="text-sm text-destructive">{getErrorMessage(cfError)}</p> : loadingCF ? <Skeleton className="h-64 w-full"/> : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cash Flow Statement — {now.getFullYear()}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Direct method over the Cash and Bank accounts. Member lending
                  is classified as operating — it is the group&apos;s principal
                  revenue-producing activity.
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <tbody>
                    {([['Operating activities','operating','netOperating'],
                       ['Investing activities','investing','netInvesting'],
                       ['Financing activities','financing','netFinancing']] as const).map(([label, key, netKey]) => (
                      <React.Fragment key={key}>
                        <tr className="bg-muted/50"><td colSpan={2} className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">{label}</td></tr>
                        {(cashFlow?.[key] ?? []).length === 0 ? (
                          <tr className="border-t"><td colSpan={2} className="px-4 py-2 text-muted-foreground">No movements</td></tr>
                        ) : (cashFlow?.[key] ?? []).map((l) => (
                          <tr key={l.accountCode} className="border-t hover:bg-muted/20">
                            <td className="px-4 py-2">{l.accountName}</td>
                            <td className={`px-4 py-2 text-right font-mono ${parseFloat(l.amount) < 0 ? 'text-destructive' : ''}`}>
                              {formatKES(parseFloat(l.amount))}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t font-semibold">
                          <td className="px-4 py-2">Net cash from {label.toLowerCase()}</td>
                          <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(cashFlow?.[netKey] ?? '0'))}</td>
                        </tr>
                      </React.Fragment>
                    ))}
                    <tr className="bg-muted/50 font-semibold">
                      <td className="px-4 py-2">Net change in cash</td>
                      <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(cashFlow?.netChange ?? '0'))}</td>
                    </tr>
                    <tr className="border-t">
                      <td className="px-4 py-2">Opening cash</td>
                      <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(cashFlow?.openingCash ?? '0'))}</td>
                    </tr>
                    <tr className="border-t font-semibold">
                      <td className="px-4 py-2">Closing cash</td>
                      <td className="px-4 py-2 text-right font-mono">{formatKES(parseFloat(cashFlow?.closingCash ?? '0'))}</td>
                    </tr>
                    {cashFlow && !cashFlow.reconciles && (
                      <tr className="border-t">
                        <td colSpan={2} className="px-4 py-2 text-xs text-destructive">
                          Opening + net change does not equal closing — some cash movement could not be classified. Contact support.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="periods" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Fiscal Periods</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Closing a period blocks new manual journal entries dated inside it. Automated postings from real M-Pesa events are never blocked.
                </p>
              </div>
              {canManageAccounting && (
                <Button size="sm" onClick={() => setCloseOpen(true)}><Lock size={15} className="mr-2"/> Close a period</Button>
              )}
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <PaginatedTable
                data={singlePage(fiscalPeriods)}
                isLoading={loadingFP}
                isError={errorFP}
                error={fpError}
                onPageChange={() => {}}
                emptyMessage="No periods closed yet"
                emptyIcon={CalendarClock}
                emptyDescription="Every date is open for posting."
                columns={[
                  { key: 'period', header: 'Period', render: (p) => <span className="font-mono text-xs">{formatDate(p.period_start)} – {formatDate(p.period_end)}</span> },
                  { key: 'status', header: 'Status', render: (p) => <Badge variant={p.status === 'closed' ? 'destructive' : 'success'} className="text-xs capitalize">{p.status}</Badge> },
                  { key: 'closed_by', header: 'Closed by', render: (p) => <span className="text-xs text-muted-foreground">{p.closed_by ?? '—'}</span> },
                  { key: 'closed_at', header: 'Closed at', render: (p) => <span className="text-xs text-muted-foreground">{p.closed_at ? formatDate(p.closed_at) : '—'}</span> },
                  { key: 'reopen_reason', header: 'Reopen reason', render: (p) => <span className="text-xs text-muted-foreground">{p.reopen_reason ?? '—'}</span> },
                  { key: 'actions', header: '', className: 'text-right', render: (p) => (p.status === 'closed' && canManageAccounting) ? (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => { setReopenTarget(p.id); setReopenReason(''); }}>
                      <LockOpen size={13}/> Reopen
                    </Button>
                  ) : null },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts" className="mt-4">
          <PaginatedTable<Account>
            data={singlePage(accounts)}
            isLoading={loadingAccounts}
            isError={errorAccounts}
            error={accountsError}
            onPageChange={() => {}}
            emptyMessage="No accounts found"
            emptyIcon={ListTree}
            columns={[
              { key: 'account_code', header: 'Code', render: (a) => <span className="font-mono text-xs">{a.account_code}</span> },
              { key: 'name', header: 'Name' },
              { key: 'type', header: 'Type', render: (a) => <Badge variant="outline" className="text-xs capitalize">{a.type}</Badge> },
              { key: 'balance', header: 'Balance', className: 'text-right', render: (a) => <span className="font-mono">{formatKES(a.balance)}</span> },
            ]}
          />
        </TabsContent>

        <TabsContent value="policies" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Approval policies</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Thresholds above which a different officer must approve. Each
                one shows where its current value comes from — override it
                here to set your own group-specific limit.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {errorPolicies ? (
                <p className="p-4 text-sm text-destructive">{getErrorMessage(policiesError)}</p>
              ) : loadingPolicies ? <Skeleton className="h-32 w-full m-4"/> : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Policy','Source','Threshold (KES)',''].map((h)=>(
                        <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(policies ?? []).map((p) => {
                      const editValue = policyEdits[p.key] ?? String(p.threshold);
                      const dirty = editValue !== String(p.threshold);
                      return (
                        <tr key={p.key} className="border-t hover:bg-muted/20">
                          <td className="px-4 py-2">{POLICY_LABELS[p.key] ?? p.key}</td>
                          <td className="px-4 py-2">
                            <Badge variant={p.source === 'group' ? 'success' : 'outline'} className="text-xs capitalize">
                              {p.source === 'group' ? 'Your override' : `Inherited — ${p.source}`}
                            </Badge>
                          </td>
                          <td className="px-4 py-2">
                            <Input
                              type="number" min={0} className="h-8 w-36"
                              value={editValue}
                              onChange={(e) => setPolicyEdits((prev) => ({ ...prev, [p.key]: e.target.value }))}
                            />
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              size="sm" variant="outline" className="h-8 gap-1.5"
                              disabled={!canManageAccounting || !dirty || setPolicy.isPending || !(parseFloat(editValue) >= 0)}
                              title={canManageAccounting ? undefined : 'Requires treasurer or chairperson'}
                              onClick={async () => {
                                try {
                                  await setPolicy.mutateAsync({ key: p.key, threshold: parseFloat(editValue) });
                                  toast({ title: 'Policy updated' });
                                } catch (err) {
                                  toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
                                }
                              }}
                            >
                              <SlidersHorizontal size={13}/> Set override
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <LoanTermsCard />
            <FineScheduleCard />
            <SavingsPolicyCard />
          </div>

          <div className="mt-4">
            <PostingTemplatesCard accounts={accounts ?? []} />
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New Journal Entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="entryDate">Entry date</Label>
                <Input id="entryDate" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="journalDescription">Description</Label>
                <Input
                  id="journalDescription"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description of transaction…"
                />
              </div>
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
                        {(accounts ?? []).map((a) => (
                          <option key={a.id} value={a.id}>{a.account_code} — {a.name}</option>
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
                      <Button variant="ghost" size="icon" className="h-10 w-10" aria-label="Remove line" disabled={lines.length <= 2} title={lines.length <= 2 ? 'A journal entry needs at least 2 lines' : 'Remove line'} onClick={()=>setLines(lines.filter((_,i)=>i!==idx))}><Trash2 size={14}/></Button>
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
            <Button
              onClick={handleSubmitJournal}
              disabled={!balanced || !entryDate || description.trim().length < 3 || lines.filter((l) => l.accountId).length < 2}
              loading={createJournal.isPending}
            >Post journal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Close a fiscal period</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              No new manual journal entries can be dated inside this range until the period is reopened.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>Cancel</Button>
            <Button
              loading={closePeriod.isPending}
              onClick={async () => {
                try {
                  await closePeriod.mutateAsync({ periodStart, periodEnd });
                  toast({ title: 'Period closed' });
                  setCloseOpen(false);
                } catch (err) {
                  toast({ variant: 'destructive', title: 'Failed to close period', description: getErrorMessage(err) });
                }
              }}
            >
              Close period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reopenTarget} onOpenChange={(o) => !o && setReopenTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Reopen this period</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Why does this period need to reopen?" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={reopenReason.trim().length < 5}
              loading={reopenPeriod.isPending}
              onClick={async () => {
                if (!reopenTarget) return;
                try {
                  await reopenPeriod.mutateAsync({ id: reopenTarget, reason: reopenReason });
                  toast({ title: 'Period reopened' });
                  setReopenTarget(null);
                } catch (err) {
                  toast({ variant: 'destructive', title: 'Failed to reopen period', description: getErrorMessage(err) });
                }
              }}
            >
              Reopen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const POSTING_EVENT_LABELS: Record<string, string> = {
  share_purchase:            'Share purchase',
  share_redemption:          'Share redemption',
  welfare_disbursement:      'Welfare disbursement',
  welfare_pool_contribution: 'Welfare pool contribution',
  dividend_declaration:      'Dividend declaration',
  dividend_payment:          'Dividend payment',
  subscription_payment:      'Platform subscription payment',
  loan_writeoff:             'Loan write-off',
  loan_disbursement:         'Loan disbursement',
  loan_repayment:            'Loan repayment',
};

interface TemplateLineUI { accountCode: string; side: 'debit' | 'credit'; amount: string }

/**
 * Posting templates (audit §29.9): which accounts each system-posted business
 * event debits/credits. Only the account can be remapped — the entry
 * structure (sides, amount roles) is locked server-side, so an override can
 * never unbalance an entry.
 */
function PostingTemplatesCard({ accounts }: { accounts: Account[] }) {
  const { toast } = useToast();
  const { data: templates, isLoading, isError, error } = usePostingTemplates();
  const save = useSetPostingTemplate();
  const canSetTemplates = useHasPermission('accounting.manage');
  const [edits, setEdits] = useState<Record<string, TemplateLineUI[]>>({});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Posting templates</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Which accounts each automatic posting hits. You can point an event
          at a different account in your chart — the debit/credit structure
          itself is fixed, so entries always balance.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {isError ? (
          <p className="p-4 text-sm text-destructive">{getErrorMessage(error)}</p>
        ) : isLoading ? <Skeleton className="h-40 w-full m-4"/> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Event','Source','Entry',''].map((h)=>(
                  <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(templates ?? []).map((t) => {
                const lines: TemplateLineUI[] = edits[t.event] ?? t.lines;
                const dirty = t.event in edits;
                return (
                  <tr key={t.event} className="border-t align-top hover:bg-muted/20">
                    <td className="px-4 py-2 whitespace-nowrap">{POSTING_EVENT_LABELS[t.event] ?? t.event}</td>
                    <td className="px-4 py-2">
                      <Badge variant={t.source === 'group' ? 'success' : 'outline'} className="text-xs capitalize">
                        {t.source === 'group' ? 'Your override' : `Inherited — ${t.source}`}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <div className="space-y-1">
                        {lines.map((line, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className={`w-8 shrink-0 text-[11px] font-mono font-semibold ${line.side === 'debit' ? 'text-emerald-700 dark:text-emerald-500' : 'text-sky-700 dark:text-sky-500'}`}>
                              {line.side === 'debit' ? 'DR' : 'CR'}
                            </span>
                            <select
                              value={line.accountCode}
                              onChange={(e) => {
                                const next = lines.map((l, i) => i === idx ? { ...l, accountCode: e.target.value } : l);
                                setEdits((prev) => ({ ...prev, [t.event]: next }));
                              }}
                              className="flex h-8 w-full min-w-56 rounded-md border border-input bg-background px-2 py-1 text-xs"
                            >
                              {!accounts.some((a) => a.account_code === line.accountCode) && (
                                <option value={line.accountCode}>{line.accountCode} — (not in your chart)</option>
                              )}
                              {accounts.map((a) => (
                                <option key={a.id} value={a.account_code}>{a.account_code} — {a.name}</option>
                              ))}
                            </select>
                            {line.amount !== 'amount' && (
                              <span className="shrink-0 text-[11px] text-muted-foreground">({line.amount})</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm" variant="outline" className="h-8 gap-1.5"
                        disabled={!canSetTemplates || !dirty || save.isPending}
                        title={canSetTemplates ? undefined : 'Requires treasurer or chairperson'}
                        onClick={async () => {
                          try {
                            await save.mutateAsync({ event: t.event, lines });
                            setEdits((prev) => { const { [t.event]: _gone, ...rest } = prev; return rest; });
                            toast({ title: 'Posting template updated' });
                          } catch (err) {
                            toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
                          }
                        }}
                      >
                        <SlidersHorizontal size={13}/> Set override
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Group loan terms (LoanPolicy 'terms', migrated from the retired
 * group_constitutions table). Advisory: these pre-fill the loan-application
 * form; officers can still set a different rate/term on any individual loan.
 */
function LoanTermsCard() {
  const { toast } = useToast();
  const { data, isLoading, isError, error } = useLoanPolicy();
  const save = useSetLoanPolicy();
  const canSetLoanTerms = useHasPermission('loans.policy.manage');
  const [edits, setEdits] = useState<Record<string, string> | null>(null);

  const terms  = data?.terms;
  const source = data?.source;
  const form = edits ?? (terms ? {
    interestRate:   String(terms.interestRate),
    interestMethod: terms.interestMethod,
    maxTermMonths:  String(terms.maxTermMonths),
    loanMultiplier: String(terms.loanMultiplier),
  } : null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Loan terms</CardTitle>
          {source && (
            <Badge variant={source === 'group' ? 'success' : 'outline'} className="text-xs capitalize">
              {source === 'group' ? 'Your override' : `Inherited — ${source}`}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Default lending terms offered on new loan applications. Advisory —
          officers can adjust each loan individually.
        </p>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="text-sm text-destructive">{getErrorMessage(error)}</p>
        ) : isLoading || !form ? <Skeleton className="h-32 w-full"/> : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Interest rate (%/month)</Label>
                <Input type="number" step="0.1" min={0} max={100} value={form.interestRate}
                  onChange={(e) => setEdits({ ...form, interestRate: e.target.value })}/>
              </div>
              <div className="space-y-1">
                <Label>Interest method</Label>
                <select
                  value={form.interestMethod}
                  onChange={(e) => setEdits({ ...form, interestMethod: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="flat">Flat</option>
                  <option value="reducing_balance">Reducing balance</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Max term (months)</Label>
                <Input type="number" min={1} max={120} value={form.maxTermMonths}
                  onChange={(e) => setEdits({ ...form, maxTermMonths: e.target.value })}/>
              </div>
              <div className="space-y-1">
                <Label>Loan multiplier (× savings)</Label>
                <Input type="number" step="0.1" min={0.1} value={form.loanMultiplier}
                  onChange={(e) => setEdits({ ...form, loanMultiplier: e.target.value })}/>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm" variant="outline" className="gap-1.5"
                disabled={!canSetLoanTerms || !edits || save.isPending}
                title={canSetLoanTerms ? undefined : 'Requires chairperson'}
                onClick={async () => {
                  try {
                    await save.mutateAsync({
                      interestRate:   parseFloat(form.interestRate),
                      interestMethod: form.interestMethod as 'flat' | 'reducing_balance',
                      maxTermMonths:  parseInt(form.maxTermMonths, 10),
                      loanMultiplier: parseFloat(form.loanMultiplier),
                    });
                    setEdits(null);
                    toast({ title: 'Loan terms updated' });
                  } catch (err) {
                    toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
                  }
                }}
              >
                <SlidersHorizontal size={13}/> Set override
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Group savings limits (SavingsPolicy 'limits'). Unlike LoanTermsCard/
 * FineScheduleCard, there is no retired group_constitutions column behind
 * this — §22 found min/max contribution and grace period simply didn't
 * exist as a feature. Advisory only: pre-fills/annotates the contribution
 * form; contributions.service.ts's create() is unchanged and still accepts
 * any positive amount.
 */
function SavingsPolicyCard() {
  const { toast } = useToast();
  const { data, isLoading, isError, error } = useSavingsPolicy();
  const save = useSetSavingsPolicy();
  const canSetSavingsPolicy = useHasPermission('treasury.manage');
  const [edits, setEdits] = useState<Record<string, string> | null>(null);

  const limits = data?.limits;
  const source = data?.source;
  const form = edits ?? (limits ? {
    minContribution: String(limits.minContribution),
    maxContribution: limits.maxContribution === null ? '' : String(limits.maxContribution),
    gracePeriodDays: String(limits.gracePeriodDays),
  } : null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Savings limits</CardTitle>
          {source && (
            <Badge variant={source === 'group' ? 'success' : 'outline'} className="text-xs capitalize">
              {source === 'group' ? 'Your override' : `Inherited — ${source}`}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Guidance shown on the contribution form. Advisory — treasurers can
          still record any positive amount.
        </p>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="text-sm text-destructive">{getErrorMessage(error)}</p>
        ) : isLoading || !form ? <Skeleton className="h-32 w-full"/> : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>Min contribution (KES)</Label>
                <Input type="number" min={0} step="0.01" value={form.minContribution}
                  onChange={(e) => setEdits({ ...form, minContribution: e.target.value })}/>
              </div>
              <div className="space-y-1">
                <Label>Max contribution (KES)</Label>
                <Input type="number" min={0} step="0.01" placeholder="No maximum" value={form.maxContribution}
                  onChange={(e) => setEdits({ ...form, maxContribution: e.target.value })}/>
              </div>
              <div className="space-y-1">
                <Label>Grace period (days)</Label>
                <Input type="number" min={0} step="1" value={form.gracePeriodDays}
                  onChange={(e) => setEdits({ ...form, gracePeriodDays: e.target.value })}/>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm" variant="outline" className="gap-1.5"
                disabled={!canSetSavingsPolicy || !edits || save.isPending}
                title={canSetSavingsPolicy ? undefined : 'Requires treasurer or chairperson'}
                onClick={async () => {
                  try {
                    await save.mutateAsync({
                      minContribution: parseFloat(form.minContribution),
                      maxContribution: form.maxContribution === '' ? null : parseFloat(form.maxContribution),
                      gracePeriodDays: parseInt(form.gracePeriodDays, 10),
                    });
                    setEdits(null);
                    toast({ title: 'Savings limits updated' });
                  } catch (err) {
                    toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
                  }
                }}
              >
                <SlidersHorizontal size={13}/> Set override
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Group fine schedule (FinePolicy 'schedule', migrated from the retired
 * group_constitutions table). Advisory reference tariff per offence —
 * nothing auto-charges these amounts.
 */
function FineScheduleCard() {
  const { toast } = useToast();
  const { data, isLoading, isError, error } = useFinePolicy();
  const save = useSetFinePolicy();
  const canSetFineSchedule = useHasPermission('fines.manage');
  const [edits, setEdits] = useState<Array<{ category: string; amount: string }> | null>(null);

  const schedule = data?.schedule;
  const source   = data?.source;
  const rows = edits ?? (schedule
    ? Object.entries(schedule).map(([category, amount]) => ({ category, amount: String(amount) }))
    : null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Fine schedule</CardTitle>
          {source && (
            <Badge variant={source === 'group' ? 'success' : 'outline'} className="text-xs capitalize">
              {source === 'group' ? 'Your override' : `Inherited — ${source}`}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Reference tariff per offence, used when raising a fine payment
          request. Advisory — amounts are set per request.
        </p>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="text-sm text-destructive">{getErrorMessage(error)}</p>
        ) : isLoading || !rows ? <Skeleton className="h-32 w-full"/> : (
          <div className="space-y-3">
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    className="flex-1" placeholder="Offence (e.g. late_attendance)" value={row.category}
                    onChange={(e) => { const next = rows.map((r, i) => i === idx ? { ...r, category: e.target.value } : r); setEdits(next); }}
                  />
                  <Input
                    type="number" min={0} step="0.01" className="w-32 text-right" value={row.amount}
                    onChange={(e) => { const next = rows.map((r, i) => i === idx ? { ...r, amount: e.target.value } : r); setEdits(next); }}
                  />
                  <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Remove offence"
                    onClick={() => setEdits(rows.filter((_, i) => i !== idx))}>
                    <Trash2 size={14}/>
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              {canSetFineSchedule && (
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setEdits([...rows, { category: '', amount: '0' }])}>
                  <Plus size={13}/> Add offence
                </Button>
              )}
              <Button
                size="sm" variant="outline" className="gap-1.5"
                disabled={!canSetFineSchedule || !edits || save.isPending || rows.length === 0 || rows.some((r) => !r.category.trim() || !(parseFloat(r.amount) >= 0))}
                title={canSetFineSchedule ? undefined : 'Requires chairperson'}
                onClick={async () => {
                  try {
                    const schedule: Record<string, number> = {};
                    for (const r of rows) schedule[r.category.trim()] = parseFloat(r.amount);
                    await save.mutateAsync({ schedule });
                    setEdits(null);
                    toast({ title: 'Fine schedule updated' });
                  } catch (err) {
                    toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
                  }
                }}
              >
                <SlidersHorizontal size={13}/> Set override
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
