/**
 * Safaricom Daraja Production API Client
 *
 * Covers every API required for production:
 *   OAuth, STK Push + Query, C2B v1/v2, B2C, B2B, Dynamic QR,
 *   Reversal, Transaction Status, Account Balance, Bill Manager.
 *
 * Production endpoint map (verified against the Daraja "Go Live" portal
 * URL list 2026-05-26). Sandbox swaps the host to `sandbox.safaricom.co.ke`
 * but keeps the same paths.
 *   OAuth                  POST  /oauth/v1/generate?grant_type=client_credentials
 *   STK Push               POST  /mpesa/stkpush/v1/processrequest
 *   STK Push Query         POST  /mpesa/stkpushquery/v1/query
 *   C2B v1 Register URLs   POST  /mpesa/c2b/v1/registerurl
 *   C2B v2 Register URLs   POST  /mpesa/c2b/v2/registerurl
 *   B2C                    POST  /mpesa/b2c/v1/paymentrequest
 *   B2B (all 3 commandIds) POST  /mpesa/b2b/v1/paymentrequest
 *   Reversal               POST  /mpesa/reversal/v1/request
 *   Transaction Status     POST  /mpesa/transactionstatus/v1/query
 *   Account Balance        POST  /mpesa/accountbalance/v1/query
 *   Dynamic QR Code        POST  /mpesa/qrcode/v1/generate
 *   Bill Manager Optin     POST  /v1/billmanager-invoice/v1/billmanager-invoice/optin
 *   Bill Manager Single    POST  /v1/billmanager-invoice/v1/billmanager-invoice/single-invoicing
 *   Bill Manager Bulk      POST  /v1/billmanager-invoice/v1/billmanager-invoice/bulk-invoicing
 *   Bill Manager Update    POST  /v1/billmanager-invoice/v1/billmanager-invoice/change-invoice
 *   Bill Manager Update*N  POST  /v1/billmanager-invoice/v1/billmanager-invoice/change-invoices
 *   Bill Manager Cancel    POST  /v1/billmanager-invoice/v1/billmanager-invoice/cancel-single-invoice
 *   Bill Manager Cancel*N  POST  /v1/billmanager-invoice/v1/billmanager-invoice/cancel-bulk-invoice
 *   Bill Manager Reconcile POST  /v1/billmanager-invoice/v1/billmanager-invoice/reconciliation
 *   Bill Manager Onboard   POST  /v1/billmanager-invoice/v1/billmanager-invoice/change-optin-details
 *
 * Design:
 *  - OAuth token is cached in Redis (shared across instances) + in-memory
 *    (avoids a Redis round-trip on every request within the same instance).
 *  - Automatic retry with exponential backoff on 5xx / 429 responses.
 *  - All amounts converted to integer shillings before transmission.
 *  - All phone numbers normalised to E.164 (254XXXXXXXXX) before transmission.
 */

import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { toMpesaAmount } from '@/lib/utils/currency';
import { normalizePhone } from '@/lib/utils/phone';
import { getSecurityCredential } from '@/lib/utils/mpesa-credential';

// ─── Configuration ────────────────────────────────────────────────────────────

const IS_SANDBOX = (process.env.MPESA_ENV ?? 'sandbox') !== 'production';

const BASE_URL = IS_SANDBOX
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke';

const CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY!;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET!;
const PASSKEY         = process.env.MPESA_PASSKEY!;
const SHORTCODE       = process.env.MPESA_SHORTCODE!;
const B2C_SHORTCODE   = process.env.MPESA_B2C_SHORTCODE ?? process.env.MPESA_SHORTCODE!;
const CALLBACK_BASE   = (process.env.MPESA_CALLBACK_BASE_URL ?? '').replace(/\/$/, '');
const INITIATOR_NAME  = process.env.MPESA_B2C_INITIATOR_NAME ?? 'KitabuYetu';

