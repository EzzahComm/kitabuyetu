'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api/client';
import { useHasPermission } from '@/lib/auth/use-permission';
import { isTenantUser, useAuth } from '@/lib/auth/context';
import type { checkHistoricalBalances } from '@/lib/services/historical-balances.service';

type Report = Awaited<ReturnType<typeof checkHistoricalBalances>>;
const uploads = [
  ['balances', 'Proposed member balances', 'membership_no,category,amount'],
  ['member_close', 'Independent member closing schedule', 'membership_no,category,amount,source_ref'],
  ['controls', 'Signed closing totals by category', 'category,amount,source_ref'],
] as const;

export function HistoricalBalanceCheck() {
  const allowed = useHasPermission('import.start');
  const { user } = useAuth();
  if (!allowed || !isTenantUser(user)) return null;
  return <CheckForm key={user.groupId} groupId={user.groupId} />;
}

function CheckForm({ groupId }: { groupId: string }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setReport(null);
    setError('');
    try {
      setReport(await api.upload<Report>('/import/historical-balances/check', data));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to check the files. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check historical balances</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Compare the proposed balances with two independent closing records. This check has no effect on member
          balances or funds available for payout.
        </p>
        <form
          onSubmit={submit}
          onChange={() => {
            setReport(null);
            setError('');
          }}
        >
          <fieldset disabled={busy} className="grid gap-4">
            <p className="break-all text-sm">
              Group ID for these files <code>{groupId}</code>
            </p>
            <label className="grid gap-1 text-sm">
              Closing date (Nairobi)
              <Input type="date" name="as_of" required />
            </label>
            {uploads.map(([key, title, fields]) => (
              <label key={key} className="grid gap-1 text-sm">
                {title}
                <Input type="file" name={key} accept=".csv,text/csv" required />
                <span className="break-all font-mono text-xs text-muted-foreground">
                  group_id,as_of,currency,{fields}
                </span>
              </label>
            ))}
            <p className="text-sm text-muted-foreground">
              Use KES. Include one control each for savings, share_capital, loan_principal, loan_interest and
              member_welfare, including zero totals. Each source_ref identifies a document and line. Each CSV can
              contain up to 5,000 rows and 1 MiB.
            </p>
            <Button type="submit" className="justify-self-start">
              {busy ? 'Checking…' : 'Check balances'}
            </Button>
          </fieldset>
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {report && (
          <div role="status" className="space-y-2 text-sm">
            <p>
              {report.rows} balances for {report.members} members matched at {report.asOf}. The source documents still
              need independent approval.
            </p>
            <dl>
              {Object.entries(report.totalsKES).map(([category, amount]) => (
                <div key={category} className="flex gap-3">
                  <dt>{category.replaceAll('_', ' ')}</dt>
                  <dd>KES {amount}</dd>
                </div>
              ))}
            </dl>
            <details>
              <summary>File fingerprints for review (SHA-256)</summary>
              <ul>
                {Object.entries(report.sha256).map(([key, hash]) => (
                  <li key={key} className="break-all">
                    {key}: <code>{hash}</code>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
