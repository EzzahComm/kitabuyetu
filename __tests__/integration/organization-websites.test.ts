import { randomUUID } from 'node:crypto';
import { GET as studioGet, POST as manage } from '@/app/api/admin/organization/website/route';
import { PUT as grant } from '@/app/api/admin/organizations/[id]/website/route';
import { POST as enquire } from '@/app/api/sites/[slug]/enquiries/route';
import { websiteInbox, handleWebsiteEnquiry } from '@/lib/services/website-enquiries.service';
import {
  publishedWebsite,
  websiteStudio,
  provisionWebsite,
  updateWebsite,
} from '@/lib/services/organization-websites.service';
import { assignGroupToOrganization } from '@/lib/services/admin-organizations.service';
import { programLoginDestination } from '@/lib/auth/post-login-path';
import { withAdminDb, type TenantContext } from '@/lib/db';
import { backofficeHeaders, buildRequest } from './helpers/request';
import { createTestOrganization, createOrgCoordinator, createTestGroup } from './helpers/fixtures';
import { rawQuery } from './helpers/db';
import { resetDatabase } from './helpers/cleanup';
const slug = 'fictional-grove';
const path = '/api/admin/organization/website';
let a: TenantContext, b: TenantContext, staff: TenantContext;
let programId: string, foreignId: string, campaignId: string;
async function tenant() {
  const org = await createTestOrganization();
  await rawQuery("INSERT INTO organization_members(organization_id,member_id,org_role) VALUES ($1,$2,'lead')", [
    org.organizationId,
    org.coordinatorId,
  ]);
  return {
    organizationId: org.organizationId,
    userId: org.coordinatorId,
    groupId: '',
    role: 'organization_coordinator',
  } as TenantContext;
}
function headers(ctx: TenantContext) {
  return backofficeHeaders({
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    platformRole: 'organization_coordinator',
  });
}
async function flag(enabled: boolean) {
  await rawQuery("UPDATE feature_flags SET enabled=$1 WHERE key='websites_enabled'", [enabled]);
}
async function programme(ctx: TenantContext, slug: string) {
  return (
    await rawQuery<{ id: string }>(
      `INSERT INTO programs(organization_id,created_by,name,slug,objectives,status)
    VALUES ($1,$2,'Example programme',$3,'Internal notes','published') RETURNING id`,
      [ctx.organizationId, ctx.userId, slug],
    )
  )[0].id;
}
beforeAll(async () => {
  await resetDatabase();
  // The integration reset truncates members CASCADE, including feature flags via updated_by.
  await rawQuery(
    "INSERT INTO feature_flags(key,name) VALUES ('websites_enabled','Organization websites') ON CONFLICT DO NOTHING",
  );
  a = await tenant();
  b = await tenant();
  staff = { ...a, userId: await createOrgCoordinator() };
  await rawQuery("INSERT INTO organization_members(organization_id,member_id,org_role) VALUES ($1,$2,'staff')", [
    a.organizationId,
    staff.userId,
  ]);
  programId = await programme(a, 'grove-activity');
  foreignId = await programme(b, 'other-activity');
  const group = await createTestGroup('chairperson');
  await assignGroupToOrganization(a.organizationId!, group.groupId, a.userId);
  campaignId = (
    await rawQuery<{ id: string }>(
      `INSERT INTO campaigns(group_id,title,slug,account_code,story,target_amount,status,reviewed_at,reviewed_by,created_by,payout_phone)
    VALUES ($1,'Example appeal','fictional-example','CH000001','Example',500,'active',now(),$2,$3,'254700000001') RETURNING id`,
      [group.groupId, a.userId, group.officerId],
    )
  )[0].id;
});
beforeEach(async () => {
  await flag(true);
  await rawQuery('DELETE FROM organization_websites WHERE organization_id=ANY($1::uuid[])', [
    [a.organizationId, b.organizationId],
  ]);
  await provisionWebsite(a.organizationId!, slug, true, a.userId);
  await provisionWebsite(b.organizationId!, 'fictional-brook', true, b.userId);
});
afterAll(async () => {
  await flag(false);
  await resetDatabase();
});
async function save(ctx = a) {
  const s = await websiteStudio(ctx);
  await updateWebsite(ctx, {
    action: 'save',
    slug: s.slug,
    revision: s.revision,
    draft: {
      ...s.draft,
      headline: 'Community programmes',
      acceptEnquiries: true,
      memberAccess: true,
      programIds: [programId],
      campaignIds: [campaignId],
    },
  });
  return websiteStudio(ctx);
}
async function publish() {
  const s = await save();
  await updateWebsite(a, { action: 'publish', slug, revision: s.revision, digest: s.preview!.digest });
  return websiteStudio(a);
}
it('requires a platform administrator to provision and live organization membership to edit', async () => {
  expect(
    (
      await grant(
        buildRequest('/api/admin/organizations/' + a.organizationId + '/website', {
          method: 'PUT',
          headers: headers(a),
          body: { slug, enabled: false },
        }),
        { params: Promise.resolve({ id: a.organizationId! }) },
      )
    ).status,
  ).toBe(403);
  expect(
    (await studioGet(buildRequest(path, { headers: headers({ ...a, organizationId: b.organizationId }) }))).status,
  ).toBe(403);
  expect((await studioGet(buildRequest(path, { headers: headers(staff) }))).status).toBe(200);
  expect(await publishedWebsite(slug)).toBeNull();
});
it('validates source ownership and rejects ownership fields in editor commands', async () => {
  const s = await websiteStudio(a);
  expect(s.choices.programs.map((p) => p.id)).toEqual([programId]);
  expect(s.choices.campaigns.map((c) => c.id)).toEqual([campaignId]);
  expect((await websiteStudio(b)).choices.campaigns).toEqual([]);
  await expect(
    updateWebsite(a, { action: 'save', slug, revision: s.revision, draft: { ...s.draft, programIds: [foreignId] } }),
  ).rejects.toThrow(/eligible/);
  const res = await manage(
    buildRequest(path, {
      method: 'POST',
      headers: headers(a),
      body: { action: 'save', organizationId: b.organizationId, slug, revision: s.revision, draft: s.draft },
    }),
  );
  expect(res.status).toBe(422);
});
it('only leads can publish the reviewed snapshot, with no private fields or draft leakage', async () => {
  const draft = await save(staff);
  await expect(
    updateWebsite(staff, { action: 'publish', slug, revision: draft.revision, digest: draft.preview!.digest }),
  ).rejects.toThrow(/lead/);
  expect(await publishedWebsite(slug)).toBeNull();
  await updateWebsite(a, { action: 'publish', slug, revision: draft.revision, digest: draft.preview!.digest });
  const live = await publishedWebsite(slug);
  expect(live?.programs).toEqual([{ name: 'Example programme', slug: 'grove-activity' }]);
  expect(live?.campaigns).toEqual([{ title: 'Example appeal', slug: 'fictional-example' }]);
  expect(await publishedWebsite('fictional-brook')).toBeNull();
  const after = await websiteStudio(a);
  await updateWebsite(a, {
    action: 'save',
    slug,
    revision: after.revision,
    draft: { ...after.draft, headline: 'Private edit' },
  });
  expect((await publishedWebsite(slug))?.headline).toBe('Community programmes');
  expect(
    (
      await rawQuery("SELECT 1 FROM audit_logs WHERE organization_id=$1 AND action='website.publish'", [
        a.organizationId,
      ])
    ).length,
  ).toBeGreaterThan(0);
});
it('rejects stale revisions, a different site in the same editing session, and changed source content', async () => {
  const s = await save();
  await expect(
    updateWebsite(a, { action: 'save', slug: 'fictional-brook', revision: s.revision, draft: s.draft }),
  ).rejects.toThrow(/changed/);
  await expect(updateWebsite(a, { action: 'save', slug, revision: s.revision - 1, draft: s.draft })).rejects.toThrow(
    /changed/,
  );
  await rawQuery("UPDATE programs SET name='Revised example' WHERE id=$1", [programId]);
  try {
    await expect(
      updateWebsite(a, { action: 'publish', slug, revision: s.revision, digest: s.preview!.digest }),
    ).rejects.toThrow(/preview changed/);
  } finally {
    await rawQuery("UPDATE programs SET name='Example programme' WHERE id=$1", [programId]);
  }
});
it('withdraws public access on suspension, global disable and unpublish', async () => {
  const current = await publish();
  await flag(false);
  expect(await publishedWebsite(slug)).toBeNull();
  await flag(true);
  await provisionWebsite(a.organizationId!, slug, false, a.userId);
  expect(await publishedWebsite(slug)).toBeNull();
  await provisionWebsite(a.organizationId!, slug, true, a.userId);
  expect((await publishedWebsite(slug))?.headline).toBe('Community programmes');
  const s = await websiteStudio(a);
  expect(s.revision).toBeGreaterThan(current.revision);
  await updateWebsite(a, { action: 'unpublish', slug, revision: s.revision });
  expect(await publishedWebsite(slug)).toBeNull();
});
it('serves published snapshots through the server and denies direct database-client access', async () => {
  await publish();
  await withAdminDb(async (db) => {
    const result = await db.query('SELECT public.get_published_organization_website($1) AS site', [slug]);
    expect(result.rows[0].site.headline).toBe('Community programmes');
    for (const role of ['anon', 'authenticated']) {
      const allowed = await db.query(
        "SELECT has_function_privilege($1,'public.get_published_organization_website(text)','EXECUTE') AS allowed",
        [role],
      );
      expect(allowed.rows[0].allowed).toBe(false);
    }
    await db.query('SET LOCAL ROLE anon');
    expect(
      (await db.query("SELECT has_table_privilege(current_user,'organization_websites','SELECT') AS allowed")).rows[0]
        .allowed,
    ).toBe(false);
    expect(
      (await db.query("SELECT has_table_privilege(current_user,'organization_website_enquiries','SELECT') AS allowed"))
        .rows[0].allowed,
    ).toBe(false);
  });
});
function enquiry(key: string, site = slug, email = 'visitor@example.org') {
  return enquire(
    buildRequest('/api/sites/' + site + '/enquiries', {
      method: 'POST',
      body: { requestKey: key, email, message: 'May I learn more?', consent: true },
    }),
    { params: Promise.resolve({ slug: site }) },
  );
}
it('delivers consented enquiries only to the published site inbox, deduplicates retries and limits bursts', async () => {
  expect((await enquiry(randomUUID())).status).toBe(404);
  await publish();
  const key = randomUUID();
  expect((await enquiry(key)).status).toBe(200);
  expect((await enquiry(key)).status).toBe(200);
  expect((await enquiry(key, slug, 'other@example.org')).status).toBe(409);
  const inbox = await websiteInbox(a);
  expect(inbox).toHaveLength(1);
  expect(await websiteInbox(b)).toEqual([]);
  await expect(handleWebsiteEnquiry(b, inbox[0].id)).rejects.toThrow(/not found/);
  await handleWebsiteEnquiry(staff, inbox[0].id);
  expect((await websiteInbox(a))[0].handled).toBe(true);
  for (let i = 0; i < 4; i++) expect((await enquiry(randomUUID())).status).toBe(200);
  expect((await enquiry(randomUUID())).status).toBe(429);
});
it('routes programme applications through entitled officer login and preserves reminder-only and member landings', () => {
  expect(programLoginDestination('/dashboard', 'grove-activity')).toBe('/programs#program-grove-activity');
  expect(programLoginDestination('/reminder', 'grove-activity')).toBe('/reminder');
  expect(programLoginDestination('/me', 'grove-activity')).toBe('/me');
  expect(programLoginDestination('/dashboard', null)).toBe('/dashboard');
});

