import { buildMonitoringDashboardPayload, buildRiskDashboardPayload } from '@/lib/services/admin.service';

describe('admin dashboard payload builders', () => {
  it('builds a risk dashboard payload from groups and recent transactions', () => {
    const payload = buildRiskDashboardPayload({
      groups: [
        {
          id: 'g-1',
          name: 'Mwangaza SACCO',
          group_type: 'sacco',
          risk_score: 74,
          engagement_score: 41,
          onboarding_status: 'active',
          created_at: '2024-01-01T00:00:00Z',
          admin_name: 'Grace Achieng',
        },
        {
          id: 'g-2',
          name: 'Umoja Women Group',
          group_type: 'chama',
          risk_score: 28,
          engagement_score: 87,
          onboarding_status: 'pending',
          created_at: '2024-02-01T00:00:00Z',
          admin_name: 'Aisha Mohamed',
        },
      ],
      transactions: [
        {
          id: 'tx-1',
          amount: '550000',
          status: 'failed',
          created_at: '2024-01-02T00:00:00Z',
          transaction_type: 'c2b',
          failure_reason: 'Velocity anomaly',
          description: '14 disbursements in 6 mins',
        },
      ],
      dailyTrend: [{ day: 'Mon', alerts: 2, resolved: 1 }],
      heatmap: [{ segment: 'SACCOs', scores: [41, 38, 55, 47, 26] }],
    });

    expect(payload.summary.openAlerts).toBe(1);
    expect(payload.summary.flaggedVolume).toBe(550000);
    expect(payload.alerts[0]).toMatchObject({ org: 'Mwangaza SACCO', severity: 'critical' });
    expect(payload.kyc[0]).toMatchObject({ org: 'Umoja Women Group', risk: 'medium' });
    expect(payload.heatmap[0].segment).toBe('SACCOs');
    expect(payload.alertTrend[0]).toMatchObject({ day: 'Mon', alerts: 2 });
  });

  it('builds a monitoring dashboard payload from recent transactions and sms usage', () => {
    const payload = buildMonitoringDashboardPayload({
      services: [
        { id: 'stk', name: 'STK Push', group: 'M-Pesa / Daraja', status: 'degraded', latency: 1480, success: 94.1, note: 'Elevated timeouts' },
      ],
      hourlyVolume: [{ hour: '12:00', count: 8, value: 180000 }],
      smsUsage: { sentToday: 8200, delivered: 8000, failed: 200, pending: 0, creditsRemaining: 5000, creditsTotal: 10000 },
      transactions: [
        {
          id: 'txn-1',
          transaction_type: 'STK',
          phone_number: '+254700000000',
          amount: '1500',
          status: 'success',
          mpesa_receipt_number: 'R1',
          reference: 'REF1',
          created_at: '2024-01-02T00:00:00Z',
        },
      ],
    });

    expect(payload.services[0].status).toBe('degraded');
    expect(payload.hourlyVolume[0]).toMatchObject({ count: 8, value: 180000 });
    expect(payload.smsUsage.delivered).toBe(8000);
    expect(payload.transactions[0]).toMatchObject({ org: 'Platform activity', type: 'STK' });
  });
});