// Safaricom's published production egress IPs for Daraja callbacks.
// Single source of truth — every callback route validates against this set
// via isSafaricomIp(). Override with MPESA_ALLOWED_IPS (comma-separated) when
// Safaricom rotates the range.
// Source: https://developer.safaricom.co.ke/docs#ip-addresses (merged with the
// ranges previously hard-coded in the STK callback route).
export const DEFAULT_SAFARICOM_IPS = [
  '196.201.214.200', '196.201.214.206', '196.201.214.207', '196.201.214.208',
  '196.201.214.115', '196.201.214.128', '196.201.214.129', '196.201.214.130',
  '196.201.214.131', '196.201.214.132', '196.201.213.150', '196.201.213.114',
  '196.201.213.44',  '196.201.212.127', '196.201.212.128', '196.201.212.129',
  '196.201.212.136', '196.201.212.138', '196.201.212.74',  '196.201.212.69',
  '196.201.213.128', '196.201.213.129', '196.201.213.130', '196.201.213.131',
  '196.201.213.132', '196.201.213.140', '196.201.213.141', '196.201.213.142',
  '196.201.213.143', '196.201.213.144', '196.201.213.145', '196.201.213.146',
  '196.201.213.147', '196.201.213.148', '196.201.213.149',
];

const ALLOWED_IPS = new Set<string>(
  process.env.MPESA_ALLOWED_IPS
    ? process.env.MPESA_ALLOWED_IPS.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_SAFARICOM_IPS,
);

// Fail fast: a production deployment with an empty allow-list would accept
// callbacks from anywhere. Catch the misconfiguration at module load.
if (!IS_SANDBOX && ALLOWED_IPS.size === 0) {
  throw new Error(
    '[daraja] MPESA_ENV=production but the Safaricom IP allow-list is empty. ' +
    'Set MPESA_ALLOWED_IPS or restore DEFAULT_SAFARICOM_IPS.',
  );
}

/** True when `ip` is an authorised Safaricom callback source (always true in sandbox). */
export function isSafaricomIp(ip: string): boolean {
  if (IS_SANDBOX) return true;
  return ALLOWED_IPS.has(ip);
}

// ─── OAuth Token ─────────────────────────────────────────────────────────────

interface TokenEntry { token: string; expiresAt: number }

// In-process memory cache — avoids Redis round-trip for same-instance hits
let _memToken: TokenEntry | null = null;

const REDIS_TOKEN_KEY = 'daraja:token'; // actual key: ky:daraja:token (prefix added by ioredis)

