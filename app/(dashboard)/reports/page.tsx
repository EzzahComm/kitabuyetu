'use client';

import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { reportsApi } from '@/lib/api/endpoints';
import { formatKES } from '@/lib/utils';

type ReportTab = 'contributions' | 'loans' | 'financial';
type ReportRow = (string | number)[];

function ReportTable({
  title,
  columns,
  rows,
  empty,
}: {
  title: string;
  columns: string[];
  rows: ReportRow[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label={title}>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column} scope="col" className="border-b px-3 py-2">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-b last:border-b-0">
                    {row.map((cell, column) => (
                      <td key={column} className="px-3 py-2">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReportsPage() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [from, setFrom] = useState(() => `${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [tab, setTab] = useState<ReportTab>('contributions');
  const datesValid = !!from && !!to && from <= to;

  const contributions = useQuery({
    queryKey: ['reports', 'contributions', from, to],
    queryFn: () => reportsApi.contributions(from, to),
    enabled: false,
  });
  const loans = useQuery({ queryKey: ['reports', 'loans'], queryFn: reportsApi.loans, enabled: false });
  const financial = useQuery({
    queryKey: ['reports', 'financial', from, to],
    queryFn: () => reportsApi.financial(from, to),
    enabled: false,
  });
  const query = { contributions, loans, financial }[tab];
  const run = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (tab === 'loans' || datesValid) void query.refetch();
  };

  const contrib = contributions.data;
  const loan = loans.data;
  const finance = financial.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Generate financial reports for your group" />
      <Tabs value={tab} onValueChange={(value) => setTab(value as ReportTab)}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="contributions">Contributions</TabsTrigger>
          <TabsTrigger value="loans">Loans</TabsTrigger>
          <TabsTrigger value="financial">Financial</TabsTrigger>
        </TabsList>
        {(['contributions', 'loans', 'financial'] as const).map((report) => (
          <TabsContent key={report} value={report} className="mt-4 space-y-4">
            <form onSubmit={run} className="flex flex-wrap items-end gap-4">
              {tab !== 'loans' && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="report-from">From</Label>
                    <Input
                      id="report-from"
                      type="date"
                      value={from}
                      required
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="report-to">To</Label>
                    <Input
                      id="report-to"
                      type="date"
                      value={to}
                      required
                      min={from || undefined}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </div>
                </>
              )}
              <Button type="submit" disabled={query.isFetching || (tab !== 'loans' && !datesValid)}>
                {query.isError ? 'Retry report' : 'Run report'}
              </Button>
              {tab !== 'loans' && from && to && from > to && (
                <p role="alert" className="text-sm text-destructive">
                  The end date must be on or after the start date.
                </p>
              )}
            </form>
            {query.isFetching ? (
              <div role="status" aria-label="Generating report">
                <Skeleton className="h-48 w-full" />
              </div>
            ) : query.isError ? (
              <p role="alert" className="text-sm text-destructive">
                The report could not be loaded. Try again.
              </p>
            ) : !query.data ? (
              <p className="text-sm text-muted-foreground">Run the report to see results.</p>
            ) : null}
            {!query.isFetching && !query.isError && tab === 'contributions' && contrib && (
              <>
                <ReportTable
                  title="Contribution totals"
                  columns={['Status', 'Entries', 'Amount']}
                  empty="No contributions in this period."
                  rows={
                    contrib.totals.total_count
                      ? [
                          ['Collected', contrib.totals.completed_count, formatKES(contrib.totals.total_collected)],
                          ['Pending', contrib.totals.pending_count, formatKES(contrib.totals.total_pending)],
                          ['Overdue', contrib.totals.overdue_count, formatKES(contrib.totals.total_overdue)],
                        ]
                      : []
                  }
                />
                <ReportTable
                  title="Collections by member"
                  columns={['Member', 'Entries', 'Collected']}
                  empty="No completed contributions in this period."
                  rows={contrib.byMember.map((row) => [row.member_name, row.count, formatKES(row.total)])}
                />
                <ReportTable
                  title="Monthly collections"
                  columns={['Month', 'Entries', 'Collected']}
                  empty="No completed contributions in this period."
                  rows={contrib.monthly.map((row) => [row.month.slice(0, 7), row.count, formatKES(row.total)])}
                />
              </>
            )}
            {!query.isFetching && !query.isError && tab === 'loans' && loan && (
              <>
                <ReportTable
                  title="Loan portfolio"
                  columns={['Metric', 'Value']}
                  empty="No portfolio data."
                  rows={[
                    ['Pending applications', loan.portfolio.pending_applications],
                    ['Active loans', loan.portfolio.active_loans],
                    ['Completed loans', loan.portfolio.completed_loans],
                    ['Defaulted loans', loan.portfolio.defaulted_loans],
                    ['Active principal disbursed', formatKES(loan.portfolio.total_disbursed)],
                    ['Outstanding balance', formatKES(loan.portfolio.total_outstanding)],
                    ['Defaulted principal', formatKES(loan.portfolio.total_defaulted)],
                  ]}
                />
                <ReportTable
                  title="Overdue instalments (up to 50)"
                  columns={['Member', 'Due date', 'Due', 'Paid', 'Balance']}
                  empty="No overdue instalments."
                  rows={loan.overdueInstallments.map((row) => [
                    row.member_name,
                    row.due_date,
                    formatKES(row.total_due),
                    formatKES(row.amount_paid),
                    formatKES(row.balance_due),
                  ])}
                />
              </>
            )}
            {!query.isFetching && !query.isError && tab === 'financial' && finance && (
              <>
                <ReportTable
                  title="Profit and loss"
                  columns={['Category', 'Account', 'Amount']}
                  empty="No activity."
                  rows={[
                    ...finance.profitAndLoss.income.map((row) => ['Income', row.accountName, formatKES(row.amount)]),
                    ...finance.profitAndLoss.expenses.map((row) => ['Expense', row.accountName, formatKES(row.amount)]),
                    ['Total', 'Income', formatKES(finance.profitAndLoss.totalIncome)],
                    ['Total', 'Expenses', formatKES(finance.profitAndLoss.totalExpenses)],
                    ['Net', 'Profit or loss', formatKES(finance.profitAndLoss.netProfit)],
                  ]}
                />
                <ReportTable
                  title={`Balance sheet as of ${finance.balanceSheet.asOf}`}
                  columns={['Category', 'Account', 'Balance']}
                  empty="No balances."
                  rows={[
                    ...finance.balanceSheet.assets.map((row) => ['Asset', row.accountName, formatKES(row.balance)]),
                    ...finance.balanceSheet.liabilities.map((row) => [
                      'Liability',
                      row.accountName,
                      formatKES(row.balance),
                    ]),
                    ...finance.balanceSheet.equity.map((row) => ['Equity', row.accountName, formatKES(row.balance)]),
                    ['Total', 'Assets', formatKES(finance.balanceSheet.totalAssets)],
                    ['Total', 'Liabilities', formatKES(finance.balanceSheet.totalLiabilities)],
                    ['Total', 'Equity', formatKES(finance.balanceSheet.totalEquity)],
                  ]}
                />
                <ReportTable
                  title="Trial balance (all posted entries)"
                  columns={['Code', 'Account', 'Debits', 'Credits', 'Net']}
                  empty="No posted entries."
                  rows={finance.trialBalance.map((row) => [
                    row.accountCode,
                    row.accountName,
                    formatKES(row.totalDebits),
                    formatKES(row.totalCredits),
                    formatKES(row.netBalance),
                  ])}
                />
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
