/**
 * POST /api/v1/email/webhooks/sendgrid
 *
 * SendGrid signs its Event Webhook with ECDSA (P-256) over SHA-256 of
 * `${timestamp}${raw-body}`. We verify the signature before processing so
 * an attacker can't fake delivery / open events for messages.
 *
 * Configure the verification key in the SendGrid dashboard:
 *   Settings → Mail Settings → Event Webhooks → Signed Event Webhook
 * Then set SENDGRID_WEBHOOK_VERIFICATION_KEY in env.
 *
 * Auth bypass: this path is in proxy.ts's webhook bypass list.
 *
 * Behaviour when SENDGRID_WEBHOOK_VERIFICATION_KEY is unset:
 *   - production           → reject (fail-closed)
 *   - dev / preview / test → accept with a logged warning
 */
import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { processSendGridEvents, type SendGridWebhookEvent } from '@/lib/services/delivery-tracking.service';
import { verifySendGridSignature } from '@/lib/webhooks/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const raw = await req.text();

  const publicKey = env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  if (!publicKey) {
    if (env.NODE_ENV === 'production') {
      logger.error('[sendgrid.webhook] rejecting callback: SENDGRID_WEBHOOK_VERIFICATION_KEY not set');
      return NextResponse.json({ error: 'Webhook key not configured' }, { status: 503 });
    }
    logger.warn('[sendgrid.webhook] SENDGRID_WEBHOOK_VERIFICATION_KEY not set — accepting unsigned callback (dev only)');
  } else {
    const result = verifySendGridSignature(
      raw,
      {
        signature: req.headers.get('x-twilio-email-event-webhook-signature'),
        timestamp: req.headers.get('x-twilio-email-event-webhook-timestamp'),
      },
      publicKey,
    );
    if (!result.ok) {
      logger.warn('[sendgrid.webhook] signature verification failed', { reason: result.reason });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  let events: SendGridWebhookEvent[];
  try {
    const parsed = JSON.parse(raw);
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    await processSendGridEvents(events);
  } catch (err) {
    logger.error('[sendgrid.webhook] processing failed', err);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
  return NextResponse.json({ received: true, count: events.length });
}
