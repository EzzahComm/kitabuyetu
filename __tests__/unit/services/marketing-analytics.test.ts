/**
 * Cross-channel marketing analytics (Phase 9.6) — rate math (incl. divide-
 * by-zero guards), the sms/email UNION ALL status rollup, the zero-filled
 * volume time series, and days-parameter clamping.
 */
import { withDb } from '@/lib/db';
import { getMarketingAnalytics } from '@/lib/services/marketing-analytics.service';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'user-1', role: 'chairperson' };

/** Queues the 7 Promise.all queries in the exact source order the service issues them. */
function queueAll(overrides: Partial<{
  sms: object; email: object; automation: object[]; volume: object[];
  contacts: object; opportunities: object[]; activities: object;
}> = {}) {
  mockQuery.mockResolvedValueOnce({ rows: [overrides.sms ?? { campaigns: '0', recipients: '0', sent: '0', failed: '0' }] });
  mockQuery.mockResolvedValueOnce({ rows: [overrides.email ?? { campaigns: '0', recipients: '0', sent: '0', failed: '0', opened: '0' }] });
  mockQuery.mockResolvedValueOnce({ rows: overrides.automation ?? [] });
  mockQuery.mockResolvedValueOnce({ rows: overrides.volume ?? [] });
  mockQuery.mockResolvedValueOnce({ rows: [overrides.contacts ?? { total: '0', opted_in: '0' }] });
  mockQuery.mockResolvedValueOnce({ rows: overrides.opportunities ?? [] });
  mockQuery.mockResolvedValueOnce({ rows: [overrides.activities ?? { count: '0' }] });
}

describe('getMarketingAnalytics — days clamping', () => {
  it('defaults to 30 when days is omitted', async () => {
    queueAll();
    const result = await getMarketingAnalytics(ctx);
    expect(result.periodDays).toBe(30);
  });

  it('falls back to 30 for a non-finite days value', async () => {
    queueAll();
    const result = await getMarketingAnalytics(ctx, NaN);
    expect(result.periodDays).toBe(30);
  });

  it('clamps an out-of-range days value to [1, 365]', async () => {
    queueAll();
    let result = await getMarketingAnalytics(ctx, 5000);
    expect(result.periodDays).toBe(365);

    queueAll();
    result = await getMarketingAnalytics(ctx, 0);
    expect(result.periodDays).toBe(1);
  });
});

describe('getMarketingAnalytics — rate math', () => {
  it('computes delivery/open rates and guards against division by zero', async () => {
    queueAll({
      sms:   { campaigns: '2', recipients: '100', sent: '90', failed: '10' },
      email: { campaigns: '1', recipients: '0',   sent: '0',  failed: '0', opened: '0' },
    });

    const result = await getMarketingAnalytics(ctx, 30);

    expect(result.sms.deliveryRate).toBeCloseTo(0.9);
    expect(result.email.deliveryRate).toBe(0); // 0 recipients — must not divide by zero
    expect(result.email.openRate).toBe(0);      // 0 sent — must not divide by zero
  });

  it('computes email open rate against sent, not recipients', async () => {
    queueAll({
      email: { campaigns: '1', recipients: '50', sent: '40', failed: '10', opened: '20' },
    });

    const result = await getMarketingAnalytics(ctx, 30);

    expect(result.email.openRate).toBeCloseTo(0.5); // 20/40, not 20/50
  });
});

describe('getMarketingAnalytics — automation status rollup', () => {
  it('sums sent/failed/suppressed/pending across both channels', async () => {
    queueAll({
      automation: [
        { channel: 'sms',   status: 'sent',       executions: '5' },
        { channel: 'sms',   status: 'failed',     executions: '1' },
        { channel: 'email', status: 'sent',       executions: '3' },
        { channel: 'email', status: 'suppressed', executions: '2' },
        { channel: 'email', status: 'pending',    executions: '1' },
      ],
    });

    const result = await getMarketingAnalytics(ctx, 30);

    expect(result.automation).toEqual({ total: 12, sent: 8, failed: 1, suppressed: 2, pending: 1 });
  });
});

describe('getMarketingAnalytics — volume time series', () => {
  it('zero-fills every day in the window, even with no automation activity', async () => {
    queueAll();
    const result = await getMarketingAnalytics(ctx, 7);

    expect(result.automationVolume).toHaveLength(7);
    expect(result.automationVolume.every((p) => p.sms === 0 && p.email === 0)).toBe(true);
    // Sorted ascending by date.
    const dates = result.automationVolume.map((p) => p.date);
    expect(dates).toEqual([...dates].sort());
  });

  it('places matching rows into their day bucket by channel', async () => {
    const today = new Date().toISOString().slice(0, 10);
    queueAll({ volume: [{ channel: 'sms', day: today, cnt: '4' }] });

    const result = await getMarketingAnalytics(ctx, 7);
    const todayPoint = result.automationVolume.find((p) => p.date === today);

    expect(todayPoint?.sms).toBe(4);
    expect(todayPoint?.email).toBe(0);
  });
});

describe('getMarketingAnalytics — CRM snapshot', () => {
  it('computes opt-in rate and shapes opportunitiesByStage from the grouped rows', async () => {
    queueAll({
      contacts: { total: '20', opted_in: '5' },
      opportunities: [
        { stage: 'draft', count: '3', amount: '0' },
        { stage: 'won', count: '2', amount: '50000' },
      ],
      activities: { count: '14' },
    });

    const result = await getMarketingAnalytics(ctx, 30);

    expect(result.crm.optInRate).toBeCloseTo(0.25);
    expect(result.crm.opportunitiesByStage.draft).toEqual({ count: 3, amount: 0 });
    expect(result.crm.opportunitiesByStage.won).toEqual({ count: 2, amount: 50000 });
    expect(result.crm.activitiesInPeriod).toBe(14);
  });

  it('does not divide by zero when there are no contacts at all', async () => {
    queueAll({ contacts: { total: '0', opted_in: '0' } });
    const result = await getMarketingAnalytics(ctx, 30);
    expect(result.crm.optInRate).toBe(0);
  });
});
