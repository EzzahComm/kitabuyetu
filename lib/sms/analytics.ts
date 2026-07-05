export interface SmsUsageSummary {
  totalMessages: number;
  delivered: number;
  sent: number;
  failed: number;
  queued: number;
  totalCredits: string;
}

export function summarizeUsageRows(rows: Array<{ status?: string | null; credits_deducted?: string | number | null }>): SmsUsageSummary {
  const summary = rows.reduce(
    (acc, row) => {
      const status = (row.status ?? 'queued').toLowerCase();
      acc.totalMessages += 1;
      if (status === 'delivered') acc.delivered += 1;
      else if (status === 'sent') acc.sent += 1;
      else if (status === 'failed') acc.failed += 1;
      else acc.queued += 1;

      const credits = Number(row.credits_deducted ?? 0);
      acc.totalCredits += Number.isFinite(credits) ? credits : 0;
      return acc;
    },
    {
      totalMessages: 0,
      delivered: 0,
      sent: 0,
      failed: 0,
      queued: 0,
      totalCredits: 0,
    },
  );

  return {
    ...summary,
    totalCredits: summary.totalCredits.toFixed(2),
  };
}
