/**
 * POST /api/v1/sms/campaign — against real Postgres.
 *
 * Regression coverage for a genuine production incident: `$9` (scheduled_at)
 * was reused a second time inside `CASE WHEN $9 IS NOT NULL THEN 'scheduled'
 * ELSE 'draft' END` with no explicit cast. node-pg sends no type OIDs, so
 * Postgres could not resolve $9's type from a bare `IS NOT NULL` usage and
 * threw `could not determine data type of parameter $9` — at PARSE time,
 * before any value is even bound, so this failed on EVERY call, immediate or
 * scheduled alike, not just scheduled ones. Confirmed live in production
 * (2026-08-14) via `vercel logs`, then reproduced against real Postgres
 * before fixing. Same failure class as sms.service.ts's updateLogRow,
 * notifications.service.ts's insertSmsLog, and reminder_dispatch_log.settle()
 * — a `$n` reused both as an assigned value and inside a bare comparison
 * needs an explicit cast at every occurrence in this codebase.
 *
 * No existing test called this route's POST handler at all before this file
 * — sms-bulk-personalization.test.ts only references it in a comment, and
 * permissions/sms-email-messaging.test.ts only exercises DELETE — which is
 * exactly how a 100%-failure bug shipped unnoticed.
 */
import { POST as smsCampaignPost } from '@/app/api/v1/sms/campaign/route';
import { authHeaders, buildRequest } from './helpers/request';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

async function permissionsFor(role: string): Promise<string[]> {
  const [row] = await rawQuery<{ permissions: string[] }>(
    `SELECT permissions FROM public.roles WHERE group_id IS NULL AND code = $1`,
    [role],
  );
  return row.permissions;
}

describe('POST /api/v1/sms/campaign', () => {
  let groupId: string, officerId: string, chairpersonPerms: string[];

  beforeAll(async () => {
    await resetDatabase();
    const { groupId: gId, officerId: oId } = await createTestGroup('chairperson');
    groupId = gId;
    officerId = oId;
    chairpersonPerms = await permissionsFor('chairperson');
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('creates an immediate campaign (no scheduledAt) as draft — was a 500 on every call', async () => {
    const res = await smsCampaignPost(buildRequest('/api/v1/sms/campaign', {
      method: 'POST',
      headers: authHeaders({ userId: officerId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
      body: { name: 'Immediate campaign', message: 'Meeting tomorrow.', recipientType: 'all_members' },
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('draft');
    expect(body.data.scheduled_at).toBeNull();
  });

  it('creates a scheduled campaign as scheduled, not sent immediately', async () => {
    const scheduledAt = new Date(Date.now() + 86_400_000).toISOString();

    const res = await smsCampaignPost(buildRequest('/api/v1/sms/campaign', {
      method: 'POST',
      headers: authHeaders({ userId: officerId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
      body: {
        name: 'Scheduled campaign', message: 'Happy new year!',
        recipientType: 'all_members', scheduledAt,
      },
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('scheduled');
    expect(new Date(body.data.scheduled_at).toISOString()).toBe(scheduledAt);
  });
});
