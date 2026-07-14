export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { ok, handleError } from '@/lib/utils/response';

/**
 * GET /api/v1/auth/memberships — the signed-in member's active memberships,
 * for the group switcher (payment architecture §8): group, role, Membership
 * Number, and a savings-balance snapshot per membership.
 *
 * Snapshot = sum of completed contributions on that membership. Cheap at
 * current scale; becomes a cached read model when volumes demand it.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    try {
      const items = await withAdminDb(async (client) => {
        const { rows } = await client.query(
          `SELECT gm.id            AS membership_id,
                  gm.group_id,
                  gm.role,
                  gm.membership_no,
                  gm.display_alias,
                  g.group_code,
                  g.name           AS group_name,
                  g.status         AS group_status,
                  COALESCE((
                    SELECT SUM(c.amount)
                    FROM   contributions c
                    WHERE  c.group_membership_id = gm.id AND c.status = 'completed'
                  ), 0)::text      AS savings_balance
           FROM   group_members gm
           JOIN   groups g ON g.id = gm.group_id
           WHERE  gm.member_id = $1
             AND  gm.status = 'active'
             AND  g.status NOT IN ('suspended','archived')
           ORDER  BY g.name`,
          [auth.userId],
        );
        return rows;
      });

      return ok({
        items: items.map((r) => ({
          membershipId:   r.membership_id,
          groupId:        r.group_id,
          groupCode:      r.group_code,
          groupName:      r.group_name,
          role:           r.role,
          membershipNo:   r.membership_no,
          displayAlias:   r.display_alias,
          savingsBalance: r.savings_balance,
          isCurrent:      r.group_id === auth.groupId,
        })),
      });
    } catch (err) {
      return handleError(err);
    }
  });
}
