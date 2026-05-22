/**
 * Safaricom Daraja Production API Client
 *
 * Covers every API required for production:
 *   OAuth, STK Push + Query, C2B v1/v2, B2C, B2B,
 *   Reversal, Transaction Status, Account Balance, Bill Manager.
 *
 * Design:
 *  - OAuth token is cached in Redis (shared across instances) + in-memory
 *    (avoids a Redis round-trip on every request within the same instance).
 *  - Automatic retry with exponential backoff on 5xx / 429 responses.
 *  - All amounts converted to integer shillings before transmission.
 *  - All phone numbers normalised to E.164 (254XXXXXXXXX) before transmission.
 */

import axios, { AxiosInstance } from 'axios';
import { redis } from '@/lib/redis';
import { toMpesaAmount } from '@/lib/utils/currency';
import { normalizePhone } from '@/lib/utils/phone';

// ─── Configuration ────────────────────────────────────────────────────────────

const IS_SANDBOX = (process.env.MPESA_ENV ?? 'sandbox') !== 'production';

const BASE_URL = IS_SANDBOX
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke';

const CONSUMER_KEY        = process.env.MPESA_CONSUMER_KEY!;
const CONSUMER_SECRET     = process.env.MPESA_CONSUMER_SECRET!;
const PASSKEY             = process.env.MPESA_PASSKEY!;
const SHORTCODE           = process.env.MPESA_SHORTCODE!;
const B2C_SHORTCODE       = process.env.MPESA_B2C_SHORTCODE ?? process.env.MPESA_SHORTCODE!;
const CALLBACK_BASE       = (process.env.MPESA_CALLBACK_BASE_URL ?? '').replace(/\/$/, '');
const INITIATOR_NAME      = process.env.MPESA_B2C_INITIATOR_NAME ?? 'KitabuYetu';
const SECURITY_CREDENTIAL = process.env.MPESA_B2C_SECURITY_CREDENTIAL ?? '';

// Safaricom's published production IP ranges for callback validation
const DEFAULT_SAFARICOM_IPS = [
  '196.201.214.200', '196.201.214.206', '196.201.213.150', '196.201.214.115',
  '196.201.214.128', '196.201.214.129', '196.201.214.130', '196.201.214.131',
  '196.201.214.132', '196.201.213.128', '196.201.213.129', '196.201.213.130',
  '196.201.213.131', '196.201.213.132', '196.201.213.140', '196.201.213.141',
  '196.201.213.142', '196.201.213.143', '196.201.213.144', '196.201.213.145',
  '196.201.213.146', '196.201.213.147', '196.201.213.148', '196.201.213.149',
];

const ALLOWED_IPS = new Set<string>(
  process.env.MPESA_ALLOWED_IPS
    ? process.env.MPESA_ALLOWED_IPS.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_SAFARICOM_IPS,
);

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
  if (IS_SANDBOX) return;
  if (!ALLOWED_IPS.has(ip)) {
    throw new Error(`Rejected callback from unauthorized IP: ${ip}`);
  }
}

function originatorId(): string {
  return `KY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    c.post(`/mpesa/c2b/${version}/registerurl`, {
      ShortCode:       SHORTCODE,
      ResponseType:    'Completed',
      ConfirmationURL: `${CALLBACK_BASE}/api/v1/mpesa/c2b?type=confirmation`,
      ValidationURL:   `${CALLBACK_BASE}/api/v1/mpesa/c2b?type=validation`,
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
      SecurityCredential:       SECURITY_CREDENTIAL,
      CommandID:                input.commandId,
      Amount:                   amount,
      PartyA:                   B2C_SHORTCODE,
      PartyB:                   phone,
      Remarks:                  input.remarks.slice(0, 100),
      QueueTimeOutURL:          `${CALLBACK_BASE}/api/v1/mpesa/b2c?type=timeout`,
      ResultURL:                `${CALLBACK_BASE}/api/v1/mpesa/b2c?type=result`,
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
    SecurityCredential:       SECURITY_CREDENTIAL,
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
      SecurityCredential:     SECURITY_CREDENTIAL,
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
      SecurityCredential:       SECURITY_CREDENTIAL,
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
      SecurityCredential: SECURITY_CREDENTIAL,
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
