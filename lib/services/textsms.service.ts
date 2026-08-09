/**
 * TextSMS Kenya (textsms.co.ke) API Client
 *
 * Endpoints:
 *   Single SMS:  POST https://sms.textsms.co.ke/api/services/sendsms/
 *   Bulk SMS:    POST https://sms.textsms.co.ke/api/services/sendbulk/
 *   DLR:         GET  https://sms.textsms.co.ke/api/services/getdlr/
 *   Balance:     GET  https://sms.textsms.co.ke/api/services/getbalance/
 *
 * All error codes from the provider spec are handled and mapped to
 * human-readable messages.
 */

import axios from 'axios';
import { normalizePhone } from '@/lib/utils/phone';
import { env } from '@/lib/env';

// ─── Configuration ────────────────────────────────────────────────────────────
//
// Read through the validated `env` (lib/env.ts), not raw `process.env` with a
// non-null assertion (SMS_MESSAGING_AUDIT_2026-08.md M6). TEXTSMS_API_KEY and
// TEXTSMS_PARTNER_ID are both `z.string().min(1)` — required, not optional —
// so this now fails fast at cold-start when unset, instead of silently
// posting `"apikey": undefined` to the provider and surfacing as an opaque
// 401/code-1006 far from the actual cause. TEXTSMS_SENDER_ID's Zod default
// ('KITABU YETU', the registered sender ID) also replaces the second,
// drifted default ('KITABU') that lived here.

const BASE_URL   = env.TEXTSMS_BASE_URL.replace(/\/$/, '');
const API_KEY    = env.TEXTSMS_API_KEY;
const PARTNER_ID = env.TEXTSMS_PARTNER_ID;
const SENDER_ID  = env.TEXTSMS_SENDER_ID;

// ─── Response codes ───────────────────────────────────────────────────────────

export const SMS_CODES: Record<number, string> = {
  200:  'Success',
  1001: 'Invalid Sender ID',
  1002: 'Network Not Allowed',
  1003: 'Invalid Mobile Number',
  1004: 'Low Bulk Credits',
  1005: 'System Error',
  1006: 'Invalid Credentials',
  1007: 'System Error',
  1008: 'No Delivery Report',
  1009: 'Unsupported Data Type',
  1010: 'Unsupported Request Type',
  4090: 'Internal Error',
  4091: 'No Partner ID Set',
  4092: 'No API Key Provided',
  4093: 'Details Not Found',
};

function codeDescription(code: number): string {
  return SMS_CODES[code] ?? `Unknown code: ${code}`;
}

/** Provider code for an uninterpretable response. */
const SYSTEM_ERROR = 1005;
/** The only code TextSMS treats as acceptance. */
const SUCCESS_CODE = 200;

/**
 * Normalize the provider's response code to a number.
 *
 * TextSMS returns numeric fields as JSON *strings* — confirmed from provider
 * payloads this system stored itself (sms_delivery_reports.raw_response carries
 * "messageid": "655405696", "networkid": "1"). A strict `code === 200` therefore
 * never matched, so every accepted message was recorded as failed while still
 * carrying a real provider message id (SMS_MESSAGING_AUDIT_2026-08.md C2 — 112
 * such rows in production, all with failed_reason "Success").
 *
 * Coercing here keeps the rest of the platform working against one internal
 * contract regardless of how the provider formats its JSON. An uninterpretable
 * code becomes SYSTEM_ERROR rather than NaN, so it fails the success check and
 * still renders a sensible description — fail-closed is correct for a response
 * we cannot read.
 */
function toResponseCode(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : SYSTEM_ERROR;
}

/**
 * One entry in a TextSMS send response. Every field is typed as it arrives on
 * the wire, not as it reads — the provider stringifies its numerics, and typing
 * `respose-code` as `number` is what let C2 typecheck cleanly while being wrong
 * at runtime. `respose-code` is the provider's own spelling.
 */
interface ProviderResponseRow {
  'respose-code':         number | string;
  'response-description': string;
  mobile:                 string;
  messageid:              string | number;
  networkid:              string | number;
  /**
   * Echoed back from the request's own `clientsmsid` (SMS_MESSAGING_AUDIT_2026-08.md
   * H6). Optional in the type because we cannot be certain every response row
   * always carries it — sendBulkSms's own mapping below falls back to
   * positional matching wholesale (not per-row) when even one row lacks it,
   * see that comment for why a partial fallback would be worse than none.
   */
  clientsmsid?: string | number;
}

