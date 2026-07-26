import { withAdminDb } from '@/lib/db';
import { renderTemplate } from '@/lib/email/templates/engine';
import { DEFAULT_TEMPLATES } from '@/lib/email/templates/defaults';
import { sendEmailWithFallback } from '@/lib/email/provider';

export interface CampaignCreateInput {
  groupId: string;
  createdBy: string;
  name: string;
  subject: string;
  templateKey?: string;
  htmlBody?: string;
  textBody?: string;
  recipientFilter?: {
    roles?: string[];
    activeOnly?: boolean;
    specificMemberIds?: string[];
  };
  scheduledAt?: Date;
}

export async function createCampaign(input: CampaignCreateInput): Promise<string> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `INSERT INTO email_campaigns
         (group_id, created_by, name, subject, template_key, html_body, text_body,
          recipient_filter, status, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
               CASE WHEN $9::timestamptz IS NOT NULL THEN 'scheduled' ELSE 'draft' END,
               $9)
       RETURNING id`,
      [
        input.groupId,
        input.createdBy,
        input.name,
        input.subject,
        input.templateKey ?? null,
        input.htmlBody ?? null,
        input.textBody ?? null,
        input.recipientFilter ? JSON.stringify(input.recipientFilter) : null,
        input.scheduledAt?.toISOString() ?? null,
      ],
    ),
  );
  return rows[0].id as string;
}

export async function getCampaignRecipients(
  groupId: string,
  filter?: CampaignCreateInput['recipientFilter'],
): Promise<{ memberId: string; email: string; name: string }[]> {
  const parts: string[] = [
    `SELECT m.id AS member_id, m.email, COALESCE(m.full_name, m.email) AS name
     FROM members m
     JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $1
     WHERE m.email IS NOT NULL`,
  ];
  const params: unknown[] = [groupId];

  if (filter?.activeOnly) {
    parts.push(`AND gm.status = 'active'`);
  }

  if (filter?.roles?.length) {
    params.push(filter.roles);
    parts.push(`AND gm.role = ANY($${params.length}::text[])`);
  }

  if (filter?.specificMemberIds?.length) {
    params.push(filter.specificMemberIds);
    parts.push(`AND m.id = ANY($${params.length}::uuid[])`);
  }

  const { rows } = await withAdminDb((db) => db.query(parts.join(' '), params));
  return rows.map((r) => ({ memberId: r.member_id, email: r.email, name: r.name }));
}

