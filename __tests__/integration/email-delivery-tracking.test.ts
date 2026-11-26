import { randomUUID } from 'node:crypto';
import { processResendEvent } from '@/lib/services/delivery-tracking.service';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import { createTestGroup } from './helpers/fixtures';

it('counts campaign opens once and preserves recipient suppressions through repeated and late Resend events', async () => {
  await resetDatabase();
  const { groupId } = await createTestGroup('treasurer');
  const messageId = randomUUID();
  const email = 'recipient@example.invalid';
  const [campaign] = await rawQuery<{ id: string }>(
    `INSERT INTO email_campaigns (group_id, name, subject) VALUES ($1,'Test campaign','Welcome') RETURNING id`,
    [groupId],
  );
  await rawQuery(
    `INSERT INTO email_logs (group_id, "to", provider, provider_message_id, reference_type, reference_id)
     VALUES ($1,$2,'resend',$3,'campaign',$4), ($1,$2,'smtp',$3,'campaign',$4)`,
    [groupId, email, messageId, campaign.id],
  );

  const sendEvent = (type: string) => processResendEvent({ type, data: { email_id: messageId } });
  await sendEvent('email.bounced');
  await sendEvent('email.bounced');
  await sendEvent('email.sent');
  await sendEvent('email.delivery_delayed');

  const [beforeOpen] = await rawQuery(`SELECT opened_count FROM email_campaigns WHERE id=$1`, [campaign.id]);
  expect(beforeOpen.opened_count).toBe(0);
  await Promise.all([sendEvent('email.opened'), sendEvent('email.opened')]);

  const [afterOpen] = await rawQuery(`SELECT opened_count FROM email_campaigns WHERE id=$1`, [campaign.id]);
  expect(afterOpen.opened_count).toBe(1);
  expect(
    await rawQuery(
      `SELECT provider, status, opened_at IS NOT NULL AS opened
       FROM email_logs WHERE provider_message_id=$1 ORDER BY provider`,
      [messageId],
    ),
  ).toEqual([
    { provider: 'resend', status: 'bounced', opened: true },
    { provider: 'smtp', status: 'queued', opened: false },
  ]);
  expect(await rawQuery(`SELECT email, source FROM email_suppressions WHERE group_id=$1`, [groupId])).toEqual([
    { email, source: 'bounce' },
  ]);
});
