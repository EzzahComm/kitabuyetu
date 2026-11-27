import { retryDelivery } from '@/lib/notifications/activity-query';
import { retireLegacyAdminSms } from '@/lib/notifications/notification-queue';
import { rawQuery } from './helpers/db';

it('retires previously attempted and non-billing admin SMS while preserving email and first-time billing SMS', async () => {
  const [{ billing, registration }] = await rawQuery<{ billing: string; registration: string }>(`
    WITH activity AS (
      INSERT INTO platform_activity_logs (event_type, severity, title)
      VALUES ('SUBSCRIPTION_CREATED', 'INFO', 'Test subscription'), ('USER_REGISTERED', 'INFO', 'Test user')
      RETURNING id, event_type
    )
    SELECT (SELECT id FROM activity WHERE event_type = 'SUBSCRIPTION_CREATED') AS billing,
           (SELECT id FROM activity WHERE event_type = 'USER_REGISTERED') AS registration
  `);
  const deliveries = await rawQuery<{ id: string }>(
    `
    INSERT INTO notification_deliveries (activity_id, channel, recipient, status, attempt_count, idempotency_key)
    VALUES ($1, 'sms', '254182625807', 'RETRYING', 1, gen_random_uuid()::text),
           ($2, 'sms', '254182625807', 'PENDING', 0, gen_random_uuid()::text),
           ($1, 'sms', '254182625807', 'PENDING', 0, gen_random_uuid()::text),
           ($2, 'email', 'admin@example.com', 'RETRYING', 1, gen_random_uuid()::text)
    RETURNING id
  `,
    [billing, registration],
  );
  const ids = deliveries.map(({ id }) => id);

  await rawQuery(
    `
    INSERT INTO job_queue (type, dedup_key)
    SELECT 'admin_alert_deliver', 'admin_alert:' || id FROM unnest($1::text[]) AS x(id)
  `,
    [ids],
  );
  try {
    await retireLegacyAdminSms();
    await expect(retryDelivery(ids[0])).resolves.toBe(false);
    const result = await rawQuery<{ status: string; job_status: string }>(
      `
      SELECT d.status, j.status AS job_status
      FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id, position)
      JOIN notification_deliveries d ON d.id = x.id
      JOIN job_queue j ON j.dedup_key = 'admin_alert:' || x.id
      ORDER BY x.position
    `,
      [ids],
    );
    expect(result).toEqual([
      { status: 'FAILED', job_status: 'completed' },
      { status: 'CANCELLED', job_status: 'completed' },
      { status: 'PENDING', job_status: 'pending' },
      { status: 'RETRYING', job_status: 'pending' },
    ]);
  } finally {
    await rawQuery('DELETE FROM job_queue WHERE dedup_key = ANY($1::text[])', [ids.map((id) => `admin_alert:${id}`)]);
    await rawQuery('DELETE FROM notification_deliveries WHERE id = ANY($1::uuid[])', [ids]);
  }
});
