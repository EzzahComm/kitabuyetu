import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth, withOneOf } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { createCampaign } from '@/lib/services/campaign.service';
import { enqueueJob } from '@/lib/jobs';
import { ok } from '@/lib/utils/response';
import { logger } from '@/lib/logger';

const CreateCampaignSchema = z.object({
  name:             z.string().min(1),
  subject:          z.string().min(1),
  templateKey:      z.string().optional(),
  htmlBody:         z.string().optional(),
  recipientFilter:  z.unknown().optional(),
  scheduledAt:      z.string().datetime().optional(),
  launch:           z.boolean().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const { rows } = await withAdminDb((db) =>
      db.query(
        `SELECT id, name, subject, status, total_recipients, sent_count, failed_count,
                opened_count, scheduled_at, started_at, completed_at, created_at
         FROM email_campaigns
         WHERE group_id = $1
         ORDER BY created_at DESC`,
        [auth.groupId],
      ),
    );
    return ok(rows);
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withOneOf(req, ['chairperson', 'super_admin'], async (auth) => {
    const body = CreateCampaignSchema.parse(await req.json());

    const id = await createCampaign({
      groupId:         auth.groupId,
      createdBy:       auth.userId,
      name:            body.name,
      subject:         body.subject,
      templateKey:     body.templateKey,
      htmlBody:        body.htmlBody,
      recipientFilter: body.recipientFilter as never,
      scheduledAt:     body.scheduledAt ? new Date(body.scheduledAt) : undefined,
    });

    if (body.launch) {
      await enqueueJob(
        'email_campaign_launch',
        { campaignId: id },
        { priority: 5, max_attempts: 3, dedup_key: `email_campaign_launch:${id}` },
      ).catch((err: Error) => {
        logger.error('[campaigns] launch enqueue failed', err.message);
      });
    }

    return ok({ id }, 201);
  });
}
