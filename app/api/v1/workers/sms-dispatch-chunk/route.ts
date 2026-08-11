/**
 * POST /api/v1/workers/sms-dispatch-chunk — QStash-triggered.
 *
 * Receives ONE chunk of a bulk/campaign SMS send published by
 * lib/queue/qstash.ts's publishSmsChunk() (called from lib/jobs/handlers.ts's
 * handleSmsBulkSend when a campaign is large enough to chunk — closes
 * SMS_MESSAGING_AUDIT_2026-08.md H3, docs/messaging/
 * UNIFIED_MESSAGING_ARCHITECTURE.md Phase 3 item 10). Dispatches that chunk
 * through the exact same smsService.sendBulkCampaign() every other SMS path
 * uses — this route is purely a QStash-shaped entry point, not a second
 * SMS pipeline.
 *
 * Auth: cryptographic — Upstash signs every request with a key tied to this
 * project's QStash instance (Receiver.verify(), same signature scheme as
 * the WhatsApp webhook's X-Hub-Signature-256 in app/api/v1/webhooks/
 * whatsapp/route.ts). No separate bearer secret needed; only QStash holding
 * our signing keys could have produced a valid signature.
 *
 * A non-2xx response makes QStash retry the chunk (up to the `retries: 3`
 * set at publish time) — sendBulkCampaign's own dispatchBatchId dedup
 * (keyed per-chunk, not per-campaign) makes a retried chunk safe to re-run.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Receiver } from '@upstash/qstash';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import type { SmsDispatchChunkPayload } from '@/lib/queue/qstash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isValidPayload(v: unknown): v is SmsDispatchChunkPayload {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.jobId === 'string' &&
    typeof p.chunkIndex === 'number' &&
    typeof p.groupId === 'string' &&
    typeof p.sentBy === 'string' &&
    typeof p.message === 'string' &&
    Array.isArray(p.phones) && p.phones.every((x) => typeof x === 'string') &&
    typeof p.totalRecipientCount === 'number'
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Signature verification needs the RAW body — must be read before any
  // JSON parsing (a re-serialized body would not byte-match what QStash
  // signed).
  const rawBody = await req.text();
  const signature = req.headers.get('upstash-signature') ?? '';

  if (!env.QSTASH_CURRENT_SIGNING_KEY || !env.QSTASH_NEXT_SIGNING_KEY) {
    // Route reachable but QStash not provisioned in this environment —
    // fail closed rather than silently accepting an unverifiable request.
    logger.error('[sms-dispatch-chunk] QStash signing keys not configured');
    return NextResponse.json({ success: false, error: 'Not configured' }, { status: 503 });
  }

  try {
    const receiver = new Receiver({
      currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey:    env.QSTASH_NEXT_SIGNING_KEY,
    });
    const ok = await receiver.verify({ signature, body: rawBody, url: req.url });
    if (!ok) {
      return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
    }
  } catch (err) {
    logger.warn('[sms-dispatch-chunk] Signature verification failed', { err: String(err) });
    return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: 'Malformed JSON body' }, { status: 400 });
  }

  if (!isValidPayload(payload)) {
    return NextResponse.json({ success: false, error: 'Invalid chunk payload' }, { status: 400 });
  }

  try {
    const { smsService } = await import('@/lib/services/sms.service');

    const varsByPhone = payload.varsByPhone
      ? new Map(Object.entries(payload.varsByPhone))
      : undefined;
    const payer = payload.fundedBy === 'organization' && payload.payerOrganizationId
      ? { type: 'organization' as const, organizationId: payload.payerOrganizationId }
      : undefined;

    const result = await smsService.sendBulkCampaign({
      campaignId:    payload.campaignId,
      phones:        payload.phones,
      message:       payload.message,
      varsByPhone,
      senderId:      payload.senderId,
      timeToSend:    payload.timeToSend,
      groupId:       payload.groupId,
      sentBy:        payload.sentBy,
      referenceType: payload.referenceType,
      referenceId:   payload.referenceId,
      payer,
      totalRecipientCount: payload.totalRecipientCount,
      // Stable per-CHUNK key, distinct from the parent job's own id, so a
      // QStash retry of this chunk dedupes against itself only — not
      // against sibling chunks, which each carry their own key.
      dispatchBatchId: `${payload.jobId}:chunk:${payload.chunkIndex}`,
    });

    return NextResponse.json({
      success: true,
      jobId:      payload.jobId,
      chunkIndex: payload.chunkIndex,
      chunkCount: payload.chunkCount,
      sent:       result.sent,
      failed:     result.failed,
    });
  } catch (err) {
    logger.error('[sms-dispatch-chunk] Dispatch error:', err);
    // 500 so QStash retries — mirrors /api/cron's fail-safe: the error is
    // logged in full server-side, never echoed to the caller.
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
