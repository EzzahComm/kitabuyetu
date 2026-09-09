/**
 * POST /api/v1/email/webhooks/resend
 *
 * Resend signs webhooks with svix (HMAC-SHA256 + replay window). We verify
 * the signature over the *raw* request body before doing anything else, so
 * forged callbacks can't poison `email_logs` status (e.g. faking
 * 'email.delivered' to mask a bounce).
 *
 * Auth bypass: this path is in proxy.ts's webhook bypass list, so no JWT
 * is required — the signature IS the authentication.
 *
 * Behaviour when RESEND_WEBHOOK_SECRET is unset:
 *   - production           → reject (fail-closed; misconfig is a hard stop)
 *   - dev / preview / test → accept with a logged warning (local convenience)
 */
import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { processResendEvent, type ResendWebhookEvent } from '@/lib/services/delivery-tracking.service';
import { verifySvixSignature } from '@/lib/webhooks/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read raw bytes — HMAC is over the exact string Resend signed, not the
  // JSON-parsed object.
  const raw = await req.text();

  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    if (env.NODE_ENV === 'production') {
      logger.error('[resend.webhook] rejecting callback: RESEND_WEBHOOK_SECRET not set');
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
    }
    logger.warn('[resend.webhook] RESEND_WEBHOOK_SECRET not set — accepting unsigned callback (dev only)');
  } else {
    const result = verifySvixSignature(
      raw,
      {
        svixId:        req.headers.get('svix-id'),
        svixTimestamp: req.headers.get('svix-timestamp'),
        svixSignature: req.headers.get('svix-signature'),
      },
      secret,
    );
    if (!result.ok) {
      logger.warn('[resend.webhook] signature verification failed', { reason: result.reason });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  let event: ResendWebhookEvent;
  try {
    event = JSON.parse(raw) as ResendWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    await processResendEvent(event);
  } catch (err) {
    logger.error('[resend.webhook] processing failed', err);
    // 500 lets svix retry — events are idempotent (UPDATE ... WHERE id = $1).
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
