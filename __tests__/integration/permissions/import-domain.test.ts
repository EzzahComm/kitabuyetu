/**
 * RBAC permission activation, Batch 5 (SIMPLIFICATION_AND_RBAC_AUDIT.md
 * Workstream 4). Import's 4-way role split (start=treasurer,
 * preview/commit/cancel=secretary, rollback=chairperson) previously used one
 * coarse `data.import` seed string with no way to distinguish the tiers via
 * a permission check; migration 110 split it into import.start/preview/
 * commit/cancel/rollback. This proves each gate against real Postgres.
 */
import { POST as importPost } from '@/app/api/v1/import/route';
import { POST as previewPost } from '@/app/api/v1/import/preview/route';
import { DELETE as jobDelete } from '@/app/api/v1/import/[jobId]/route';
import { POST as commitPost } from '@/app/api/v1/import/[jobId]/commit/route';
import { POST as rollbackPost } from '@/app/api/v1/import/[jobId]/rollback/route';
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

function csvFormData(csv: string, filename: string): FormData {
  const fd = new FormData();
  fd.set('file', new File([csv], filename, { type: 'text/csv' }));
  return fd;
}

const FAKE_JOB_ID = '00000000-0000-0000-0000-000000000000';

describe('Import domain permission gates (4-way role split)', () => {
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

  it('import.start: secretary is denied, treasurer CAN start a legacy contribution import', async () => {
    const csv = 'member_phone,amount,contribution_date,payment_method\n2547123456,1000,2026-01-01,cash\n';

    const denied = await importPost(buildRequest('/api/v1/import?type=contributions', {
      method: 'POST', body: csvFormData(csv, 'contributions.csv'),
      headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await importPost(buildRequest('/api/v1/import?type=contributions', {
      method: 'POST', body: csvFormData(csv, 'contributions.csv'),
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(allowed.status).not.toBe(403);
  });

  it('import.preview: member is denied, secretary CAN preview a members import', async () => {
    const csv = 'phone,first_name,last_name\n+254712345678,Jane,Doe\n';

    const denied = await previewPost(buildRequest('/api/v1/import/preview?type=members', {
      method: 'POST', body: csvFormData(csv, 'members.csv'),
      headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await previewPost(buildRequest('/api/v1/import/preview?type=members', {
      method: 'POST', body: csvFormData(csv, 'members.csv'),
      headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
    }));
    expect(allowed.status).toBe(201);
  });

  it('import.cancel: member is denied on DELETE /import/[jobId]', async () => {
    const res = await jobDelete(
      buildRequest(`/api/v1/import/${FAKE_JOB_ID}`, {
        method: 'DELETE',
        headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
      }),
      { params: Promise.resolve({ jobId: FAKE_JOB_ID }) },
    );
    expect(res.status).toBe(403);
  });

  it('import.commit: member is denied, secretary passes the gate (404 on the fake job is expected next)', async () => {
    const denied = await commitPost(
      buildRequest(`/api/v1/import/${FAKE_JOB_ID}/commit`, {
        method: 'POST',
        headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
      }),
      { params: Promise.resolve({ jobId: FAKE_JOB_ID }) },
    );
    expect(denied.status).toBe(403);

    const passesGate = await commitPost(
      buildRequest(`/api/v1/import/${FAKE_JOB_ID}/commit`, {
        method: 'POST',
        headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
      }),
      { params: Promise.resolve({ jobId: FAKE_JOB_ID }) },
    );
    expect(passesGate.status).not.toBe(403);
  });

  it('import.rollback: secretary is denied (only chairperson may roll back), chairperson passes the gate', async () => {
    const denied = await rollbackPost(
      buildRequest(`/api/v1/import/${FAKE_JOB_ID}/rollback`, {
        method: 'POST', body: {},
        headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
      }),
      { params: Promise.resolve({ jobId: FAKE_JOB_ID }) },
    );
    expect(denied.status).toBe(403);

    const passesGate = await rollbackPost(
      buildRequest(`/api/v1/import/${FAKE_JOB_ID}/rollback`, {
        method: 'POST', body: {},
        headers: authHeaders({ userId: memberId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
      }),
      { params: Promise.resolve({ jobId: FAKE_JOB_ID }) },
    );
    expect(passesGate.status).not.toBe(403);
  });
});
