/**
 * Drains the Redis-backed email queue (lib/queue) — the destination for
 * every `queueEmail`/`queueAnnouncement` call (notification-email,
 * billing-email, member-email services).
 *
 * OPTIMIZATION_CLEANUP_AUDIT.md Medium #30 — this queue previously had no
 * confirmed consumer: only POST /api/v1/workers/email drained it, and
 * nothing in the repo or the Vercel/Supabase cron config ever called that
 * route, so queued emails silently piled up and were never sent. This
 * function is now invoked every 5 minutes by the `email_queue_drain` job
 * (lib/jobs), which IS wired into the confirmed-running Supabase pg_cron
 * tick (POST /api/cron). The API route keeps calling this too, for the
 * manual/emergency-trigger use its own docstring describes.
 */
import { dequeue, requeueWithBackoff, moveToDeadLetter, QUEUES, type Job } from '@/lib/queue';
import { sendTemplatedEmail } from './email.service';
import { processCampaignJob } from './campaign.service';

export interface EmailQueueDrainResult {
  processed: number;
  failed:    number;
}

export async function drainEmailQueues(): Promise<EmailQueueDrainResult> {
  const queues = [QUEUES.EMAIL_HIGH, QUEUES.EMAIL_SEND, QUEUES.EMAIL_BILLING, QUEUES.EMAIL_LOW, QUEUES.EMAIL_SCHEDULED];
  let processed = 0;
  let failed    = 0;

  for (const queue of queues) {
    const jobs = await dequeue(queue, 5);

    for (const job of jobs as Job<Record<string, unknown>>[]) {
      try {
        if (job.data.type === 'campaign') {
          await processCampaignJob(job.data as never);
        } else if (job.data.type === 'templated') {
          await sendTemplatedEmail({
            templateKey: String(job.data.templateKey ?? ''),
            to:          String(job.data.to ?? ''),
            vars:        (job.data.vars ?? {}) as Record<string, string>,
            groupId:     job.data.groupId ? String(job.data.groupId) : null,
            userId:      job.data.userId  ? String(job.data.userId)  : undefined,
            referenceId:   job.data.referenceId   ? String(job.data.referenceId)   : undefined,
            referenceType: job.data.referenceType ? String(job.data.referenceType) : undefined,
          });
        }
        processed++;
      } catch (err) {
        failed++;
        if (job.attempts < job.maxAttempts - 1) {
          await requeueWithBackoff(job);
        } else {
          await moveToDeadLetter(job, err instanceof Error ? err.message : String(err));
        }
      }
    }
  }

  return { processed, failed };
}
