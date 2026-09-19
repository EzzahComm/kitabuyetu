/**
 * Marketing campaign service — audiences + cross-channel campaign
 * orchestration (Phase 9.2, SMS channel only).
 *
 * Deliberately thin: the actual SMS send reuses smsService.sendBulkCampaign
 * unchanged (billing, opt-out suppression, segment counting, provider
 * dispatch all inherited for free). This service only owns audience
 * resolution, the approval workflow, and marketing_campaigns' own status
 * machine — none of which existed before this table.
 */

import { PoolClient } from 'pg';
import { withDb, withAdminDb, type TenantContext } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { resolveSmsRecipients } from '@/lib/services/sms.service';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';

export type AudienceSource = 'all_members' | 'active_members' | 'crm_contacts_opted_in';

export interface Audience {
  id: string;
  group_id: string;
  name: string;
  source: AudienceSource;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export type CampaignStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'sending' | 'completed' | 'cancelled';

export interface Campaign {
  id: string;
  group_id: string;
  title: string;
  channel: 'sms';
  message: string;
  audience_id: string;
  status: CampaignStatus;
  rejection_reason?: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  created_by: string;
  reviewed_by?: string;
  reviewed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// AUDIENCES
// ============================================================================

export async function createAudience(
  ctx: TenantContext,
  data: { name: string; source: AudienceSource },
): Promise<Audience> {
  if (!data.name.trim()) throw new ValidationError('Audience name is required');

  return withDb(ctx, async (db) => {
    const result = await db.query<Audience>(
      `INSERT INTO marketing_audiences (group_id, name, source, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [ctx.groupId, data.name, data.source, ctx.userId],
    );
    return result.rows[0];
  });
}

export async function listAudiences(ctx: TenantContext): Promise<Audience[]> {
  return withDb(ctx, async (db) => {
    const result = await db.query<Audience>(`SELECT * FROM marketing_audiences ORDER BY name`);
    return result.rows;
  });
}

/**
 * Resolve an audience source to phones, at whatever moment it's called.
 * 'all_members'/'active_members' reuse resolveSmsRecipients() exactly —
 * the same group-membership resolution the ad-hoc /sms/bulk route uses, so
 * the two paths cannot disagree about who a group's members are.
 * 'crm_contacts_opted_in' only ever returns contacts with marketing_opt_in
 * = true — the consent gate from migration 192 is structural here, not a
 * check this function could accidentally skip.
 */
async function resolveAudiencePhones(
  db: PoolClient,
  groupId: string,
  audience: Audience,
): Promise<{ target_type: 'member' | 'crm_contact'; target_id: string; phone: string }[]> {
  if (audience.source === 'all_members' || audience.source === 'active_members') {
    // resolveSmsRecipients opens its own tenant-pool connection via
    // systemCtx(groupId) — a second, short-lived connection alongside the
    // caller's `db`, not a nested transaction. Acceptable here: this runs
    // once per campaign approval, not on a hot path.
    const phones = await resolveSmsRecipients(groupId, audience.source, undefined);
    return phones.map((phone) => ({ target_type: 'member' as const, target_id: groupId, phone }));
  }

  // crm_contacts_opted_in
  const result = await db.query<{ id: string; phone: string }>(
    `SELECT id, phone FROM crm_contacts
     WHERE group_id = $1 AND marketing_opt_in = true AND phone IS NOT NULL`,
    [groupId],
  );
  return result.rows.map((r) => ({ target_type: 'crm_contact' as const, target_id: r.id, phone: r.phone }));
}

// ============================================================================
// CAMPAIGNS
// ============================================================================

export async function createCampaign(
  ctx: TenantContext,
  data: { title: string; message: string; audience_id: string },
): Promise<Campaign> {
  if (!data.title.trim()) throw new ValidationError('Campaign title is required');
  if (!data.message.trim()) throw new ValidationError('Campaign message is required');

  return withDb(ctx, async (db) => {
    const result = await db.query<Campaign>(
      `INSERT INTO marketing_campaigns (group_id, title, message, audience_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [ctx.groupId, data.title, data.message, data.audience_id, ctx.userId],
    );
    return result.rows[0];
  });
}

export async function listCampaigns(ctx: TenantContext): Promise<Campaign[]> {
  return withDb(ctx, async (db) => {
    const result = await db.query<Campaign>(`SELECT * FROM marketing_campaigns ORDER BY created_at DESC`);
    return result.rows;
  });
}

export async function getCampaignById(ctx: TenantContext, id: string): Promise<Campaign | null> {
  return withDb(ctx, async (db) => {
    const result = await db.query<Campaign>(`SELECT * FROM marketing_campaigns WHERE id = $1`, [id]);
    return result.rows.length ? result.rows[0] : null;
  });
}

export async function submitForReview(ctx: TenantContext, campaignId: string): Promise<Campaign> {
  return withDb(ctx, async (db) => {
    const result = await db.query<Campaign>(
      `UPDATE marketing_campaigns SET status = 'pending_review', updated_at = NOW()
       WHERE id = $1 AND status = 'draft' RETURNING *`,
      [campaignId],
    );

    if (!result.rows.length) throw new NotFoundError('Campaign not found, or not in draft status');
    return result.rows[0];
  });
}

export async function cancelCampaign(ctx: TenantContext, campaignId: string): Promise<Campaign> {
  return withDb(ctx, async (db) => {
    const result = await db.query<Campaign>(
      `UPDATE marketing_campaigns SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status IN ('draft', 'pending_review') RETURNING *`,
      [campaignId],
    );

    if (!result.rows.length) throw new NotFoundError('Campaign not found, or already sent/reviewed');
    return result.rows[0];
  });
}

/**
 * Approve + launch, atomically: resolves the audience into a frozen
 * marketing_audience_members snapshot, marks the campaign 'sending', and
 * enqueues the SMS dispatch job — all in one transaction, so a campaign
 * never sits 'approved' with no send in flight.
 *
 * Maker-checker: ctx.userId must not be the campaign's own creator, and must
 * hold the chairperson role — mirrors disbursements.service.ts's approver-
 * != initiator pattern. The DB CHECK (migration 193) is the real backstop;
 * this is the friendlier application-level error.
 */
export async function approveCampaign(ctx: TenantContext, campaignId: string): Promise<Campaign> {
  if (ctx.role !== 'chairperson') {
    throw new ForbiddenError('Only the chairperson can approve a marketing campaign');
  }

  return withDb(ctx, async (db) => {
    const { rows: campaignRows } = await db.query<Campaign>(
      `SELECT * FROM marketing_campaigns WHERE id = $1 AND status = 'pending_review'`,
      [campaignId],
    );
    const campaign = campaignRows[0];
    if (!campaign) throw new NotFoundError('Campaign not found, or not pending review');

    if (campaign.created_by === ctx.userId) {
      throw new ForbiddenError('The campaign creator cannot approve their own campaign');
    }

    const { rows: audienceRows } = await db.query<Audience>(
      `SELECT * FROM marketing_audiences WHERE id = $1`,
      [campaign.audience_id],
    );
    const audience = audienceRows[0];
    if (!audience) throw new NotFoundError('Audience not found');

    const recipients = await resolveAudiencePhones(db, campaign.group_id, audience);
    if (!recipients.length) {
      throw new ValidationError('This audience currently resolves to zero recipients — nothing to send');
    }

    for (const r of recipients) {
      await db.query(
        `INSERT INTO marketing_audience_members (campaign_id, audience_id, target_type, target_id, phone)
         VALUES ($1, $2, $3, $4, $5)`,
        [campaignId, audience.id, r.target_type, r.target_id, r.phone],
      );
    }

    const { rows: updated } = await db.query<Campaign>(
      `UPDATE marketing_campaigns
       SET status = 'sending', recipient_count = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [campaignId, recipients.length, ctx.userId],
    );

    await enqueueJob(
      'marketing_campaign_sms_send',
      {
        campaignId,
        groupId: campaign.group_id,
        sentBy: ctx.userId,
        message: campaign.message,
        phones: recipients.map((r) => r.phone),
      },
      { priority: 7, max_attempts: 3, dedup_key: `marketing_campaign_send:${campaignId}` },
    );

    return updated[0];
  });
}

export async function rejectCampaign(ctx: TenantContext, campaignId: string, reason: string): Promise<Campaign> {
  if (ctx.role !== 'chairperson') {
    throw new ForbiddenError('Only the chairperson can reject a marketing campaign');
  }
  if (!reason.trim()) throw new ValidationError('A rejection reason is required');

  return withDb(ctx, async (db) => {
    const result = await db.query<Campaign>(
      `UPDATE marketing_campaigns
       SET status = 'rejected', rejection_reason = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'pending_review' RETURNING *`,
      [campaignId, reason, ctx.userId],
    );

    if (!result.rows.length) throw new NotFoundError('Campaign not found, or not pending review');
    return result.rows[0];
  });
}

/**
 * Called by lib/jobs/handlers.ts's handleMarketingCampaignSmsSend once
 * smsService.sendBulkCampaign returns. No TenantContext available (the job
 * runs on the admin pool, like every other cron/job callback in this
 * codebase) — withAdminDb is correct here, not a gap.
 */
export async function completeMarketingCampaignSend(
  campaignId: string,
  sent: number,
  failed: number,
): Promise<void> {
  await withAdminDb((db) =>
    db.query(
      `UPDATE marketing_campaigns
       SET status = 'completed', sent_count = $2, failed_count = $3, updated_at = NOW()
       WHERE id = $1`,
      [campaignId, sent, failed],
    ),
  );
}
