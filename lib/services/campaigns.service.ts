/**
 * Changi$ha fundraising campaigns (migration 182).
 *
 * Lifecycle: draft -> pending_review -> active (public + donatable) ->
 * completed/cancelled, or -> rejected. See the migration's own header for why
 * campaigns are the one surface on this platform an admin reviews before it
 * can take money from someone who was never authenticated.
 *
 * Public read functions (getPublicCampaignBySlug/listActiveCampaigns) take no
 * TenantContext and read via withAdminDb with an explicit `status = 'active'`
 * filter baked into the SQL — never through PostgREST/anon grants (see the
 * migration header on why). Donation settlement lives in
 * mpesa-stk.service.ts's applyCampaignDonationFromSTK, not here — this module
 * only creates/reviews campaigns and reads them back.
 */
import type { PoolClient } from 'pg';
import { withDb, withTransaction, withAdminDb, type TenantContext } from '@/lib/db';
import { NotFoundError, ForbiddenError, ValidationError } from '@/lib/utils/errors';

export type CampaignStatus =
  | 'draft' | 'pending_review' | 'active' | 'completed' | 'cancelled' | 'rejected';

export interface Campaign {
  id:               string;
  group_id:         string;
  title:            string;
  slug:             string;
  story:            string;
  beneficiary_name: string | null;
  target_amount:    string;
  amount_raised:    string;
  currency:         string;
  cover_image_url:  string | null;
  status:           CampaignStatus;
  rejection_reason: string | null;
  created_by:       string;
  reviewed_by:      string | null;
  reviewed_at:      string | null;
  ends_at:          string | null;
  created_at:       string;
  updated_at:       string;
}

export interface CampaignDonation {
  id:                   string;
  campaign_id:          string;
  group_id:             string;
  donor_name:           string | null;
  donor_phone:          string;
  amount:               string;
  message:              string | null;
  is_anonymous:         boolean;
  mpesa_receipt_number: string | null;
  status:               'pending' | 'completed' | 'failed';
  created_at:           string;
}

export interface CreateCampaignInput {
  title:            string;
  story:            string;
  targetAmount:     number;
  beneficiaryName?: string;
  coverImageUrl?:   string;
  endsAt?:          string;
}

const OFFICER_ROLES = ['chairperson', 'treasurer', 'secretary'];

function assertOfficer(ctx: TenantContext): void {
  if (!OFFICER_ROLES.includes(ctx.role)) {
    throw new ForbiddenError('Only a chairperson, treasurer or secretary can manage campaigns');
  }
}