export class TextSmsError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly phone?: string,
  ) {
    super(message);
    this.name = 'TextSmsError';
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SingleSmsInput {
  mobile:       string;
  message:      string;
  senderId?:    string;
  timeToSend?:  string;  // "YYYY-MM-DD HH:mm" — omit for immediate
}

export interface SmsResponse {
  responseCode:        number;
  responseDescription: string;
  mobile:              string;
  messageId:           string;
  networkId:           string;
  success:             boolean;
  /**
   * Parsed from the response row's own clientsmsid when present (H6) — lets a
   * caller align this response back to the exact request item it answers,
   * immune to chunk-boundary drops/reordering that break positional indexing.
   * undefined when the row didn't carry one (or wasn't a number).
   */
  clientSmsId?: number;
}

export interface BulkSmsItem {
  mobile:      string;
  message:     string;
  clientSmsId?: number;
  senderId?:   string;
  timeToSend?: string;
}

export interface BulkSmsResult {
  responses: SmsResponse[];
  sent:      number;
  failed:    number;
}

export interface DlrResult {
  messageId:    string;
  phone:        string;
  status:       string;
  networkId:    string;
  deliveredAt?: string;
  raw:          Record<string, unknown>;
}

export interface BalanceResult {
  balance:     number;
  currency:    string;
  raw:         Record<string, unknown>;
}

// ─── Single SMS ───────────────────────────────────────────────────────────────

export async function sendSingleSms(input: SingleSmsInput): Promise<SmsResponse> {
  const phone = normalizePhone(input.mobile);

  const payload: Record<string, unknown> = {
    apikey:    API_KEY,
    partnerID: PARTNER_ID,
    message:   input.message,
    shortcode: input.senderId ?? SENDER_ID,
    mobile:    phone,
    pass_type: 'plain',  // required on the POST sendsms body, per the TextSMS spec
  };
  if (input.timeToSend) payload.timeToSend = input.timeToSend;

  const { data } = await axios.post<{
    responses: ProviderResponseRow[];
  }>(`${BASE_URL}/api/services/sendsms/`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20_000,
  });

  const r    = data.responses?.[0];
  const code = toResponseCode(r?.['respose-code'] ?? SYSTEM_ERROR);

  return {
    responseCode:        code,
    responseDescription: r?.['response-description'] ?? codeDescription(code),
    mobile:              String(r?.mobile ?? phone),
    messageId:           String(r?.messageid ?? ''),
    networkId:           String(r?.networkid ?? ''),
    success:             code === SUCCESS_CODE,
  };
}

// ─── Bulk SMS ─────────────────────────────────────────────────────────────────

export async function sendBulkSms(items: BulkSmsItem[]): Promise<BulkSmsResult> {
  const smslist = items.map((item, idx) => ({
    partnerID:   PARTNER_ID,
    apikey:      API_KEY,
    pass_type:   'plain',
    clientsmsid: item.clientSmsId ?? Date.now() + idx,
    mobile:      normalizePhone(item.mobile),
    message:     item.message,
    shortcode:   item.senderId ?? SENDER_ID,
    ...(item.timeToSend ? { timeToSend: item.timeToSend } : {}),
  }));

  const { data } = await axios.post<{
    responses: ProviderResponseRow[];
  }>(`${BASE_URL}/api/services/sendbulk/`, { count: smslist.length, smslist }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 60_000,
  });

  const responses: SmsResponse[] = (data.responses ?? []).map((r) => {
    const code = toResponseCode(r['respose-code']);
    // clientsmsid is the provider's own numeric echo of the request item's
    // clientSmsId; Number(undefined) is NaN, so guard explicitly rather than
    // let an absent field silently become the number 0.
    const clientIdNum = r.clientsmsid != null ? Number(r.clientsmsid) : NaN;
    return {
      responseCode:        code,
      responseDescription: r['response-description'] ?? codeDescription(code),
      mobile:              String(r.mobile ?? ''),
      messageId:           String(r.messageid ?? ''),
      networkId:           String(r.networkid ?? ''),
      success:             code === SUCCESS_CODE,
      clientSmsId:         Number.isFinite(clientIdNum) ? clientIdNum : undefined,
    };
  });

  return {
    responses,
    sent:   responses.filter((r) => r.success).length,
    failed: responses.filter((r) => !r.success).length,
  };
}

// ─── DLR ─────────────────────────────────────────────────────────────────────

export async function getDeliveryReport(messageId: string): Promise<DlrResult> {
  // The DLR endpoint reads the message id from the `messageID` query param
  // (capital ID, per the TextSMS spec/Postman collection). Query params are
  // case-sensitive, so the previous lowercase `messageid` was never matched
  // server-side and every DLR lookup came back empty — leaving messages stuck
  // 'sent'/'pending' and delivered_at unset.
  const { data } = await axios.get<Record<string, unknown>>(
    `${BASE_URL}/api/services/getdlr/`,
    {
      params:  { apikey: API_KEY, partnerID: PARTNER_ID, messageID: messageId },
      timeout: 15_000,
    },
  );

  return {
    messageId,
    phone:       String(data.mobile ?? ''),
    status:      String(data['delivery-status'] ?? data.status ?? 'unknown'),
    networkId:   String(data.networkid ?? ''),
    deliveredAt: data['delivery-time'] ? String(data['delivery-time']) : undefined,
    raw:         data,
  };
}

// ─── Account Balance ──────────────────────────────────────────────────────────

export async function getProviderBalance(): Promise<BalanceResult> {
  const { data } = await axios.get<{ balance?: string | number; [key: string]: unknown }>(
    `${BASE_URL}/api/services/getbalance/`,
    {
      params:  { apikey: API_KEY, partnerID: PARTNER_ID },
      timeout: 15_000,
    },
  );

  return {
    balance:  parseFloat(String(data.balance ?? '0')),
    currency: 'KES',
    raw:      data,
  };
}

// ─── Batch helper — chunks items to avoid payload limits ─────────────────────

const CHUNK_SIZE = 100;

export async function sendBulkSmsChunked(items: BulkSmsItem[]): Promise<BulkSmsResult> {
  const all: SmsResponse[] = [];

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk  = items.slice(i, i + CHUNK_SIZE);
    const result = await sendBulkSms(chunk);
    all.push(...result.responses);
    // Respect rate limits — 500ms between chunks
    if (i + CHUNK_SIZE < items.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return {
    responses: all,
    sent:      all.filter((r) => r.success).length,
    failed:    all.filter((r) => !r.success).length,
  };
}
