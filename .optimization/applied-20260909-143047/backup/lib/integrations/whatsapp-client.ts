/**
 * Thin fetch wrapper around the Meta WhatsApp Cloud API.
 *
 * Spec: https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * Falls back to `dry_run` mode if the env vars aren't configured. This keeps
 * local dev painless and gives ops a way to disable outbound sends without
 * breaking the API surface.
 *
 * Part 1 supports only text messages. Template messages, media, interactive
 * buttons, and inbound webhook handling are E10.2.
 */

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

export interface SendTextOptions {
  to:   string;   // E.164, e.g. "+254712345678"
  body: string;   // Plain text (4096 char max per Meta spec)
}

export type SendTextResult =
  | { status: 'sent';     waMessageId: string }
  | { status: 'failed';   errorCode: string; errorMessage: string }
  | { status: 'dry_run'; reason: string };

interface MetaSendResponse {
  messaging_product?: string;
  contacts?:          { input: string; wa_id: string }[];
  messages?:          { id: string; message_status?: string }[];
}

interface MetaErrorResponse {
  error?: {
    message?:        string;
    type?:           string;
    code?:           number;
    error_subcode?:  number;
    fbtrace_id?:     string;
  };
}

const MAX_TEXT_LENGTH = 4096;

export function isWhatsAppConfigured(): boolean {
  return Boolean(env.WHATSAPP_PHONE_ID) && Boolean(env.WHATSAPP_ACCESS_TOKEN);
}

export async function sendText(opts: SendTextOptions): Promise<SendTextResult> {
  if (!opts.body || opts.body.trim().length === 0) {
    return { status: 'failed', errorCode: 'EMPTY_BODY', errorMessage: 'Message body is empty' };
  }
  if (opts.body.length > MAX_TEXT_LENGTH) {
    return { status: 'failed', errorCode: 'BODY_TOO_LONG', errorMessage: `Message exceeds ${MAX_TEXT_LENGTH} char limit` };
  }
  if (!isWhatsAppConfigured()) {
    // Dry-run keeps the audit log honest and the UI working in dev/staging.
    return { status: 'dry_run', reason: 'WhatsApp credentials not configured (set WHATSAPP_PHONE_ID + WHATSAPP_ACCESS_TOKEN)' };
  }

  const url = `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${env.WHATSAPP_PHONE_ID}/messages`;
  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                opts.to,
    type:              'text',
    text:              { body: opts.body },
  });

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type':  'application/json',
      },
      body,
    });

    // Parse once — Meta returns JSON for both success and error responses.
    const json = (await res.json()) as MetaSendResponse & MetaErrorResponse;

    if (!res.ok || json.error) {
      const err = json.error ?? { message: 'Unknown error', code: res.status };
      logger.warn('[whatsapp] send failed', { status: res.status, error: err });
      return {
        status:       'failed',
        errorCode:    String(err.code ?? res.status),
        errorMessage: err.message ?? `HTTP ${res.status}`,
      };
    }

    const wamid = json.messages?.[0]?.id;
    if (!wamid) {
      return {
        status:       'failed',
        errorCode:    'NO_MESSAGE_ID',
        errorMessage: 'Meta accepted the request but returned no message id',
      };
    }
    return { status: 'sent', waMessageId: wamid };
  } catch (err) {
    logger.error('[whatsapp] network error', err);
    return {
      status:       'failed',
      errorCode:    'NETWORK',
      errorMessage: (err as Error).message,
    };
  }
}
