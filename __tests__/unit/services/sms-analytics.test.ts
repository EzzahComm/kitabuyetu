import { summarizeUsageRows } from '@/lib/sms/analytics';

describe('summarizeUsageRows', () => {
  it('aggregates delivery counts and total credits from usage rows', () => {
    const rows = [
      { status: 'delivered', credits_deducted: '0.90' },
      { status: 'sent', credits_deducted: '0.90' },
      { status: 'failed', credits_deducted: '0.90' },
      { status: 'failed', credits_deducted: '0.90' },
      { status: 'queued', credits_deducted: '0.90' },
    ];

    expect(summarizeUsageRows(rows as any)).toEqual({
      totalMessages: 5,
      delivered: 1,
      sent: 1,
      failed: 2,
      queued: 1,
      totalCredits: '4.50',
    });
  });
});
