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

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL   = (process.env.TEXTSMS_BASE_URL ?? 'https://sms.textsms.co.ke').replace(/\/$/, '');
const API_KEY    = process.env.TEXTSMS_API_KEY!;
const PARTNER_ID = process.env.TEXTSMS_PARTNER_ID!;
const SENDER_ID  = process.env.TEXTSMS_SENDER_ID ?? 'KITABU';

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
  };
  if (input.timeToSend) payload.timeToSend = input.timeToSend;

  const { data } = await axios.post<{
    responses: {
      'respose-code':         number;
      'response-description': string;
      mobile:                 string;
      messageid:              string;
      networkid:              string;
    }[];
  }>(`${BASE_URL}/api/services/sendsms/`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20_000,
  });

  const r    = data.responses?.[0];
  const code = r?.['respose-code'] ?? 1005;

  return {
    responseCode:        code,
    responseDescription: r?.['response-description'] ?? codeDescription(code),
    mobile:              r?.mobile ?? phone,
    messageId:           r?.messageid ?? '',
    networkId:           r?.networkid ?? '',
    success:             code === 200,
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
    responses: {
      'respose-code':         number;
      'response-description': string;
      mobile:                 string;
      messageid:              string;
      networkid:              string;
    }[];
  }>(`${BASE_URL}/api/services/sendbulk/`, { count: smslist.length, smslist }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 60_000,
  });

  const responses: SmsResponse[] = (data.responses ?? []).map((r) => {
    const code = r['respose-code'];
    return {
      responseCode:        code,
      responseDescription: r['response-description'] ?? codeDescription(code),
      mobile:              r.mobile,
      messageId:           r.messageid ?? '',
      networkId:           r.networkid ?? '',
      success:             code === 200,
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
  const { data } = await axios.get<Record<string, unknown>>(
    `${BASE_URL}/api/services/getdlr/`,
    {
      params:  { apikey: API_KEY, partnerID: PARTNER_ID, messageid: messageId },
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
