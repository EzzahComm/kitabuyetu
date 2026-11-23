import type { NextRequest } from 'next/server';
import sharp from 'sharp';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { withWebsiteEditor } from '@/lib/services/organization-websites.service';
import { readLimitedBody } from '@/lib/websites/request-body';
import { ValidationError } from '@/lib/utils/errors';
import { ok } from '@/lib/utils/response';

export function POST(req: NextRequest) {
  return withOrganizationAccess(req, 'organization.branding.manage', async (ctx) =>
    withWebsiteEditor(ctx, async (db, org) => {
      const alt = (req.nextUrl.searchParams.get('alt') ?? '').trim();
      if (!alt || alt.length > 180 || /[<>]/.test(alt))
        throw new ValidationError('Enter a plain text image description (1–180 characters).');
      const bytes = await readLimitedBody(req, 2 * 1024 * 1024);
      const source = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'error' });
      let webp: Buffer;
      try {
        const { format, pages } = await source.metadata();
        if (!format || !['png', 'jpeg', 'webp'].includes(format) || (pages ?? 1) > 1) throw new Error();
        webp = await source
          .rotate()
          .resize({ width: 1120, height: 840, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 70 })
          .toBuffer();
      } catch {
        throw new ValidationError('Use a single JPEG, PNG or WebP image up to 16 megapixels.');
      }
      if (webp.length > 180000) throw new ValidationError('Choose a smaller image.');
      await db.query('SELECT 1 FROM organization_websites WHERE organization_id=$1 FOR UPDATE', [org]);
      const count = (
        await db.query('SELECT count(*)::int AS n FROM organization_website_artwork WHERE organization_id=$1', [org])
      ).rows[0].n;
      if (count >= 20) throw new ValidationError('This website already has 20 uploaded images.');
      const result = await db.query(
        'INSERT INTO organization_website_artwork(organization_id,alt,webp) VALUES($1,$2,$3) RETURNING id,alt',
        [org, alt, webp],
      );
      return ok(result.rows[0], 201);
    }),
  );
}

export function DELETE(req: NextRequest) {
  return withOrganizationAccess(req, 'organization.branding.manage', async (ctx) =>
    withWebsiteEditor(ctx, async (db, org) => {
      const id = req.nextUrl.searchParams.get('id');
      if (!id || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))
        throw new ValidationError('Choose an image.');
      const {
        rows: [site],
      } = await db.query('SELECT draft FROM organization_websites WHERE organization_id=$1 FOR UPDATE', [org]);
      if (site.draft.logoId === id || site.draft.coverId === id)
        throw new ValidationError('Remove the image from the draft and save before deleting it.');
      const removed = await db.query('DELETE FROM organization_website_artwork WHERE organization_id=$1 AND id=$2', [
        org,
        id,
      ]);
      if (!removed.rowCount) throw new ValidationError('Image is unavailable.');
      return ok({ removed: true });
    }),
  );
}
