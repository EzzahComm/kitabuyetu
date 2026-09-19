/**
 * Marketing campaign service — audiences + cross-channel campaign
 * orchestration (Phase 9.2 SMS, Phase 9.3 email).
 *
 * Deliberately thin: the SMS leg reuses smsService.sendBulkCampaign
 * unchanged; the email leg reuses email_campaigns/email_campaign_recipients
 * and their existing drainCampaignRecipients job (lib/services/
 * campaign.service.ts, migration 012) unchanged too — this service only owns
 * audience resolution, the approval workflow, and marketing_campaigns' own
 * status machine for SMS (email status is read live from email_campaigns,
 * which already tracks its own send progress correctly).
 */

import { PoolClient } from 'pg';
import { withDb, withAdminDb, type TenantContext } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { resolveSmsRecipients } from '@/lib/services/sms.service';
import { getCampaignRecipients } from '@/lib/services/campaign.service';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';

export type AudienceSource = 'all_members' | 'active_members' | 'crm_contacts_opted_in' | 'org_group_officers';
export type Channel = 'sms' | 'email';

export interface Audience {
  id: string;
  group_id?: string;
  organization_id?: string;
  name: string;
  source: AudienceSource;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export type CampaignStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'sending' | 'completed' | 'cancelled';

export interface Campaign {
  id: string;
  group_id?: string;
  organization_id?: string;
  title: string;
  channel: Channel;
  subject?: string;
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

interface ResolvedRecipient {
  target_type: 'member' | 'crm_contact';
  target_id: string;
  phone?: string;
  email?: string;
  name?: string;
}

/** True for a campaign/audience approver acting on behalf of an organization rather than a single group. */
function isOrgScoped(row: { group_id?: string; organization_id?: string }): boolean {
  return !row.group_id && !!row.organization_id;
}

// ============================================================================
// AUDIENCES
// ============================================================================

export async function createAudience(
  ctx: TenantContext,
  data: { name: string; source: AudienceSource },
): Promise<Audience> {
  if (!data.name.trim()) throw new ValidationError('Audience name is required');
  if (data.source === 'org_group_officers' && !!ctx.groupId) {
    throw new ValidationError('org_group_officers is only valid for an organization-level audience');
  }

  return withDb(ctx, async (db) => {
    const result = await db.query<Audience>(
      `INSERT INTO marketing_audiences (group_id, organization_id, name, source, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [ctx.groupId || null, ctx.groupId ? null : ctx.organizationId, data.name, data.source, ctx.userId],
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
 * Resolve an audience to a recipient list for the given channel, at
 * whatever moment it's called (approval time — the caller freezes the
 * result, this function never does).
 *
 * Consent/suppression are enforced HERE, at resolution, not at send time:
 * a suppressed or non-opted-in address never becomes a `pending`
 * email_campaign_recipients / marketing_audience_members row in the first
 * place, so the existing send machinery (sendBulkCampaign,
 * drainCampaignRecipients) needs no changes to respect either gate.
 */
async function resolveAudience(
  db: PoolClient,
  scope: { groupId?: string; organizationId?: string },
  audience: Audience,
  channel: Channel,
): Promise<ResolvedRecipient[]> {
  let recipients: ResolvedRecipient[];

  if (audience.source === 'all_members' || audience.source === 'active_members') {
    if (!scope.groupId) throw new ValidationError(`${audience.source} requires a group-scoped campaign`);
    if (channel === 'sms') {
      const phones = await resolveSmsRecipients(scope.groupId, audience.source, undefined);
      recipients = phones.map((phone) => ({ target_type: 'member', target_id: scope.groupId!, phone }));
    } else {
      const rows = await getCampaignRecipients(scope.groupId, { activeOnly: audience.source === 'active_members' });
      recipients = rows.map((r) => ({ target_type: 'member', target_id: r.memberId, email: r.email, name: r.name }));
    }
  } else if (audience.source === 'crm_contacts_opted_in') {
    const { rows } = await db.query<{ id: string; phone: string | null; email: string | null; name: string }>(
      `SELECT id, phone, email, name FROM crm_contacts
       WHERE marketing_opt_in = true
         AND (group_id = $1 OR organization_id = $2)
         AND ${channel === 'sms' ? 'phone IS NOT NULL' : 'email IS NOT NULL'}`,
      [scope.groupId || null, scope.organizationId || null],
    );
    recipients = rows.map((r) => ({
      target_type: 'crm_contact', target_id: r.id, name: r.name,
      ...(channel === 'sms' ? { phone: r.phone! } : { email: r.email! }),
    }));
  } else {
    // org_group_officers — chairperson/treasurer/secretary across every
    // group the organization currently has active access to.
    if (!scope.organizationId) throw new ValidationError('org_group_officers requires an organization-scoped campaign');
    const { rows } = await db.query<{ member_id: string; phone: string | null; email: string | null; name: string }>(
      `SELECT DISTINCT m.id AS member_id, m.phone, m.email,
              COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''), m.phone) AS name
       FROM organization_group_access oga
       JOIN group_officers go ON go.group_id = oga.group_id AND go.removed_at IS NULL
       JOIN members m ON m.id = go.member_id
       WHERE oga.organization_id = $1 AND oga.is_active = true
         AND ${channel === 'sms' ? 'm.phone IS NOT NULL' : 'm.email IS NOT NULL'}`,
      [scope.organizationId],
    );
    recipients = rows.map((r) => ({
      target_type: 'member', target_id: r.member_id, name: r.name,
      ...(channel === 'sms' ? { phone: r.phone! } : { email: r.email! }),
    }));
  }

  if (channel !== 'email') return recipients;

  // Email only: drop anything in email_suppressions for this scope.
  const emails = recipients.map((r) => r.email).filter((e): e is string => !!e);
  if (!emails.length) return recipients;

  const { rows: suppressed } = await db.query<{ email: string }>(
    `SELECT email FROM email_suppressions WHERE email = ANY($1) AND (group_id = $2 OR organization_id = $3)`,
    [emails, scope.groupId || null, scope.organizationId || null],
  );
  const suppressedSet = new Set(suppressed.map((s) => s.email));
  return recipients.filter((r) => !r.email || !suppressedSet.has(r.email));
}

// ============================================================================
// CAMPAIGNS
// ============================================================================

export async function createCampaign(
  ctx: TenantContext,
  data: { title: string; message: string; audience_id: string; channel?: Channel; subject?: string },
): Promise<Campaign> {
  const channel = data.channel ?? 'sms';
  if (!data.title.trim()) throw new ValidationError('Campaign title is required');
  if (!data.message.trim()) throw new ValidationError('Campaign message is required');
  if (channel === 'email' && !data.subject?.trim()) throw new ValidationError('Email campaigns need a subject');
  if (channel === 'sms' && !ctx.groupId) throw new ValidationError('SMS campaigns must be group-scoped');

  return withDb(ctx, async (db) => {
    const result = await db.query<Campaign>(
      `INSERT INTO marketing_campaigns (group_id, organization_id, title, channel, subject, message, audience_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        ctx.groupId || null, ctx.groupId ? null : ctx.organizationId,
        data.title, channel, data.subject || null, data.message, data.audience_id, ctx.userId,
      ],
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

/**
 * For an email campaign that has started sending, overlays the LIVE counts
 * from email_campaigns (which drainCampaignRecipients already updates
 * correctly) rather than trying to keep two tables' counters in sync via a
 * separate mechanism. marketing_campaigns.status/sent_count/failed_count
 * remain fully authoritative for SMS, which has no other tracking table.
 */
export async function getCampaignById(ctx: TenantContext, id: string): Promise<Campaign | null> {
  return withDb(ctx, async (db) => {
    const result = await db.query<Campaign>(`SELECT * FROM marketing_campaigns WHERE id = $1`, [id]);
    const campaign = result.rows[0];
    if (!campaign) return null;
    if (campaign.channel !== 'email' || campaign.status === 'draft' || campaign.status === 'pending_review') {
      return campaign;
    }

    const { rows: emailRows } = await db.query<{ status: string; sent_count: number; failed_count: number; total_recipients: number | null }>(
      `SELECT status, sent_count, failed_count, total_recipients FROM email_campaigns WHERE marketing_campaign_id = $1`,
      [id],
    );
    const ec = emailRows[0];
    if (!ec) return campaign;

    return {
      ...campaign,
      sent_count: ec.sent_count,
      failed_count: ec.failed_count,
      status: ec.status === 'sent' ? 'completed' : campaign.status,
    };
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

function assertCanApprove(ctx: TenantContext, campaign: Campaign): void {
  if (isOrgScoped(campaign)) {
    if (ctx.role !== 'organization_coordinator') {
      throw new ForbiddenError('Only an organization coordinator can approve this campaign');
    }
  } else if (ctx.role !== 'chairperson') {
    throw new ForbiddenError('Only the chairperson can approve a marketing campaign');
  }
}

/**
 * Approve + launch, atomically: resolves the audience into a frozen
 * recipient snapshot, marks the campaign sending, and hands off to whichever
 * channel's existing send machinery owns dispatch from here — all in one
 * transaction, so a campaign never sits "approved" with no send in flight.
 *
 * Maker-checker: ctx.userId must not be the campaign's own creator, and must
 * hold the approving role for the campaign's scope (chairperson for a group
 * campaign, organization_coordinator for an org one) — mirrors
 * disbursements.service.ts's approver-!=-initiator pattern. The DB CHECK
 * (migration 193) is the real backstop for creator!=approver; the role
 * check has no DB-level twin since roles aren't stored per-row here.
 */
export async function approveCampaign(ctx: TenantContext, campaignId: string): Promise<Campaign> {
  return withDb(ctx, async (db) => {
    const { rows: campaignRows } = await db.query<Campaign>(
      `SELECT * FROM marketing_campaigns WHERE id = $1 AND status = 'pending_review'`,
      [campaignId],
    );
    const campaign = campaignRows[0];
    if (!campaign) throw new NotFoundError('Campaign not found, or not pending review');

    assertCanApprove(ctx, campaign);

    if (campaign.created_by === ctx.userId) {
      throw new ForbiddenError('The campaign creator cannot approve their own campaign');
    }

    const { rows: audienceRows } = await db.query<Audience>(
      `SELECT * FROM marketing_audiences WHERE id = $1`,
      [campaign.audience_id],
    );
    const audience = audienceRows[0];
    if (!audience) throw new NotFoundError('Audience not found');

    const scope = { groupId: campaign.group_id, organizationId: campaign.organization_id };
    const recipients = await resolveAudience(db, scope, audience, campaign.channel);
    if (!recipients.length) {
      throw new ValidationError('This audience currently resolves to zero recipients — nothing to send');
    }

    if (campaign.channel === 'sms') {
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
    }

    // Email: hand off to the existing email_campaigns/email_campaign_recipients
    // machinery (lib/services/campaign.service.ts, migration 012) — its
    // drainCampaignRecipients job (already scheduled) picks up any 'pending'
    // row for a 'sending' campaign, so no new job type is needed here.
    const { rows: ecRows } = await db.query<{ id: string }>(
      `INSERT INTO email_campaigns
         (group_id, organization_id, name, subject, html_body, status, started_at,
          total_recipients, audience_id, marketing_campaign_id, created_by)
       VALUES ($1, $2, $3, $4, $5, 'sending', NOW(), $6, $7, $8, $9)
       RETURNING id`,
      [
        campaign.group_id || null, campaign.organization_id || null,
        campaign.title, campaign.subject, campaign.message,
        recipients.length, audience.id, campaignId, ctx.userId,
      ],
    );
    const emailCampaignId = ecRows[0].id;

    for (const r of recipients) {
      await db.query(
        `INSERT INTO email_campaign_recipients (campaign_id, group_id, organization_id, member_id, email, name)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [
          emailCampaignId, campaign.group_id || null, campaign.organization_id || null,
          r.target_type === 'member' ? r.target_id : null, r.email, r.name || r.email,
        ],
      );
      await db.query(
        `INSERT INTO marketing_audience_members (campaign_id, audience_id, target_type, target_id, phone)
         VALUES ($1, $2, $3, $4, $5)`,
        [campaignId, audience.id, r.target_type, r.target_id, r.email],
      );
    }

    const { rows: updated } = await db.query<Campaign>(
      `UPDATE marketing_campaigns
       SET status = 'sending', recipient_count = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [campaignId, recipients.length, ctx.userId],
    );

    return updated[0];
  });
}

export async function rejectCampaign(ctx: TenantContext, campaignId: string, reason: string): Promise<Campaign> {
  if (!reason.trim()) throw new ValidationError('A rejection reason is required');

  return withDb(ctx, async (db) => {
    const { rows: campaignRows } = await db.query<Campaign>(
      `SELECT * FROM marketing_campaigns WHERE id = $1 AND status = 'pending_review'`,
      [campaignId],
    );
    const campaign = campaignRows[0];
    if (!campaign) throw new NotFoundError('Campaign not found, or not pending review');

    assertCanApprove(ctx, campaign);

    const result = await db.query<Campaign>(
      `UPDATE marketing_campaigns
       SET status = 'rejected', rejection_reason = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [campaignId, reason, ctx.userId],
    );

    return result.rows[0];
  });
}

/**
 * Called by lib/jobs/handlers.ts's handleMarketingCampaignSmsSend once
 * smsService.sendBulkCampaign returns. No TenantContext available (the job
 * runs on the admin pool, like every other cron/job callback in this
 * codebase) — withAdminDb is correct here, not a gap. Email campaigns have
 * no equivalent call: email_campaigns tracks its own completion already
 * (processCampaignJob in campaign.service.ts), read live by getCampaignById.
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
