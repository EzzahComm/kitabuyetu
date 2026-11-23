import { withAdminDb } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/utils/errors';
import type { EnterpriseIntegrationClient } from './config';

export async function readEnterprisePlan(client: EnterpriseIntegrationClient) {
  return withAdminDb(async (db) => {
    const { rows } = await db.query(
      `SELECT o.id AS organization_id, s.id AS subscription_id, s.plan_type, s.monthly_fee,
              s.max_linked_groups, s.max_staff, s.max_funding_programs, s.started_at
       FROM organizations o
       JOIN organization_subscriptions s ON s.organization_id = o.id AND s.status = 'active'
       WHERE o.id = $1 AND o.is_active`,
      [client.organizationId],
    );
    if (!rows[0]) throw new NotFoundError('Active Enterprise plan');
    return { ...rows[0], currency: 'KES' };
  });
}

export async function readEnterpriseGroupProducts(client: EnterpriseIntegrationClient, groupId: string) {
  if (!client.products.length)
    throw new AppError('This integration has no product grants.', 'PRODUCT_GRANT_REQUIRED', 403);
  return withAdminDb(async (db) => {
    const { rows } = await db.query(
      `SELECT g.id AS group_id, COALESCE(json_agg(
          json_build_object('product', s.product, 'plan_type', s.plan_type, 'expires_at', s.expires_at)
          ORDER BY s.product) FILTER (WHERE s.id IS NOT NULL), '[]'::json) AS products
       FROM organization_group_access a
       JOIN organizations o ON o.id = a.organization_id AND o.is_active
       JOIN organization_subscriptions p ON p.organization_id = o.id AND p.status = 'active'
       JOIN groups g ON g.id = a.group_id
       LEFT JOIN subscriptions s ON s.group_id = g.id
         AND s.product = ANY($3::subscription_product[])
         AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > NOW())
       WHERE a.organization_id = $1 AND a.group_id = $2 AND a.status = 'approved' AND a.is_active
       GROUP BY g.id`,
      [client.organizationId, groupId, client.products],
    );
    if (!rows[0]) throw new NotFoundError('Linked group');
    return rows[0];
  });
}
