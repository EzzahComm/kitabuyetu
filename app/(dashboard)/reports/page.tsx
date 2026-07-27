'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '@/lib/api/endpoints';

export default function ReportsPage() {
  const now = new Date();
  const [from, setFrom] = useState(`${now.getFullYear()}-01-01`);
  const [to, setTo]     = useState(now.toISOString().slice(0, 10));
  const [tab, setTab]   = useState('contributions');

  const { data: contribReport, isLoading: loadingContrib, refetch: refetchContrib } =
    useQuery({ queryKey: ['reports','contributions',from,to], queryFn: () => reportsApi.contributions(from, to), enabled: false });

  const { data: financialReport, isLoading: loadingFinancial, refetch: refetchFinancial } =
    useQuery({ queryKey: ['reports','financial',from,to], queryFn: () => reportsApi.financial(from, to), enabled: false });

  const { data: loansReport, isLoading: loadingLoans, refetch: refetchLoans } =
    useQuery({ queryKey: ['reports','loans'], queryFn: () => reportsApi.loans(), enabled: false });

  const handleRun = () => {
    if (tab === 'contributions') refetchContrib();
    else if (tab === 'financial') refetchFinancial();
    else if (tab === 'loans') refetchLoans();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Generate financial reports for your group" />

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            </div>
            <Button onClick={handleRun}>Run report</Button>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="contributions">Contributions</TabsTrigger>
          <TabsTrigger value="loans">Loans</TabsTrigger>
          <TabsTrigger value="financial">Financial</TabsTrigger>
        </TabsList>

        <TabsContent value="contributions" className="mt-4">
          {loadingContrib ? <Skeleton className="h-64 w-full"/> : contribReport ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Contributions Report</CardTitle></CardHeader>
              <CardContent>
                <pre className="text-xs whitespace-pre-wrap overflow-auto max-h-96">{JSON.stringify(contribReport, null, 2)}</pre>
              </CardContent>
            </Card>
          ) : (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Select date range and click &quot;Run report&quot;
            </div>
          )}
        </TabsContent>

        <TabsContent value="loans" className="mt-4">
          {loadingLoans ? <Skeleton className="h-64 w-full"/> : loansReport ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Loans Report</CardTitle></CardHeader>
              <CardContent>
                <pre className="text-xs whitespace-pre-wrap overflow-auto max-h-96">{JSON.stringify(loansReport, null, 2)}</pre>
              </CardContent>
            </Card>
          ) : (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Click &quot;Run report&quot; to generate
            </div>
          )}
        </TabsContent>

        <TabsContent value="financial" className="mt-4">
          {loadingFinancial ? <Skeleton className="h-64 w-full"/> : financialReport ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Financial Report</CardTitle></CardHeader>
              <CardContent>
                <pre className="text-xs whitespace-pre-wrap overflow-auto max-h-96">{JSON.stringify(financialReport, null, 2)}</pre>
              </CardContent>
            </Card>
          ) : (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Select date range and click &quot;Run report&quot;
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
