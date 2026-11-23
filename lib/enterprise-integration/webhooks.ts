import { createHash, createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { withAdminDb } from '@/lib/db';
import { insertJob } from '@/lib/jobs/db';
import { logger } from '@/lib/logger';
import { getEnterpriseIntegrations } from './config';

const subscriptionEvent = z.object({
  id: z.string().uuid(),
  type: z.literal('subscription.updated'),
  organizationId: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  version: z.literal(1),
});
const deliveryPayload = z.object({
  endpointId: z.string().uuid(),
  destinationHash: z.string().regex(/^[a-f0-9]{64}$/),
  event: subscriptionEvent,
});

function hashDestination(url: string) {
  return createHash('sha256').update(url).digest('hex');
}

export async function enqueueEnterpriseSubscriptionEvent(
  db: PoolClient,
  organizationId: string,
  subscriptionId: string,
  startedAt: string | Date,
): Promise<void> {
  let webhooks;
  try {
    webhooks = getEnterpriseIntegrations().webhooks;
  } catch {
    logger.error('Could not load Enterprise webhook configuration');
    return;
  }

  for (const hook of webhooks.filter((item) => item.organizationId === organizationId)) {
    const event = {
      id: subscriptionId,
      type: 'subscription.updated',
      organizationId,
      subscriptionId,
      occurredAt: new Date(startedAt).toISOString(),
      version: 1,
    };
    await insertJob(
      'enterprise_webhook_delivery',
      { endpointId: hook.endpointId, destinationHash: hashDestination(hook.url), event },
      { dedup_key: `enterprise-webhook:${hook.endpointId}:${event.id}`, max_attempts: 6 },
      db,
    );
  }
}

export async function deliverEnterpriseWebhook(payload: unknown) {
  const { endpointId, destinationHash, event } = deliveryPayload.parse(payload);
  const hook = getEnterpriseIntegrations().webhooks.find(
    (item) =>
      item.endpointId === endpointId &&
      item.organizationId === event.organizationId &&
      hashDestination(item.url) === destinationHash,
  );
  if (!hook) return { message: 'Enterprise webhook endpoint disabled or replaced' };

  const active = await withAdminDb(async (db) => {
    const { rows } = await db.query('SELECT 1 FROM organizations WHERE id = $1 AND is_active', [event.organizationId]);
    return rows.length > 0;
  });
  if (!active) return { message: 'Enterprise webhook organization disabled' };

  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(hook.secret, 'hex'))
    .update(`${event.id}.${timestamp}.${body}`)
    .digest('base64');

  const response = await fetch(hook.url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: {
      'Content-Type': 'application/json',
      'Webhook-Id': event.id,
      'Webhook-Timestamp': timestamp,
      'Webhook-Signature': `v1,${signature}`,
    },
    body,
  });
  await response.body?.cancel().catch(() => {});
  if (!response.ok) throw new Error(`Enterprise webhook delivery failed with HTTP ${response.status}`);
  return { message: 'Enterprise webhook delivered' };
}