// Enqueue all recipients and update campaign status
export async function launchCampaign(campaignId: string): Promise<void> {
  const { rows } = await withAdminDb((db) =>
    db.query(`SELECT * FROM email_campaigns WHERE id = $1`, [campaignId]),
  );
  if (!rows.length) throw new Error('Campaign not found');
  const campaign = rows[0];
  if (!['draft', 'scheduled'].includes(campaign.status)) {
    throw new Error(`Campaign already ${campaign.status}`);
  }

  const recipients = await getCampaignRecipients(
    campaign.group_id,
    campaign.recipient_filter,
  );

  await withAdminDb((db) =>
    db.query(
      `UPDATE email_campaigns SET status='sending', started_at=NOW(), total_recipients=$1 WHERE id=$2`,
      [recipients.length, campaignId],
    ),
  );

  // Insert recipient rows — drained by the email_campaign_drain job on a
  // schedule (lib/jobs), not enqueued individually here.
  for (const r of recipients) {
    await withAdminDb((db) =>
      db.query(
        `INSERT INTO email_campaign_recipients (campaign_id, group_id, member_id, email, name)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [campaignId, campaign.group_id, r.memberId, r.email, r.name],
      ),
    ).catch(() => {});
  }
}

// Process a single campaign job (called by the drain)
export async function processCampaignJob(job: {
  campaignId: string;
  recipientEmail: string;
  recipientName: string;
  memberId: string;
  groupId: string;
  subject: string;
  templateKey?: string;
  htmlBody?: string;
}): Promise<{ success: boolean }> {
  let html = job.htmlBody ?? '';

  if (job.templateKey) {
    const fallback = DEFAULT_TEMPLATES[job.templateKey]?.body;
    const rendered = await renderTemplate(
      job.templateKey,
      { memberName: job.recipientName, groupId: job.groupId },
      job.groupId,
      'en',
      fallback,
    ).catch(() => null);
    if (rendered) html = rendered.html;
  }

  const result = await sendEmailWithFallback({
    to: job.recipientEmail,
    subject: job.subject,
    html,
    groupId: job.groupId,
    category: 'campaign',
    referenceId: job.campaignId,
    referenceType: 'campaign',
  });

  const status = result.success ? 'sent' : 'failed';

  await withAdminDb((db) =>
    db.query(
      `UPDATE email_campaign_recipients
       SET status=$1, sent_at=CASE WHEN $1='sent' THEN NOW() ELSE NULL END,
           error_message=CASE WHEN $1='failed' THEN $2 ELSE NULL END
       WHERE campaign_id=$3 AND email=$4`,
      [status, result.error ?? null, job.campaignId, job.recipientEmail],
    ),
  ).catch(() => {});

  const col = result.success ? 'sent_count' : 'failed_count';
  await withAdminDb((db) =>
    db.query(`UPDATE email_campaigns SET ${col}=${col}+1 WHERE id=$1`, [job.campaignId]),
  ).catch(() => {});

  // Mark completed when all recipients processed
  await withAdminDb((db) =>
    db.query(
      `UPDATE email_campaigns
       SET status='sent', completed_at=NOW()
       WHERE id=$1
         AND (sent_count + failed_count) >= COALESCE(total_recipients, 0)
         AND status = 'sending'`,
      [job.campaignId],
    ),
  ).catch(() => {});

  return { success: result.success };
}

export interface CampaignDrainResult {
  processed: number;
  sent:      number;
  failed:    number;
}

/**
 * Claims a bounded batch of 'pending' email_campaign_recipients rows (for
 * campaigns currently 'sending') and sends each — the replacement for the
 * old Redis-based per-recipient fan-out (OPTIMIZATION_CLEANUP_AUDIT.md's
 * lib/queue + lib/jobs merge). One row per recipient stays durable in
 * Postgres (as it always has, via launchCampaign's insert); this just
 * changes what drains that table on a schedule, from a Redis dequeue loop
 * to a direct DB claim using the same FOR UPDATE SKIP LOCKED idiom
 * lib/jobs/db.ts already uses for its own job_queue table.
 *
 * Batch size is kept modest (default 40) to stay well under the Vercel
 * function time budget when every recipient in the batch is an outbound
 * provider call — tune via the `email_campaign_drain` job's caller if
 * job_logs shows this handler running close to the limit.
 */
export async function drainCampaignRecipients(limit = 40): Promise<CampaignDrainResult> {
  const { rows } = await withAdminDb((db) =>
    db.query<{
      campaign_id:  string;
      group_id:     string;
      member_id:    string | null;
      email:        string;
      name:         string | null;
      subject:      string;
      template_key: string | null;
      html_body:    string | null;
    }>(
      `UPDATE email_campaign_recipients ecr
       SET status = 'sending'
       FROM (
         SELECT ecr2.id
         FROM email_campaign_recipients ecr2
         JOIN email_campaigns ec2 ON ec2.id = ecr2.campaign_id
         WHERE ecr2.status = 'pending' AND ec2.status = 'sending'
         ORDER BY ecr2.created_at ASC
         LIMIT $1
         FOR UPDATE OF ecr2 SKIP LOCKED
       ) claimed,
       email_campaigns ec
       WHERE ecr.id = claimed.id AND ec.id = ecr.campaign_id
       RETURNING ecr.campaign_id, ecr.group_id, ecr.member_id, ecr.email, ecr.name,
                 ec.subject, ec.template_key, ec.html_body`,
      [limit],
    ),
  );

  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    const { success } = await processCampaignJob({
      campaignId:     r.campaign_id,
      recipientEmail: r.email,
      recipientName:  r.name ?? r.email,
      memberId:       r.member_id ?? '',
      groupId:        r.group_id,
      subject:        r.subject,
      templateKey:    r.template_key ?? undefined,
      htmlBody:       r.html_body ?? undefined,
    });
    if (success) sent++; else failed++;
  }

  return { processed: rows.length, sent, failed };
}
