import { withAdminDb } from '@/lib/db';
import { enqueue, QUEUES } from '@/lib/queue';
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

  // Insert recipient rows
  for (const r of recipients) {
    await withAdminDb((db) =>
      db.query(
        `INSERT INTO email_campaign_recipients (campaign_id, group_id, member_id, email, name)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [campaignId, campaign.group_id, r.memberId, r.email, r.name],
      ),
    ).catch(() => {});

    await enqueue(
      QUEUES.EMAIL_LOW,
      {
        type: 'campaign',
        campaignId,
        recipientEmail: r.email,
        recipientName: r.name,
        memberId: r.memberId,
        groupId: campaign.group_id,
        subject: campaign.subject,
        templateKey: campaign.template_key,
        htmlBody: campaign.html_body,
      },
      { delayMs: 0, maxAttempts: 3 },
    );
  }
}

// Process a single campaign job (called by queue worker)
export async function processCampaignJob(job: {
  campaignId: string;
  recipientEmail: string;
  recipientName: string;
  memberId: string;
  groupId: string;
  subject: string;
  templateKey?: string;
  htmlBody?: string;
}): Promise<void> {
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
}
