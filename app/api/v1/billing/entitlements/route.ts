export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { ok } from '@/lib/utils/response';
import type { SubscriptionProduct } from '@/types/enums';

/**
 * What this group is entitled to, and what it signed up for.
 *
 * Deliberately under /api/v1/billing, which lib/auth/subscription-gate.ts
 * treats as 'open': a group with ZERO subscriptions has to be able to read this
 * to render its own subscribe page. Behind the lock it would be unreachable
 * exactly when it matters most.
 *
 * `products` is the live entitlement — it is what the portals gate on. Product
 * is NOT a JWT claim on purpose: the server gate re-reads live so that paying
 * unlocks immediately, and a token claim would keep the client denying for a
 * full access-token TTL after payment, with client and server actively
 * disagreeing about a fact the user just paid money to change.
 *
 * `signupProduct` answers what a NEVER-PAID group came for, which `products`
 * cannot: since migration 139 a new group holds no subscription at all, so
 * without this a standalone Chama Reminder registrant would be indistinguishable
 * from an unpaid Kitabu Yetu one and would be sent to the wrong subscribe page.
 *
 * withAdminDb rather than withDb: this is the group's own billing state, read
 * by group_id, and a locked group must be able to read it regardless of RLS
 * session setup.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const { products, signupProduct } = await withAdminDb(async (db) => {
      const [subs, group] = await Promise.all([
        db.query<{ product: SubscriptionProduct }>(
          `SELECT DISTINCT product FROM subscriptions
           WHERE group_id = $1 AND status IN ('active', 'trial')
           ORDER BY product`,
          [auth.groupId],
        ),
        db.query<{ signup_product: SubscriptionProduct }>(
          `SELECT signup_product FROM groups WHERE id = $1`,
          [auth.groupId],
        ),
      ]);
      return {
        products:      subs.rows.map((r) => r.product),
        signupProduct: group.rows[0]?.signup_product ?? 'kitabu_yetu',
      };
    });

    return ok({ products, signupProduct });
  });
}
