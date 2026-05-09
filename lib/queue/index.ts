/**
 * Redis-backed job queue using sorted sets.
 *
 * Score = process_at (Unix ms).  Jobs with score ≤ now() are "ready."
 * Designed for serverless — no persistent worker process required.
 * Consumers call dequeue() from a triggered endpoint (cron / webhook).
 *
 * Dead-letter queue (DLQ): up to 500 recent failed jobs kept in a Redis list.
 */

import { redis } from '@/lib/redis';

export const QUEUES = {
  MPESA_RECONCILE:      'mpesa:reconcile',
  MPESA_STATUS_CHECK:   'mpesa:status_check',
  FAILED_PAYMENT_RETRY: 'failed_payment:retry',
  BILL_MGR_SEND:        'bill_mgr:send',
  SMS_SEND:             'sms:send',
  SMS_BULK:             'sms:bulk',
  SMS_RETRY:            'sms:retry',
  SMS_BIRTHDAY:         'sms:birthday',
  SMS_SCHEDULED:        'sms:scheduled',
  EMAIL_SEND:           'email:send',
  EMAIL_HIGH:           'email:high',
  EMAIL_LOW:            'email:low',
  EMAIL_BILLING:        'email:billing',
  EMAIL_SCHEDULED:      'email:scheduled',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface Job<T = Record<string, unknown>> {
  id:         string;
  queue:      string;
  data:       T;
  attempts:   number;
  maxAttempts: number;
  enqueuedAt: number;
  processAt:  number;
}

// Key helpers — ioredis prepends the 'ky:' prefix automatically
const Q   = (q: string) => `queue:${q}`;
const DLQ = (q: string) => `dlq:${q}`;

// ─── Enqueue ─────────────────────────────────────────────────────────────────

export async function enqueue<T extends Record<string, unknown>>(
  queue: string,
  data: T,
  options: { delayMs?: number; maxAttempts?: number } = {},
): Promise<string> {
  const id  = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const job: Job<T> = {
    id,
    queue,
    data,
    attempts:    0,
    maxAttempts: options.maxAttempts ?? 3,
    enqueuedAt:  now,
    processAt:   now + (options.delayMs ?? 0),
  };
  await redis.zadd(Q(queue), job.processAt, JSON.stringify(job));
  return id;
}

// ─── Dequeue ─────────────────────────────────────────────────────────────────

export async function dequeue<T = Record<string, unknown>>(
  queue: string,
  limit = 10,
): Promise<Job<T>[]> {
  const members = await redis.zrangebyscore(Q(queue), '-inf', Date.now(), 'LIMIT', 0, limit);
  if (!members.length) return [];

  const pipeline = redis.pipeline();
  members.forEach((m) => pipeline.zrem(Q(queue), m));
  await pipeline.exec();

  return members.map((m) => JSON.parse(m) as Job<T>);
}

// ─── Re-queue (retry with backoff) ───────────────────────────────────────────

export async function requeueWithBackoff<T extends Record<string, unknown>>(
  job: Job<T>,
): Promise<void> {
  const updated: Job<T> = {
    ...job,
    attempts:  job.attempts + 1,
    processAt: Date.now() + 1_000 * 2 ** job.attempts, // 1s, 2s, 4s, …
  };
  await redis.zadd(Q(job.queue), updated.processAt, JSON.stringify(updated));
}

// ─── Dead-letter queue ────────────────────────────────────────────────────────

export async function moveToDeadLetter(job: Job, error: string): Promise<void> {
  const entry = JSON.stringify({ ...job, error, failedAt: Date.now() });
  await redis.lpush(DLQ(job.queue), entry);
  await redis.ltrim(DLQ(job.queue), 0, 499);
}

// ─── Observability ───────────────────────────────────────────────────────────

export async function queueDepth(queue: string): Promise<number> {
  return redis.zcount(Q(queue), '-inf', '+inf');
}

export async function deadLetterDepth(queue: string): Promise<number> {
  return redis.llen(DLQ(queue));
}

export async function peekDeadLetter(
  queue: string,
  limit = 10,
): Promise<Job[]> {
  const items = await redis.lrange(DLQ(queue), 0, limit - 1);
  return items.map((i) => JSON.parse(i) as Job);
}
