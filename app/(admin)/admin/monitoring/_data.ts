/**
 * Representative data for the Platform Monitoring page.
 *
 * ⚠️ No live monitoring API yet — this is the seam for real sources:
 *   • service health  → Daraja status checks + internal /api/health/deep
 *   • txn feed         → a Supabase Realtime channel on the transactions table
 *   • SMS usage        → the SMS provider's usage endpoint
 * Keep the exported shapes stable so swapping mock → live is localised.
 */

export type ServiceStatus = 'operational' | 'degraded' | 'down';

export interface ServiceHealth {
  id: string;
  name: string;
  group: 'M-Pesa / Daraja' | 'Messaging' | 'Platform';
  status: ServiceStatus;
  /** p95 latency, ms. */
  latency: number;
  /** Success rate over the trailing window, %. */
  success: number;
  note: string;
}

export const services: ServiceHealth[] = [
  { id: 'c2b',     name: 'Daraja C2B (Paybill/Till)', group: 'M-Pesa / Daraja', status: 'operational', latency: 320, success: 99.7, note: 'Confirmation + validation healthy' },
  { id: 'b2c',     name: 'Daraja B2C (Disbursements)', group: 'M-Pesa / Daraja', status: 'operational', latency: 540, success: 99.2, note: 'Queue depth normal' },
  { id: 'stk',     name: 'STK Push (Express)',         group: 'M-Pesa / Daraja', status: 'degraded',    latency: 1480, success: 94.1, note: 'Elevated timeouts on Safaricom side' },
  { id: 'oauth',   name: 'Daraja OAuth',               group: 'M-Pesa / Daraja', status: 'operational', latency: 210, success: 99.9, note: 'Token refresh nominal' },
  { id: 'sms',     name: 'SMS Gateway',                group: 'Messaging',        status: 'operational', latency: 380, success: 98.8, note: 'Sender IDs approved' },
  { id: 'whatsapp',name: 'WhatsApp Cloud API',         group: 'Messaging',        status: 'operational', latency: 460, success: 99.4, note: 'Templates approved' },
  { id: 'webhooks',name: 'Outbound Webhooks',          group: 'Platform',         status: 'operational', latency: 150, success: 99.6, note: 'No backlog' },
  { id: 'api',     name: 'Public API (v1)',            group: 'Platform',         status: 'operational', latency: 95,  success: 99.95, note: 'p95 within SLA' },
];

/** Hourly transaction volume + value for today's chart. */
export const hourlyVolume = [
  { hour: '06:00', count: 42,  value: 184000 },
  { hour: '08:00', count: 118, value: 642000 },
  { hour: '10:00', count: 203, value: 1180000 },
  { hour: '12:00', count: 176, value: 905000 },
  { hour: '14:00', count: 231, value: 1340000 },
  { hour: '16:00', count: 289, value: 1620000 },
  { hour: '18:00', count: 197, value: 980000 },
];

export const smsUsage = {
  sentToday: 8420,
  delivered: 8190,
  failed: 142,
  pending: 88,
  creditsRemaining: 41600,
  creditsTotal: 50000,
};

// ── Real-time transaction feed ───────────────────────────────────────────────
export type TxnType = 'C2B' | 'B2C' | 'STK';
export type TxnStatus = 'success' | 'pending' | 'failed';

export interface Transaction {
  id: string;
  type: TxnType;
  org: string;
  phone: string;
  amount: number;
  status: TxnStatus;
  ref: string;
  /** epoch ms */
  at: number;
}

const ORGS = ['Mwangaza SACCO', 'Umoja Women Group', 'Tujenge Microfinance', 'Baraka Chama', 'Faraja Cooperative', 'Jenga Organization'];
const TYPES: TxnType[] = ['C2B', 'C2B', 'C2B', 'STK', 'B2C']; // C2B most common
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function maskPhone(): string {
  const last = String(Math.floor(Math.random() * 900) + 100);
  return `+254 7•• ••• ${last}`;
}

function txnStatus(): TxnStatus {
  const r = Math.random();
  if (r > 0.92) return 'failed';
  if (r > 0.8) return 'pending';
  return 'success';
}

/** Generate a single transaction. `seq` keeps React keys stable + unique. */
export function makeTransaction(seq: number): Transaction {
  const type = pick(TYPES);
  return {
    id: `TXN-${seq}`,
    type,
    org: pick(ORGS),
    phone: maskPhone(),
    amount: (Math.floor(Math.random() * 200) + 1) * 50, // KES 50–10,000
    status: txnStatus(),
    ref: `${type}${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    at: Date.now(),
  };
}

/** Seed the feed with a short backlog so it isn't empty on first paint. */
export function seedTransactions(count: number): Transaction[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    ...makeTransaction(1000 - i),
    at: now - i * 7000,
  }));
}

export function relativeTime(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
