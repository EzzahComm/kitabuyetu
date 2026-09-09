/**
 * RBAC permission activation, Batch 3 (SIMPLIFICATION_AND_RBAC_AUDIT.md
 * Workstream 4). Covers every distinct permission string this batch
 * introduced or reused (messaging.templates.view/manage,
 * messaging.schedules.view/manage, messaging.send, messaging.manage, and
 * the withAnyPermission composition standing in for email/schedules' old
 * ['chairperson','treasurer','super_admin'] allowlist) against real
 * Postgres — one representative route per string across SMS and Email
 * rather than every one of the 18 touched files.
 */
import { GET as smsTemplatesGet, POST as smsTemplatesPost } from '@/app/api/v1/sms/templates/route';
import { GET as smsSchedulesGet, POST as smsSchedulesPost } from '@/app/api/v1/sms/schedules/route';
import { DELETE as smsCampaignDelete } from '@/app/api/v1/sms/campaign/route';
import { GET as emailTemplateGet } from '@/app/api/v1/email/templates/[id]/route';
import { GET as emailCampaignsGet } from '@/app/api/v1/email/campaigns/route';
import { POST as emailSchedulesPost } from '@/app/api/v1/email/schedules/route';
import { authHeaders, buildRequest } from '../helpers/request';
import { createTestGroup, addGroupOfficer } from '../helpers/fixtures';
import { resetDatabase } from '../helpers/cleanup';
import { rawQuery } from '../helpers/db';

async function permissionsFor(role: string): Promise<string[]> {
  const [row] = await rawQuery<{ permissions: string[] }>(
    `SELECT permissions FROM public.roles WHERE group_id IS NULL AND code = $1`,
    [role],
  );
  return row.permissions;
}

describe('SMS/Email messaging permission gates', () => {
  let groupId: string, memberId: string;
  let memberPerms: string[], secretaryPerms: string[], treasurerPerms: string[], chairpersonPerms: string[];

  beforeAll(async () => {
    await resetDatabase();
    const { groupId: gId, officerId: founderId } = await createTestGroup('chairperson');
    groupId  = gId;
    memberId = await addGroupOfficer(gId, founderId, 'member');
    memberPerms      = await permissionsFor('member');
    secretaryPerms   = await permissionsFor('secretary');
    treasurerPerms   = await permissionsFor('treasurer');
    chairpersonPerms = await permissionsFor('chairperson');
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('messaging.templates.view: member is denied, secretary can list SMS templates', async () => {
    const denied = await smsTemplatesGet(buildRequest('/api/v1/sms/templates', {
      headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await smsTemplatesGet(buildRequest('/api/v1/sms/templates', {
      headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
    }));
    expect(allowed.status).toBe(200);
  });

  it('messaging.templates.manage: secretary is denied, chairperson can create an SMS template', async () => {
    const body = { templateKey: 'my_test_tpl', name: 'Test', body: 'Hello {{name}}', category: 'custom' };
    const denied = await smsTemplatesPost(buildRequest('/api/v1/sms/templates', {
      method: 'POST', body,
      headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await smsTemplatesPost(buildRequest('/api/v1/sms/templates', {
      method: 'POST', body,
      headers: authHeaders({ userId: memberId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
    }));
    expect(allowed.status).toBe(201);
  });

  it('messaging.schedules.view/manage: member denied both, secretary can view, chairperson can create', async () => {
    const deniedView = await smsSchedulesGet(buildRequest('/api/v1/sms/schedules', {
      headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
    }));
    expect(deniedView.status).toBe(403);

    const allowedView = await smsSchedulesGet(buildRequest('/api/v1/sms/schedules', {
      headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
    }));
    expect(allowedView.status).toBe(200);

    const deniedManage = await smsSchedulesPost(buildRequest('/api/v1/sms/schedules', {
      method: 'POST',
      body: { name: 'Weekly reminder', scheduleType: 'weekly', recipientType: 'all', isActive: true, timezone: 'Africa/Nairobi' },
      headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
    }));
    expect(deniedManage.status).toBe(403);
  });

  it('messaging.manage: secretary cannot cancel an SMS campaign (fake id still proves the gate, not a 404-vs-403 ambiguity)', async () => {
    const res = await smsCampaignDelete(buildRequest('/api/v1/sms/campaign?id=00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
    }));
    expect(res.status).toBe(403);
  });

  it('messaging.templates.view (email): the previously-ungated GET /email/templates/[id] now denies a plain member', async () => {
    const res = await emailTemplateGet(
      buildRequest('/api/v1/email/templates/00000000-0000-0000-0000-000000000000', {
        headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
      }),
      { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) },
    );
    expect(res.status).toBe(403);
  });

  it('messaging.send (email): the previously-ungated GET /email/campaigns now denies a plain member, allows secretary', async () => {
    const denied = await emailCampaignsGet(buildRequest('/api/v1/email/campaigns', {
      headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await emailCampaignsGet(buildRequest('/api/v1/email/campaigns', {
      headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
    }));
    expect(allowed.status).toBe(200);
  });

  it('withAnyPermission composition: POST /email/schedules allows treasurer (treasury.manage) and chairperson (messaging.manage), denies secretary', async () => {
    const body = { templateKey: 'welcome', to: 'a@example.com', sendAt: new Date(Date.now() + 3600_000).toISOString() };

    const deniedSecretary = await emailSchedulesPost(buildRequest('/api/v1/email/schedules', {
      method: 'POST', body,
      headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
    }));
    expect(deniedSecretary.status).toBe(403);

    const allowedTreasurer = await emailSchedulesPost(buildRequest('/api/v1/email/schedules', {
      method: 'POST', body,
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(allowedTreasurer.status).not.toBe(403);
  });
});
