import { NextRequest, NextResponse } from 'next/server';
import { dequeue, requeueWithBackoff, moveToDeadLetter, QUEUES } from '@/lib/queue';
import { sendTemplatedEmail } from '@/lib/services/email.service';
import { processCampaignJob } from '@/lib/services/campaign.service';
import type { Job } from '@/lib/queue';

// Called by cron (e.g. every 1 minute). Processes up to 20 jobs per invocation.
export async function POST(req: NextRequest) {
  const workerSecret = process.env.WORKER_SECRET;
  if (workerSecret) {
    const authHeader = req.headers.get('authorization') ?? '';
    if (authHeader !== `Bearer ${workerSecret}`) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

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

  return NextResponse.json({ success: true, processed, failed });
}