/** `Water for Kianjege` -> `water-for-kianjege`. Matches the migration's
 *  `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'` CHECK exactly. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function uniqueSlug(db: PoolClient, title: string): Promise<string> {
  const base = slugify(title) || 'campaign';
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { rows } = await db.query('SELECT 1 FROM campaigns WHERE slug = $1', [candidate]);
    if (!rows[0]) return candidate;
  }
  // Astronomically unlikely (20 title collisions), but never loop forever.
  return `${base}-${Date.now()}`;
}

export const campaignsService = {
  async createCampaign(ctx: TenantContext, data: CreateCampaignInput): Promise<Campaign> {
    assertOfficer(ctx);
    if (!(data.targetAmount > 0)) throw new ValidationError('Target amount must be positive');

    return withTransaction(ctx, async (db) => {
      const slug = await uniqueSlug(db, data.title);

      const { rows } = await db.query<Campaign>(
        `INSERT INTO campaigns
           (group_id, title, slug, story, beneficiary_name, target_amount,
            cover_image_url, ends_at, created_by, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft')
         RETURNING *`,
        [
          ctx.groupId, data.title, slug, data.story, data.beneficiaryName ?? null,
          data.targetAmount.toFixed(2), data.coverImageUrl ?? null, data.endsAt ?? null,
          ctx.userId,
        ],
      );
      const campaign = rows[0];

      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          ctx.groupId, ctx.userId, 'campaign.create', 'campaign', campaign.id, null,
          JSON.stringify({ title: campaign.title, target_amount: campaign.target_amount, status: 'draft' }),
        ],
      );

      return campaign;
    });
  },

  async submitForReview(ctx: TenantContext, campaignId: string): Promise<Campaign> {
    assertOfficer(ctx);
    return withTransaction(ctx, async (db) => {
      const { rows: existing } = await db.query<Campaign>(
        `SELECT * FROM campaigns WHERE id = $1 AND group_id = $2 FOR UPDATE`,
        [campaignId, ctx.groupId],
      );
      if (!existing[0]) throw new NotFoundError('Campaign', campaignId);
      if (existing[0].status !== 'draft') {
        throw new ValidationError(`Only a draft campaign can be submitted for review (current status: ${existing[0].status})`);
      }

      const { rows: updated } = await db.query<Campaign>(
        `UPDATE campaigns SET status = 'pending_review', updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [campaignId],
      );

      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          ctx.groupId, ctx.userId, 'campaign.submit_for_review', 'campaign', campaignId,
          JSON.stringify({ status: 'draft' }), JSON.stringify({ status: 'pending_review' }),
        ],
      );

      return updated[0];
    });
  },

  async listGroupCampaigns(ctx: TenantContext): Promise<Campaign[]> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<Campaign>(
        `SELECT * FROM campaigns WHERE group_id = $1 ORDER BY created_at DESC`,
        [ctx.groupId],
      );
      return rows;
    });
  },

  async listDonationsForCampaign(ctx: TenantContext, campaignId: string): Promise<CampaignDonation[]> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<CampaignDonation>(
        `SELECT * FROM campaign_donations
         WHERE  campaign_id = $1 AND group_id = $2 AND status = 'completed'
         ORDER  BY created_at DESC`,
        [campaignId, ctx.groupId],
      );
      return rows;
    });
  },

  async getGroupCampaignById(ctx: TenantContext, id: string): Promise<Campaign> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<Campaign>(
        `SELECT * FROM campaigns WHERE id = $1 AND group_id = $2`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Campaign', id);
      return rows[0];
    });
  },

  // ── Public reads (no ctx — see module header) ───────────────────────────

  async listActiveCampaigns(): Promise<Campaign[]> {
    return withAdminDb(async (db) => {
      const { rows } = await db.query<Campaign>(
        `SELECT * FROM campaigns WHERE status = 'active' ORDER BY created_at DESC`,
      );
      return rows;
    });
  },

  async getPublicCampaignBySlug(slug: string): Promise<Campaign | null> {
    return withAdminDb(async (db) => {
      const { rows } = await db.query<Campaign>(
        `SELECT * FROM campaigns WHERE slug = $1 AND status = 'active'`,
        [slug],
      );
      return rows[0] ?? null;
    });
  },

  async getPublicDonationCount(campaignId: string): Promise<number> {
    return withAdminDb(async (db) => {
      const { rows } = await db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM campaign_donations WHERE campaign_id = $1 AND status = 'completed'`,
        [campaignId],
      );
      return parseInt(rows[0]?.count ?? '0', 10);
    });
  },

  // ── Admin review (system/platform-admin only, no tenant scoping) ────────

  async listPendingCampaigns(): Promise<Campaign[]> {
    return withAdminDb(async (db) => {
      const { rows } = await db.query<Campaign>(
        `SELECT * FROM campaigns WHERE status = 'pending_review' ORDER BY created_at ASC`,
      );
      return rows;
    });
  },

  async approveCampaign(adminUserId: string, campaignId: string): Promise<Campaign> {
    return withAdminDb(async (db) => {
      const { rows: existing } = await db.query<Campaign>(
        `SELECT * FROM campaigns WHERE id = $1 AND status = 'pending_review' FOR UPDATE`,
        [campaignId],
      );
      if (!existing[0]) throw new NotFoundError('Pending campaign', campaignId);

      const { rows: updated } = await db.query<Campaign>(
        `UPDATE campaigns
         SET status = 'active', reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [campaignId, adminUserId],
      );

      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          existing[0].group_id, adminUserId, 'campaign.approve', 'campaign', campaignId,
          JSON.stringify({ status: 'pending_review' }), JSON.stringify({ status: 'active' }),
        ],
      );

      return updated[0];
    });
  },

  async rejectCampaign(adminUserId: string, campaignId: string, reason: string): Promise<Campaign> {
    if (!reason.trim()) throw new ValidationError('A rejection reason is required');
    return withAdminDb(async (db) => {
      const { rows: existing } = await db.query<Campaign>(
        `SELECT * FROM campaigns WHERE id = $1 AND status = 'pending_review' FOR UPDATE`,
        [campaignId],
      );
      if (!existing[0]) throw new NotFoundError('Pending campaign', campaignId);

      const { rows: updated } = await db.query<Campaign>(
        `UPDATE campaigns
         SET status = 'rejected', rejection_reason = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [campaignId, reason, adminUserId],
      );

      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          existing[0].group_id, adminUserId, 'campaign.reject', 'campaign', campaignId,
          JSON.stringify({ status: 'pending_review' }), JSON.stringify({ status: 'rejected', rejection_reason: reason }),
        ],
      );

      return updated[0];
    });
  },
};