it('keeps artwork tenant-scoped and publishes only the reviewed, normalized image', async () => {
  const { POST: upload } = await import('@/app/api/admin/organization/website/artwork/route');
  const { default: sharp } = await import('sharp');
  const { NextRequest } = await import('next/server');
  const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#224433' } })
    .png()
    .toBuffer();
  const url = 'http://localhost/api/admin/organization/website/artwork?alt=Sample%20cover';
  const uploaded = await upload(
    new NextRequest(url, { method: 'POST', headers: headers(a), body: new Uint8Array(bytes) }),
  );
  expect(uploaded.status).toBe(201);
  const { id } = (await uploaded.json()).data;
  const s = await websiteStudio(a);
  await updateWebsite(a, { action: 'save', slug, revision: s.revision, draft: { ...s.draft, coverId: id } });
  const preview = (await websiteStudio(a)).preview!.snapshot;
  expect(preview.cover?.src).toMatch(/^data:image\/webp;base64,/);
  expect(preview.cover?.alt).toBe('Sample cover');
  expect(await publishedWebsite(slug)).toBeNull();
  const other = await websiteStudio(b);
  await expect(
    updateWebsite(b, {
      action: 'save',
      slug: other.slug,
      revision: other.revision,
      draft: { ...other.draft, coverId: id },
    }),
  ).rejects.toThrow(/belonging/);
});

it('blocks enquiries after a lead publishes a revision with enquiries closed', async () => {
  const saved = await publish();
  await updateWebsite(a, {
    action: 'save',
    slug,
    revision: saved.revision,
    draft: { ...saved.draft, acceptEnquiries: false },
  });
  const reviewed = await websiteStudio(a);
  await updateWebsite(a, { action: 'publish', slug, revision: reviewed.revision, digest: reviewed.preview!.digest });
  expect((await enquiry(randomUUID())).status).toBe(404);
  expect(await websiteInbox(a)).toEqual([]);
});

it('returns a validation response for unreadable or oversized website commands', async () => {
  const { NextRequest } = await import('next/server');
  const post = (body: string) =>
    manage(new NextRequest('http://localhost' + path, { method: 'POST', headers: headers(a), body }));
  expect((await post('{')).status).toBe(422);
  expect((await post('x'.repeat(65 * 1024))).status).toBe(413);
});
