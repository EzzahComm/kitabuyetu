import { ZodError } from 'zod';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withAdminDb, type TenantContext } from '@/lib/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/utils/errors';
import {
  draftSchema,
  initialDraft,
  siteSlug,
  siteFields,
  snapshotSchema,
  type WebsiteSnapshot,
  type WebsiteCommand,
  type WebsiteDraft,
} from '@/lib/websites/content';

interface Site {
  slug: string;
  enabled: boolean;
  revision: number;
  publication: number | null;
  draft: WebsiteDraft;
}
async function audit(db: PoolClient, org: string, actor: string | null, action: string, revision: number) {
  await db.query(
    `INSERT INTO audit_logs(organization_id,actor_id,action,resource_type,resource_id,new_values)
    VALUES ($1,$2,$3,'organization_website',$1,$4)`,
    [org, actor, 'website.' + action, JSON.stringify({ revision })],
  );
}
export async function websiteGrant(org: string) {
  return withAdminDb(
    async (db) =>
      (
        await db.query<{ slug: string; enabled: boolean }>(
          'SELECT slug,enabled FROM organization_websites WHERE organization_id=$1',
          [org],
        )
      ).rows[0] ?? null,
  );
}
// Platform-admin route supplies org explicitly. Organization editors never use this path.
export async function provisionWebsite(
  org: string,
  slug: string,
  enabled: boolean,
  actor: string | null,
  editorial?: Omit<WebsiteSnapshot, 'programs' | 'campaigns' | 'logo' | 'cover'>,
) {
  siteSlug.parse(slug);
  return withAdminDb(async (db) => {
    const profile = (
      await db.query<{ name: string }>('SELECT name FROM organizations WHERE id=$1 AND is_active FOR UPDATE', [org])
    ).rows[0];
    if (!profile) throw new NotFoundError('Active organization');
    const previous = (
      await db.query<Site>(
        'SELECT slug,enabled,revision FROM organization_websites WHERE organization_id=$1 FOR UPDATE',
        [org],
      )
    ).rows[0];
    if (previous && editorial) throw new ConflictError('Edit existing website copy in Website Studio.');
    if (previous && previous.slug !== slug) throw new ConflictError('This organization already has a website address.');
    if (previous?.enabled === enabled) return { slug, enabled };
    if (!previous && !enabled) throw new ValidationError('Create the website before suspending it.');
    const result = await db.query<{ revision: number }>(
      `INSERT INTO organization_websites(organization_id,slug,draft,enabled)
      VALUES ($1,$2,$3,$4) ON CONFLICT (organization_id) DO UPDATE SET enabled=excluded.enabled,
      revision=organization_websites.revision+1,updated_at=now() RETURNING revision`,
      [
        org,
        slug,
        JSON.stringify({ ...initialDraft(profile.name), ...(editorial ? siteFields.parse(editorial) : {}) }),
        enabled,
      ],
    );
    await audit(db, org, actor, enabled ? 'grant' : 'suspend', result.rows[0].revision);
    return { slug, enabled };
  });
}
async function editorContext(db: PoolClient, ctx: TenantContext) {
  if (!ctx.organizationId) throw new ForbiddenError('Select your organization.');
  const row = (
    await db.query<{ role: string }>(
      `SELECT om.org_role AS role FROM organization_members om
    JOIN organizations o ON o.id=om.organization_id AND o.is_active
    JOIN members m ON m.id=om.member_id AND m.is_active AND m.platform_role IN ('organization_coordinator','super_admin')
    WHERE om.organization_id=$1 AND om.member_id=$2 AND om.status='active'
    AND EXISTS(SELECT 1 FROM feature_flags WHERE key='websites_enabled' AND enabled AND applies_to='all' AND rollout_pct=100)
    FOR SHARE OF om,o,m`,
      [ctx.organizationId, ctx.userId],
    )
  ).rows[0];
  if (!row) throw new ForbiddenError('Website Studio is unavailable for this account.');
  return row.role;
}
async function options(db: PoolClient, org: string) {
  const programs = (
    await db.query<{ id: string; name: string; slug: string }>(
      "SELECT id,name,slug FROM programs WHERE organization_id=$1 AND status='published' ORDER BY name,id",
      [org],
    )
  ).rows;
  const campaigns = (
    await db.query<{ id: string; title: string; slug: string }>(
      `SELECT c.id,c.title,c.slug FROM campaigns c
    JOIN organization_group_access a ON a.group_id=c.group_id
    WHERE a.organization_id=$1 AND a.is_active AND a.status='approved' AND c.status='active' ORDER BY c.title,c.id`,
      [org],
    )
  ).rows;
  const artwork = (
    await db.query<{ id: string; alt: string }>(
      'SELECT id,alt FROM organization_website_artwork WHERE organization_id=$1 ORDER BY created_at',
      [org],
    )
  ).rows;
  return { programs, campaigns, artwork };
}
type Options = Awaited<ReturnType<typeof options>>;
async function project(db: PoolClient, org: string, draft: WebsiteDraft, choices: Options) {
  const { programIds, campaignIds, logoId, coverId, ...editorial } = draftSchema.parse(draft);
  const programs = programIds.map((id) => choices.programs.find((p) => p.id === id));
  const campaigns = campaignIds.map((id) => choices.campaigns.find((c) => c.id === id));
  if (programs.some((p) => !p) || campaigns.some((c) => !c))
    throw new ValidationError('Remove sources that are no longer eligible for publication.');
  const ids = [logoId, coverId].filter((id): id is string => id !== null);
  const artwork = (
    await db.query<{ id: string; alt: string; webp: Buffer }>(
      'SELECT id,alt,webp FROM organization_website_artwork WHERE organization_id=$1 AND id=ANY($2::uuid[])',
      [org, ids],
    )
  ).rows;
  function picture(id: string | null) {
    if (!id) return null;
    const image = artwork.find((row) => row.id === id);
    if (!image) throw new ValidationError('Choose artwork belonging to this website.');
    return { alt: image.alt, src: 'data:image/webp;base64,' + image.webp.toString('base64') };
  }
  const snapshot = snapshotSchema.parse({
    ...editorial,
    logo: picture(logoId),
    cover: picture(coverId),
    programs: programs.map((p) => ({ name: p!.name, slug: p!.slug })),
    campaigns: campaigns.map((c) => ({ title: c!.title, slug: c!.slug })),
  });
  return { snapshot, digest: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
}
async function readSite(db: PoolClient, org: string, lock: boolean) {
  const row = (
    await db.query<Site>(
      `SELECT slug,draft,enabled,revision,publication FROM organization_websites
    WHERE organization_id=$1 AND enabled ${lock ? 'FOR UPDATE' : ''}`,
      [org],
    )
  ).rows[0];
  if (!row) throw new NotFoundError('Enabled website');
  return row;
}
export async function websiteStudio(ctx: TenantContext) {
  return withAdminDb(async (db) => {
    const role = await editorContext(db, ctx);
    const org = ctx.organizationId!;
    const site = await readSite(db, org, false);
    const choices = await options(db, org);
    let preview = null;
    try {
      preview = await project(db, org, site.draft, choices);
    } catch (err) {
      if (!(err instanceof ValidationError) && !(err instanceof ZodError)) throw err;
    }
    return { ...site, choices, preview, canPublish: role === 'lead' };
  });
}
export async function updateWebsite(ctx: TenantContext, command: WebsiteCommand) {
  return withAdminDb(async (db) => {
    const role = await editorContext(db, ctx);
    const org = ctx.organizationId!;
    const site = await readSite(db, org, true);
    if (command.action !== 'save' && role !== 'lead')
      throw new ForbiddenError('Only an active organization lead can publish or withdraw a website.');
    if (command.slug !== site.slug || command.revision !== site.revision)
      throw new ConflictError('The website changed. Reload and review the latest draft.');
    const revision = site.revision + 1;
    if (command.action === 'save') {
      await project(db, org, command.draft, await options(db, org));
      await db.query(
        'UPDATE organization_websites SET draft=$2, revision=$3,updated_at=now() WHERE organization_id=$1',
        [org, JSON.stringify(command.draft), revision],
      );
    } else {
      if (command.action === 'publish') {
        const { snapshot, digest } = await project(db, org, site.draft, await options(db, org));
        if (digest !== command.digest)
          throw new ConflictError('The public preview changed. Reload and review it before publishing.');
        await db.query(
          'INSERT INTO organization_website_publications(organization_id,revision,snapshot,published_by) VALUES ($1,$2,$3,$4)',
          [org, revision, JSON.stringify(snapshot), ctx.userId],
        );
      }
      await db.query(
        'UPDATE organization_websites SET publication=$2,revision=$3,updated_at=now() WHERE organization_id=$1',
        [org, command.action === 'publish' ? revision : null, revision],
      );
    }
    await audit(db, org, ctx.userId, command.action, revision);
    return { revision };
  });
}
export async function publishedWebsite(slug: string) {
  if (!siteSlug.safeParse(slug).success) return null;
  return withAdminDb(async (db) => {
    const data = (await db.query('SELECT public.get_published_organization_website($1) AS site', [slug])).rows[0].site;
    return data ? snapshotSchema.parse(data) : null;
  });
}

export async function hasWebsiteStudio(ctx: TenantContext) {
  if (!ctx.organizationId) return false;
  return withAdminDb(
    async (db) =>
      (
        await db.query(
          `SELECT 1 FROM organization_websites w
    JOIN organizations o ON o.id=w.organization_id AND o.is_active
    JOIN organization_members om ON om.organization_id=w.organization_id AND om.status='active'
    JOIN members m ON m.id=om.member_id AND m.is_active AND m.platform_role IN ('organization_coordinator','super_admin')
    JOIN feature_flags f ON f.key='websites_enabled' AND f.enabled AND f.applies_to='all' AND f.rollout_pct=100
    WHERE w.organization_id=$1 AND w.enabled AND om.member_id=$2`,
          [ctx.organizationId, ctx.userId],
        )
      ).rowCount === 1,
  );
}
export function withWebsiteEditor<T>(ctx: TenantContext, action: (db: PoolClient, org: string) => Promise<T>) {
  return withAdminDb(async (db) => {
    await editorContext(db, ctx);
    await readSite(db, ctx.organizationId!, false);
    return action(db, ctx.organizationId!);
  });
}