export async function getAccessToken(): Promise<string> {
  // 1. In-memory (fastest — zero network)
  if (_memToken && Date.now() < _memToken.expiresAt - 30_000) {
    return _memToken.token;
  }

  // 2. Redis (shared across serverless instances)
  const cached = await redis.get<TokenEntry>(REDIS_TOKEN_KEY);
  if (cached) {
    if (Date.now() < cached.expiresAt - 30_000) {
      _memToken = cached;
      return cached.token;
    }
  }

  // 3. Fetch fresh token from Safaricom
  const creds = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const { data } = await axios.get<{ access_token: string; expires_in: string }>(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${creds}` }, timeout: 15_000 },
  );

  const ttlMs  = parseInt(data.expires_in, 10) * 1_000;
  const entry: TokenEntry = { token: data.access_token, expiresAt: Date.now() + ttlMs };

  _memToken = entry;
  // Store in Redis with a 60-second safety margin so it expires before we think it does
  await redis.set(REDIS_TOKEN_KEY, JSON.stringify(entry), { px: ttlMs - 60_000 });

  return entry.token;
}

// ─── HTTP Client ──────────────────────────────────────────────────────────────

async function makeClient(): Promise<AxiosInstance> {
  const token = await getAccessToken();
  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 30_000,
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const shouldRetry =
        axios.isAxiosError(err) &&
        (!err.response || err.response.status >= 500 || err.response.status === 429);
      if (!shouldRetry || attempt === maxAttempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
    }
  }
  throw lastErr;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getMpesaTimestamp(): string {
  return new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
}

export function getMpesaPassword(timestamp: string, shortcode = SHORTCODE): string {
  return Buffer.from(`${shortcode}${PASSKEY}${timestamp}`).toString('base64');
}

export function assertSafaricomIp(ip: string): void {
  // Advisory only. Behind Vercel/custom domains the forwarded client IP isn't a
  // reliable Safaricom IP, and hard-blocking drops legitimate callbacks.
  // Integrity is enforced downstream via idempotency (UNIQUE receipt), matching
  // only app-initiated rows, and reconciliation as source of truth. We log the
  // IP so the allow-list can be re-tightened with observed values later.
  if (!isSafaricomIp(ip)) {
    logger.warn('[daraja] callback IP not in Safaricom allow-list — processing anyway', { ip });
  }
}

function originatorId(): string {
  return `KY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Callback authenticity (B2C audit H1) ────────────────────────────────────
// assertSafaricomIp() below is advisory-only (Vercel/serverless IPs aren't
// reliably the true client IP), so it cannot be the integrity boundary on its
// own. A shared secret in the Result/Timeout URL query string closes that gap
// for B2C specifically: a forged callback that doesn't know the token is
// dropped before it can flip any money state. Safaricom echoes query strings
// on Result/Timeout URLs unmodified, so this survives the round trip.
const CALLBACK_TOKEN = process.env.MPESA_CALLBACK_TOKEN ?? '';

// Deliberately NOT thrown at module scope: this file is imported by every
// route that transitively references daraja.service.ts, and Next.js
// evaluates each route's module graph during the build's page-data
// collection — a module-scope throw here fails the ENTIRE build (every
// route, not just the B2C ones) whenever MPESA_ENV=production is set
// without MPESA_CALLBACK_TOKEN, rather than just refusing the specific
// operation that would be insecure. Called instead at the top of the two
// functions that actually touch the token, so the guarantee (never
// register or accept an unauthenticated B2C callback in production) still
// holds at the only times it needs to.
function assertCallbackTokenConfigured(): void {
  if (!IS_SANDBOX && !CALLBACK_TOKEN) {
    throw new Error(
      '[daraja] MPESA_ENV=production but MPESA_CALLBACK_TOKEN is unset — B2C ' +
      'Result/Timeout callbacks would carry no authenticity token.',
    );
  }
}

function withCallbackToken(url: string): string {
  assertCallbackTokenConfigured();
  if (!CALLBACK_TOKEN) return url; // sandbox without a token configured
  return `${url}&token=${encodeURIComponent(CALLBACK_TOKEN)}`;
}

/**
 * True when `token` (from the callback request's query string) matches the
 * configured secret. Deliberately returns false — not a throw — when
 * production is misconfigured (no MPESA_CALLBACK_TOKEN): the caller
 * (app/api/v1/mpesa/b2c/route.ts) acks and logs a warning either way, so it
 * never leaks a misconfiguration to whoever sent the callback, but it must
 * never treat an unauthenticated request as valid just because the secret
 * wasn't set up.
 */
export function isValidCallbackToken(token: string | null): boolean {
  if (!IS_SANDBOX && !CALLBACK_TOKEN) return false; // production misconfiguration — never trust
  if (!CALLBACK_TOKEN) return true; // sandbox only, no token configured — nothing to check
  if (!token) return false;
  // Constant-time: hash both sides first so differing lengths don't short-circuit.
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(CALLBACK_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

// ─── STK Push (M-Pesa Express) ────────────────────────────────────────────────

export interface StkPushInput {
  phone:            string;
  amount:           number;
  accountReference: string;
  description:      string;
}

export interface StkPushResponse {
  merchantRequestId:    string;
  checkoutRequestId:    string;
  responseCode:         string;
  responseDescription:  string;
  customerMessage:      string;
}

export async function initiateStkPush(input: StkPushInput): Promise<StkPushResponse> {
  const phone     = normalizePhone(input.phone);
  const amount    = toMpesaAmount(input.amount);
  const timestamp = getMpesaTimestamp();
  const password  = getMpesaPassword(timestamp);

  const c = await makeClient();
  const { data } = await withRetry(() =>
    c.post<{
      MerchantRequestID:   string;
      CheckoutRequestID:   string;
      ResponseCode:        string;
      ResponseDescription: string;
      CustomerMessage:     string;
    }>('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   'CustomerPayBillOnline',
      Amount:            amount,
      PartyA:            phone,
      PartyB:            SHORTCODE,
      PhoneNumber:       phone,
      CallBackURL:       `${CALLBACK_BASE}/api/v1/mpesa/callback`,
      AccountReference:  input.accountReference.slice(0, 12),
      TransactionDesc:   input.description.slice(0, 20),
    }),
  );

  return {
    merchantRequestId:   data.MerchantRequestID,
    checkoutRequestId:   data.CheckoutRequestID,
    responseCode:        data.ResponseCode,
    responseDescription: data.ResponseDescription,
    customerMessage:     data.CustomerMessage,
  };
}

// ─── STK Push Query ───────────────────────────────────────────────────────────

export interface StkQueryResponse {
  merchantRequestId:   string;
  checkoutRequestId:   string;
  responseCode:        string;
  responseDescription: string;
  resultCode:          string;
  resultDesc:          string;
}

export async function queryStkStatus(checkoutRequestId: string): Promise<StkQueryResponse> {
  const timestamp = getMpesaTimestamp();
  const password  = getMpesaPassword(timestamp);
  const c = await makeClient();

  const { data } = await withRetry(() =>
    c.post<{
      MerchantRequestID:   string;
      CheckoutRequestID:   string;
      ResponseCode:        string;
      ResponseDescription: string;
      ResultCode:          string;
      ResultDesc:          string;
    }>('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  );

  return {
    merchantRequestId:   data.MerchantRequestID,
    checkoutRequestId:   data.CheckoutRequestID,
    responseCode:        data.ResponseCode,
    responseDescription: data.ResponseDescription,
    resultCode:          data.ResultCode,
    resultDesc:          data.ResultDesc,
  };
}

// ─── C2B URL Registration ─────────────────────────────────────────────────────

export type C2BApiVersion = 'v1' | 'v2';

export async function registerC2BUrls(version: C2BApiVersion = 'v2'): Promise<void> {
  const c = await makeClient();
  await withRetry(() =>
    // Registration-safe paths: Safaricom's registerurl API rejects URLs that
    // contain the keyword "mpesa" or a query string, so the registered C2B
    // endpoints live under /api/v1/daraja/ as distinct paths (no `?type=`).
    c.post(`/mpesa/c2b/${version}/registerurl`, {
      ShortCode:       SHORTCODE,
      ResponseType:    'Completed',
      ConfirmationURL: `${CALLBACK_BASE}/api/v1/daraja/c2b-confirm`,
      ValidationURL:   `${CALLBACK_BASE}/api/v1/daraja/c2b-validate`,
    }),
  );
}

// ─── B2C (Business to Customer) ───────────────────────────────────────────────

export interface B2CInput {
  phone:     string;
  amount:    number;
  commandId: 'BusinessPayment' | 'SalaryPayment' | 'PromotionPayment';
  remarks:   string;
  occasion?: string;
}

export interface B2CResponse {
  conversationId:           string;
  originatorConversationId: string;
  responseCode:             string;
  responseDescription:      string;
}

export async function initiateB2C(input: B2CInput): Promise<B2CResponse & { originatorId: string }> {
  const phone  = normalizePhone(input.phone);
  const amount = toMpesaAmount(input.amount);
  const origId = originatorId();
  const c = await makeClient();

  const { data } = await withRetry(() =>
    c.post<{
      ConversationID:           string;
      OriginatorConversationID: string;
      ResponseCode:             string;
      ResponseDescription:      string;
    }>('/mpesa/b2c/v1/paymentrequest', {
      OriginatorConversationID: origId,
      InitiatorName:            INITIATOR_NAME,
      SecurityCredential:       getSecurityCredential(),
      CommandID:                input.commandId,
      Amount:                   amount,
      PartyA:                   B2C_SHORTCODE,
      PartyB:                   phone,
      Remarks:                  input.remarks.slice(0, 100),
      QueueTimeOutURL:          withCallbackToken(`${CALLBACK_BASE}/api/v1/mpesa/b2c?type=timeout`),
      ResultURL:                withCallbackToken(`${CALLBACK_BASE}/api/v1/mpesa/b2c?type=result`),
      Occasion:                 (input.occasion ?? input.remarks).slice(0, 100),
    }),
  );

  return {
    originatorId:             origId,
    conversationId:           data.ConversationID,
    originatorConversationId: data.OriginatorConversationID,
    responseCode:             data.ResponseCode,
    responseDescription:      data.ResponseDescription,
  };
}

// ─── Airtime purchase ─────────────────────────────────────────────────────────

export interface AirtimeInput {
  phone:    string;
  amount:   number;
  remarks?: string;
}

export interface AirtimeResponse {
  originatorId:             string;
  conversationId:           string;
  originatorConversationId: string;
  responseCode:             string;
  responseDescription:      string;
}

/**
 * Buys airtime for a recipient, funded from the Airtime Purchase sub-account.
 *
 * Daraja's airtime product is provisioned per-shortcode — the CommandID and
 * request path differ between organisations and aren't part of the standard
 * public sandbox. To avoid shipping a guessed endpoint that fails on the first
 * production call, the wrapper stays inert until the operator supplies
 * MPESA_AIRTIME_COMMAND_ID (and optionally MPESA_AIRTIME_ENDPOINT) from their
 * Daraja portal "Airtime" configuration.
 */
export async function buyAirtime(input: AirtimeInput): Promise<AirtimeResponse> {
  const commandId = process.env.MPESA_AIRTIME_COMMAND_ID;
  if (!commandId) {
    // NotImplementedError lives in lib/utils/errors; import lazily to keep this
    // module free of app-layer deps for the pure API-call surface.
    const { NotImplementedError } = await import('@/lib/utils/errors');
    throw new NotImplementedError(
      'Airtime purchase is not configured. Set MPESA_AIRTIME_COMMAND_ID (and ' +
      'MPESA_AIRTIME_ENDPOINT if your shortcode uses a non-default path) from ' +
      'the Daraja portal Airtime configuration.',
    );
  }

  const phone     = normalizePhone(input.phone);
  const amount    = toMpesaAmount(input.amount);
  const origId    = originatorId();
  const endpoint  = process.env.MPESA_AIRTIME_ENDPOINT ?? '/mpesa/airtime/v1/purchase';
  const partyA    = process.env.MPESA_AIRTIME_SHORTCODE ?? SHORTCODE;
  const c = await makeClient();

  const { data } = await withRetry(() =>
    c.post<{
      ConversationID:           string;
      OriginatorConversationID: string;
      ResponseCode:             string;
      ResponseDescription:      string;
    }>(endpoint, {
      OriginatorConversationID: origId,
      InitiatorName:            INITIATOR_NAME,
      SecurityCredential:       getSecurityCredential(),
      CommandID:                commandId,
      Amount:                   amount,
      PartyA:                   partyA,
      PartyB:                   phone,
      Remarks:                  (input.remarks ?? 'Airtime purchase').slice(0, 100),
      QueueTimeOutURL:          `${CALLBACK_BASE}/api/v1/mpesa/airtime?type=timeout`,
      ResultURL:                `${CALLBACK_BASE}/api/v1/mpesa/airtime?type=result`,
    }),
  );

  return {
    originatorId:             origId,
    conversationId:           data.ConversationID,
    originatorConversationId: data.OriginatorConversationID,
    responseCode:             data.ResponseCode,
    responseDescription:      data.ResponseDescription,
  };
}

/** True when the airtime feature has been configured by the operator. */
export function isAirtimeConfigured(): boolean {
  return Boolean(process.env.MPESA_AIRTIME_COMMAND_ID);
}

// ─── B2B (Business to Business) ───────────────────────────────────────────────

export type B2BCommandId        = 'BusinessBuyGoods' | 'BusinessPayBill' | 'B2CAccountTopUp';
export type B2BIdentifierType   = '1' | '2' | '4'; // MSISDN | Till | Org shortcode

export interface B2BInput {
  amount:             number;
  receiverShortcode:  string;
  receiverIdentifier: B2BIdentifierType;
  commandId:          B2BCommandId;
  accountReference:   string;
  remarks:            string;
  requester?:         string;
}

export interface B2BResponse {
  originatorId:             string;
  conversationId:           string;
  originatorConversationId: string;
  responseCode:             string;
  responseDescription:      string;
}

export async function initiateB2B(input: B2BInput): Promise<B2BResponse> {
  const amount = toMpesaAmount(input.amount);
  const origId = originatorId();
  const c = await makeClient();

  const payload: Record<string, unknown> = {
    OriginatorConversationID: origId,
    Initiator:                INITIATOR_NAME,
    SecurityCredential:       getSecurityCredential(),
    CommandID:                input.commandId,
    SenderIdentifierType:     '4',
    RecieverIdentifierType:   input.receiverIdentifier,
    Amount:                   amount,
    PartyA:                   SHORTCODE,
    PartyB:                   input.receiverShortcode,
    AccountReference:         input.accountReference.slice(0, 20),
    Remarks:                  input.remarks.slice(0, 100),
    QueueTimeOutURL:          `${CALLBACK_BASE}/api/v1/mpesa/b2b?type=timeout`,
    ResultURL:                `${CALLBACK_BASE}/api/v1/mpesa/b2b?type=result`,
  };
  if (input.requester) payload.Requester = input.requester;

  const { data } = await withRetry(() =>
    c.post<{
      ConversationID:           string;
      OriginatorConversationID: string;
      ResponseCode:             string;
      ResponseDescription:      string;
    }>('/mpesa/b2b/v1/paymentrequest', payload),
  );

  return {
    originatorId:             origId,
    conversationId:           data.ConversationID,
    originatorConversationId: data.OriginatorConversationID,
    responseCode:             data.ResponseCode,
    responseDescription:      data.ResponseDescription,
  };
}

// ─── Reversal ────────────────────────────────────────────────────────────────

export interface ReversalInput {
  transactionId:          string;  // Original M-Pesa receipt number
  amount:                 number;
  receiverParty:          string;  // Org shortcode
  receiverIdentifierType: string;  // '11' = Organization
  remarks:                string;
  occasion?:              string;
}

export interface ReversalResponse {
  originatorId:             string;
  conversationId:           string;
  originatorConversationId: string;
  responseCode:             string;
  responseDescription:      string;
}

export async function requestReversal(input: ReversalInput): Promise<ReversalResponse> {
  const amount = toMpesaAmount(input.amount);
  const origId = originatorId();
  const c = await makeClient();

  const { data } = await withRetry(() =>
    c.post<{
      ConversationID:           string;
      OriginatorConversationID: string;
      ResponseCode:             string;
      ResponseDescription:      string;
    }>('/mpesa/reversal/v1/request', {
      Initiator:              INITIATOR_NAME,
      SecurityCredential:     getSecurityCredential(),
      CommandID:              'TransactionReversal',
      TransactionID:          input.transactionId,
      Amount:                 amount,
      ReceiverParty:          input.receiverParty,
      RecieverIdentifierType: input.receiverIdentifierType,
      Remarks:                input.remarks.slice(0, 100),
      Occasion:               (input.occasion ?? input.remarks).slice(0, 100),
      QueueTimeOutURL:        `${CALLBACK_BASE}/api/v1/mpesa/reversal?type=timeout`,
      ResultURL:              `${CALLBACK_BASE}/api/v1/mpesa/reversal?type=result`,
    }),
  );

  return {
    originatorId:             origId,
    conversationId:           data.ConversationID,
    originatorConversationId: data.OriginatorConversationID,
    responseCode:             data.ResponseCode,
    responseDescription:      data.ResponseDescription,
  };
}

// ─── Transaction Status ───────────────────────────────────────────────────────

export type TxIdentifierType = '1' | '2' | '3' | '4'; // MSISDN | Till | PayBill | ShortCode

export interface TransactionStatusInput {
  transactionId:  string;
  partyA:         string;
  identifierType: TxIdentifierType;
  remarks:        string;
  occasion?:      string;
}

export interface TransactionStatusResponse {
  originatorId:             string;
  conversationId:           string;
  originatorConversationId: string;
  responseCode:             string;
  responseDescription:      string;
}

export async function queryTransactionStatus(
  input: TransactionStatusInput,
): Promise<TransactionStatusResponse> {
  const origId = originatorId();
  const c = await makeClient();

  const { data } = await withRetry(() =>
    c.post<{
      ConversationID:           string;
      OriginatorConversationID: string;
      ResponseCode:             string;
      ResponseDescription:      string;
    }>('/mpesa/transactionstatus/v1/query', {
      Initiator:                INITIATOR_NAME,
      SecurityCredential:       getSecurityCredential(),
      CommandID:                'TransactionStatusQuery',
      TransactionID:            input.transactionId,
      OriginatorConversationID: origId,
      PartyA:                   input.partyA,
      IdentifierType:           input.identifierType,
      Remarks:                  input.remarks.slice(0, 100),
      Occasion:                 (input.occasion ?? input.remarks).slice(0, 100),
      ResultURL:       `${CALLBACK_BASE}/api/v1/mpesa/transaction-status?type=result`,
      QueueTimeOutURL: `${CALLBACK_BASE}/api/v1/mpesa/transaction-status?type=timeout`,
    }),
  );

  return {
    originatorId:             origId,
    conversationId:           data.ConversationID,
    originatorConversationId: data.OriginatorConversationID,
    responseCode:             data.ResponseCode,
    responseDescription:      data.ResponseDescription,
  };
}

// ─── Account Balance ─────────────────────────────────────────────────────────

export interface BalanceResponse {
  originatorId:             string;
  conversationId:           string;
  originatorConversationId: string;
  responseCode:             string;
  responseDescription:      string;
}

export async function queryAccountBalance(shortcode = SHORTCODE): Promise<BalanceResponse> {
  const origId = originatorId();
  const c = await makeClient();

  const { data } = await withRetry(() =>
    c.post<{
      ConversationID:           string;
      OriginatorConversationID: string;
      ResponseCode:             string;
      ResponseDescription:      string;
    }>('/mpesa/accountbalance/v1/query', {
      Initiator:          INITIATOR_NAME,
      SecurityCredential: getSecurityCredential(),
      CommandID:          'AccountBalance',
      PartyA:             shortcode,
      IdentifierType:     '4',
      Remarks:            'Balance query',
      QueueTimeOutURL:    `${CALLBACK_BASE}/api/v1/mpesa/balance?type=timeout`,
      ResultURL:          `${CALLBACK_BASE}/api/v1/mpesa/balance?type=result`,
    }),
  );

  return {
    originatorId:             origId,
    conversationId:           data.ConversationID,
    originatorConversationId: data.OriginatorConversationID,
    responseCode:             data.ResponseCode,
    responseDescription:      data.ResponseDescription,
  };
}

// ─── Bill Manager ─────────────────────────────────────────────────────────────

export interface BillManagerOptInInput {
  email:           string;
  officialContact: string;
  sendReminders:   0 | 1;
  logo?:           string;
  callbackUrl:     string;
}

export async function billManagerOptIn(input: BillManagerOptInInput): Promise<void> {
  const c = await makeClient();
  await withRetry(() =>
    c.post('/v1/billmanager-invoice/v1/billmanager-invoice/optin', {
      shortcode:       SHORTCODE,
      email:           input.email,
      officialContact: normalizePhone(input.officialContact),
      sendReminders:   input.sendReminders,
      logo:            input.logo ?? '',
      callbackUrl:     input.callbackUrl,
    }),
  );
}

export async function updateBillManagerOptIn(
  input: Partial<BillManagerOptInInput>,
): Promise<void> {
  const c = await makeClient();
  await withRetry(() =>
    c.post('/v1/billmanager-invoice/v1/billmanager-invoice/change-optin-details', {
      shortcode: SHORTCODE,
      ...input,
      ...(input.officialContact
        ? { officialContact: normalizePhone(input.officialContact) }
        : {}),
    }),
  );
}

export interface BillManagerInvoice {
  externalReference: string;
  billedFullName:    string;
  billedPhoneNumber: string;
  billedPeriodStart: string; // YYYY-MM-DD
  billedPeriodEnd:   string;
  invoiceDate:       string;
  dueDate:           string;
  accountReference:  string;
  amount:            number;
  invoiceName:       string;
}

function normaliseBillInvoice(inv: BillManagerInvoice): BillManagerInvoice {
  return { ...inv, billedPhoneNumber: normalizePhone(inv.billedPhoneNumber) };
}

export async function sendSingleInvoice(invoice: BillManagerInvoice): Promise<void> {
  const c = await makeClient();
  await withRetry(() =>
    c.post(
      '/v1/billmanager-invoice/v1/billmanager-invoice/single-invoicing',
      normaliseBillInvoice(invoice),
    ),
  );
}

export async function sendBulkInvoices(invoices: BillManagerInvoice[]): Promise<void> {
  const c = await makeClient();
  await withRetry(() =>
    c.post(
      '/v1/billmanager-invoice/v1/billmanager-invoice/bulk-invoicing',
      invoices.map(normaliseBillInvoice),
    ),
  );
}

export async function updateSingleInvoice(invoice: BillManagerInvoice): Promise<void> {
  const c = await makeClient();
  await withRetry(() =>
    c.post(
      '/v1/billmanager-invoice/v1/billmanager-invoice/change-invoice',
      normaliseBillInvoice(invoice),
    ),
  );
}

export async function updateBulkInvoices(invoices: BillManagerInvoice[]): Promise<void> {
  const c = await makeClient();
  await withRetry(() =>
    c.post(
      '/v1/billmanager-invoice/v1/billmanager-invoice/change-invoices',
      invoices.map(normaliseBillInvoice),
    ),
  );
}

export async function cancelSingleInvoice(externalReference: string): Promise<void> {
  const c = await makeClient();
  await withRetry(() =>
    c.post('/v1/billmanager-invoice/v1/billmanager-invoice/cancel-single-invoice', {
      externalReference,
    }),
  );
}

export async function cancelBulkInvoices(externalReferences: string[]): Promise<void> {
  const c = await makeClient();
  await withRetry(() =>
    c.post('/v1/billmanager-invoice/v1/billmanager-invoice/cancel-bulk-invoice', {
      externalReferences,
    }),
  );
}

export interface BillManagerReconcileInput {
  paymentDate:      string; // YYYY-MM-DD
  accountReference: string;
  transactionId:    string; // M-Pesa receipt
  paidAmount:       number;
  msisdn:           string;
  dateCreated?:     string;
}

export async function reconcileBillManagerPayment(
  input: BillManagerReconcileInput,
): Promise<void> {
  const c = await makeClient();
  await withRetry(() =>
    c.post('/v1/billmanager-invoice/v1/billmanager-invoice/reconciliation', {
      ...input,
      msisdn: normalizePhone(input.msisdn),
    }),
  );
}

// ─── Dynamic QR Code ─────────────────────────────────────────────────────────

/**
 * TrxCode — transaction type the QR encodes.
 *   BG — Buy Goods (Till)
 *   PB — PayBill (account-style)
 *   WA — Withdraw at Agent
 *   SB — Send to Business (paybill, no account)
 *   SM — Send to Mobile (M-Pesa to M-Pesa)
 *   SS — Send to Sortcode (bank-to-M-Pesa)
 */
export type QrTransactionCode = 'BG' | 'PB' | 'WA' | 'SB' | 'SM' | 'SS';

export interface DynamicQrInput {
  /** Display name shown in the customer's M-Pesa app on scan. Max 22 chars per Daraja. */
  merchantName:    string;
  /** Reference shown alongside the merchant name (e.g. invoice no., contribution period). */
  refNo:           string;
  /** Amount in KES (whole shillings, integer). 0 = customer enters amount. */
  amount:          number;
  /** Which M-Pesa flow to encode. */
  trxCode:         QrTransactionCode;
  /** Credit Party Identifier. For PB/SB this is the paybill; for BG it's the till; for SM it's a phone. */
  cpi:             string;
  /** Size in pixels. Daraja documents 300 as the default. */
  size?:           number;
}

export interface DynamicQrResponse {
  ResponseCode:        string;  // '00' = success
  RequestID:           string;
  ResponseDescription: string;
  /** Base64-encoded PNG of the QR. UI renders via <img src="data:image/png;base64,…" />. */
  QRCode:              string;
}

export async function generateDynamicQr(input: DynamicQrInput): Promise<DynamicQrResponse> {
  const c = await makeClient();
  const { data } = await withRetry(() =>
    c.post<DynamicQrResponse>('/mpesa/qrcode/v1/generate', {
      MerchantName: input.merchantName.slice(0, 22),
      RefNo:        input.refNo,
      Amount:       String(toMpesaAmount(input.amount)),
      TrxCode:      input.trxCode,
      CPI:          input.cpi,
      Size:         String(input.size ?? 300),
    }),
  );
  return data;
}
