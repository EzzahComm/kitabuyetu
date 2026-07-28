export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withBackofficeAuth } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { ok, handleError } from '@/lib/utils/response';

/**
 * GET /api/admin/auth/my-organizations — every organization the signed-in
 * backoffice member is currently active staff at (multi-staff organizations,
 * migration 101), for WorkspaceSwitcher. Mirrors GET /api/v1/auth/memberships'
 * role on the tenant side (the consumer group switcher).
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withBackofficeAuth(req, async (auth) => {
    try {
      const items = await withAdminDb(async (client) => {
        const { rows } = await client.query<{ id: string; name: string; type: string; org_role: 'lead' | 'staff' }>(
          `SELECT o.id, o.name, o.type, om.org_role
           FROM organization_members om
           JOIN organizations o ON o.id = om.organization_id
           WHERE om.member_id = $1 AND om.status = 'active' AND o.is_active = TRUE
           ORDER BY o.name`,
          [auth.userId],
        );
        return rows;
      });

      return ok({
        items: items.map((r) => ({
          organizationId:   r.id,
          organizationName: r.name,
          organizationType: r.type,
          orgRole:          r.org_role,
        })),
      });
    } catch (err) {
      return handleError(err);
    }
  });
}
