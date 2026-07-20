/**
 * Meta WhatsApp Cloud API webhook receiver.
 *
 * GET  — Meta subscribe handshake. Echoes back `hub.challenge` when the
 *        verify token matches WHATSAPP_VERIFY_TOKEN. Called once at setup
 *        and periodically by Meta to confirm the endpoint is reachable.
 *
 * POST — Status + inbound-message callbacks. Body is HMAC-SHA256-signed
 *        against WHATSAPP_APP_SECRET; signature lands in `x-hub-signature-256`
 *        as `sha256=<hex>`. We verify the signature against the *raw* request
 *        bytes (NOT the JSON-parsed object) before doing anything else, so
 *        forged callbacks are dropped before any DB writes.
 *
 * Payload shape (abridged):
 *   { entry: [{ changes: [{ value: { statuses?: [...], messages?: [...] } }] }] }
 *
 * Status callbacks update sent_at/delivered_at/read_at/failed_at on the
 * matching whatsapp_messages row (keyed by wa_message_id). Inbound message
 * callbacks insert a new direction='inbound' row, linked to a member if
 * the phone matches.
 *
 * Returns 200 on any well-formed callback even when individual entries
 * can't be matched — Meta retries non-200 responses aggressively and we
 * don't want a stale wa_message_id triggering an infinite retry loop.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { normalizePhone } from '@/lib/utils/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── GET: Meta subscribe handshake ──────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url   = new URL(req.url);
  const mode  = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const chal  = url.searchParams.get('hub.challenge');

  const expected = env.WHATSAPP_VERIFY_TOKEN;
  if (!expected) {
    logger.warn('[whatsapp.webhook] GET verify hit but WHATSAPP_VERIFY_TOKEN is not configured');
    return new NextResponse('Not configured', { status: 503 });
  }

  if (mode === 'subscribe' && token && chal && timingSafeStrEqual(token, expected)) {
    // Meta expects the raw challenge string, no JSON envelope.
    return new NextResponse(chal, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

// ── POST: status + inbound-message callbacks ───────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read the body as raw bytes so HMAC signs the same string Meta signed.
  const raw = await req.text();

  if (env.WHATSAPP_APP_SECRET) {
    const sigHeader = req.headers.get('x-hub-signature-256') ?? '';
    if (!verifySignature(raw, sigHeader, env.WHATSAPP_APP_SECRET)) {
      logger.warn('[whatsapp.webhook] signature verification failed');
      return new NextResponse('Invalid signature', { status: 401 });
    }
  } else if (env.NODE_ENV === 'production') {
    // OPTIMIZATION_CLEANUP_AUDIT.md High #7 — this used to only warn and
    // accept the unsigned callback in every environment, including
    // production. Fail closed in prod, matching the Resend/SendGrid
    // webhooks right next to this one; still soft-warn in dev/staging so
    // local testing works without a secret configured.
    logger.error('[whatsapp.webhook] rejecting callback: WHATSAPP_APP_SECRET not set');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
  } else {
    logger.warn('[whatsapp.webhook] WHATSAPP_APP_SECRET not set — accepting unsigned callback (dev only)');
  }

  let payload: WaWebhookPayload;
  try {
    payload = JSON.parse(raw) as WaWebhookPayload;
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 });
  }

  const counts = { statuses: 0, messages: 0, errors: 0 };

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const status of value.statuses ?? []) {
        try {
          await applyStatusUpdate(status);
          counts.statuses += 1;
        } catch (err) {
          counts.errors += 1;
          logger.error('[whatsapp.webhook] status update failed', { wamid: status.id, err });
        }
      }

      for (const message of value.messages ?? []) {
        try {
          await recordInboundMessage(message, value.metadata?.phone_number_id);
          counts.messages += 1;
        } catch (err) {
          counts.errors += 1;
          logger.error('[whatsapp.webhook] inbound message failed', { wamid: message.id, err });
        }
      }
    }
  }

  return NextResponse.json({ received: true, ...counts });
}

// ── Helpers ────────────────────────────────────────────────────────────

function timingSafeStrEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function verifySignature(rawBody: string, header: string, secret: string): boolean {
  // Header format per Meta: "sha256=<hex digest>"
  if (!header.startsWith('sha256=')) return false;
  const provided = header.slice('sha256='.length);
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

async function applyStatusUpdate(s: WaStatus): Promise<void> {
  // Meta sends one of: sent | delivered | read | failed
  // (sometimes also "deleted" — we ignore that case).
  const wamid = s.id;
  if (!wamid) return;

  // Map Meta status → our enum + timestamp column to set.
  let setSql: string;
  let newStatus: 'sent' | 'delivered' | 'read' | 'failed';
  switch (s.status) {
    case 'sent':
      setSql    = `status = 'sent', sent_at = COALESCE(sent_at, to_timestamp($2))`;
      newStatus = 'sent';
      break;
    case 'delivered':
      setSql    = `status = CASE WHEN status IN ('read') THEN status ELSE 'delivered' END,
                   delivered_at = COALESCE(delivered_at, to_timestamp($2))`;
      newStatus = 'delivered';
      break;
    case 'read':
      // 'read' is terminal-good; never downgrade.
      setSql    = `status = 'read',
                   read_at = COALESCE(read_at, to_timestamp($2)),
                   delivered_at = COALESCE(delivered_at, to_timestamp($2))`;
      newStatus = 'read';
      break;
    case 'failed':
      setSql    = `status = 'failed',
                   failed_at = COALESCE(failed_at, to_timestamp($2)),
                   error_code = COALESCE($3, error_code),
                   error_message = COALESCE($4, error_message)`;
      newStatus = 'failed';
      break;
    default:
      return; // unknown status — ignore
  }

  const ts = s.timestamp ? parseInt(s.timestamp, 10) : Math.floor(Date.now() / 1000);

  if (newStatus === 'failed') {
    const err = s.errors?.[0];
    await pool.query(
      `UPDATE whatsapp_messages SET ${setSql}
        WHERE wa_message_id = $1`,
      [wamid, ts, err?.code ? String(err.code) : null, err?.title ?? err?.message ?? null],
    );
  } else {
    await pool.query(
      `UPDATE whatsapp_messages SET ${setSql}
        WHERE wa_message_id = $1`,
      [wamid, ts],
    );
  }
}

async function recordInboundMessage(m: WaInboundMessage, fromPhoneId?: string): Promise<void> {
  // Inbound messages don't carry our group context, so resolve via the
  // sender's phone matching a member row. If no match, skip silently —
  // we don't store unsolicited messages from unknown numbers.
  if (!m.from) return;
  const fromPhone = normalizePhone(m.from);

  const { rows } = await pool.query<{ group_id: string; member_id: string }>(
    `SELECT gm.group_id, m.id AS member_id
       FROM members m
       JOIN group_members gm ON gm.member_id = m.id
      WHERE m.phone = $1
      LIMIT 1`,
    [fromPhone],
  );
  if (!rows[0]) return;

  const ts = m.timestamp ? parseInt(m.timestamp, 10) : Math.floor(Date.now() / 1000);
  const body = m.text?.body ?? null;

  await pool.query(
    `INSERT INTO whatsapp_messages (
       group_id, member_id, direction, to_phone, from_phone,
       message_type, body, status, wa_message_id, sent_at
     ) VALUES (
       $1, $2, 'inbound', '', $3,
       'text', $4, 'delivered', $5, to_timestamp($6)
     )
     ON CONFLICT DO NOTHING`,
    [rows[0].group_id, rows[0].member_id, fromPhone, body, m.id, ts],
  );
}

// ── Payload types (subset of Meta's schema) ────────────────────────────

interface WaWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        statuses?:  WaStatus[];
        messages?:  WaInboundMessage[];
      };
    }>;
  }>;
}

interface WaStatus {
  id?:           string;
  status?:       'sent' | 'delivered' | 'read' | 'failed' | string;
  timestamp?:    string;
  recipient_id?: string;
  errors?: Array<{ code?: number | string; title?: string; message?: string }>;
}

interface WaInboundMessage {
  from?:      string;
  id?:        string;
  timestamp?: string;
  type?:      string;
  text?:      { body?: string };
}
