/**
 * Regression tests for SMS_MESSAGING_AUDIT_2026-08.md H3 (the bounded half),
 * against real Postgres.
 *
 * resetStuckJobs used to flip a timed-out job back to 'pending' without
 * touching `attempts`. Because `attempts` is incremented only in
 * processSingleJob's catch branch — which a timed-out invocation never reaches,
 * since the function died and nothing threw — such a job was released forever
 * and never approached max_attempts.
 *
 * For sms_bulk_send that loop re-ran debitPayer and re-inserted log rows on
 * every pass, i.e. it re-billed and re-sent the whole campaign without bound.
 * It was masked only while C1 made billing throw first.
 *
 * These assert the sweep now counts the timeout as an attempt and retires a job
 * that exhausts them, rather than releasing it again.
 */
import { resetStuckJobs } from '@/lib/jobs/db';
import { rawQuery } from './helpers/db';

/** Insert a job already stuck in 'processing' past the sweep threshold. */
async function stuckJob(attempts: number, maxAttempts = 5): Promise<string> {
  const [row] = await rawQuery<{ id: string }>(
    `INSERT INTO job_queue (type, payload, status, attempts, max_attempts, updated_at)
     VALUES ('sms_bulk_send', '{}'::jsonb, 'processing', $1, $2, NOW() - INTERVAL '30 minutes')
     RETURNING id`,
    [attempts, maxAttempts],
  );
  return row.id;
}

async function readJob(id: string) {
  const [row] = await rawQuery<{ status: string; attempts: number; last_error: string | null }>(
    `SELECT status, attempts, last_error FROM job_queue WHERE id=$1`, [id],
  );
  return row;
}

describe('stuck-job sweep bounds the retry loop (H3)', () => {
  afterEach(async () => {
    await rawQuery(`DELETE FROM job_queue WHERE type='sms_bulk_send'`);
  });

  it('counts the timeout as an attempt when releasing a job', async () => {
    const id = await stuckJob(0);

    const result = await resetStuckJobs(6);

    expect(result.released).toBe(1);
    expect(result.failed).toBe(0);

    const job = await readJob(id);
    expect(job.status).toBe('pending');
    // Before the fix this stayed at 0 forever, which is what made the loop unbounded.
    expect(job.attempts).toBe(1);
    expect(job.last_error).toMatch(/timed out/i);
  });

  it('fails a job that exhausts max_attempts instead of releasing it again', async () => {
    const id = await stuckJob(4, 5);

    const result = await resetStuckJobs(6);

    expect(result.failed).toBe(1);
    expect(result.released).toBe(0);

    const job = await readJob(id);
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(5);
  });

  it('terminates rather than looping when swept repeatedly', async () => {
    const id = await stuckJob(0, 3);

    // Simulate three consecutive ticks that each find the job still stuck.
    for (let i = 0; i < 3; i++) {
      await rawQuery(
        `UPDATE job_queue SET status='processing', updated_at = NOW() - INTERVAL '30 minutes'
         WHERE id=$1 AND status='pending'`,
        [id],
      );
      await resetStuckJobs(6);
    }

    const job = await readJob(id);
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(3);
  });

  it('leaves jobs inside the threshold alone', async () => {
    const [row] = await rawQuery<{ id: string }>(
      `INSERT INTO job_queue (type, payload, status, attempts, max_attempts, updated_at)
       VALUES ('sms_bulk_send', '{}'::jsonb, 'processing', 0, 5, NOW())
       RETURNING id`,
    );

    const result = await resetStuckJobs(6);

    expect(result.released).toBe(0);
    expect(result.failed).toBe(0);
    const job = await readJob(row.id);
    expect(job.status).toBe('processing');
    expect(job.attempts).toBe(0);
  });
});
