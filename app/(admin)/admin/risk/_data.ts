/**
 * Representative data for the Risk & Fraud dashboard.
 *
 * ⚠️ There is no risk-scoring API route yet — this module is the seam where a
 * `useRiskDashboard()` TanStack Query hook will plug in. Keep the exported
 * shapes stable so swapping mock → live is a one-line change in the page.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface FraudAlert {
  id: string;
  org: string;
  type: string;
  severity: Severity;
  amount: number;
  detail: string;
  /** Minutes ago. */
  ago: number;
  status: 'open' | 'reviewing';
}

export interface KycItem {
  id: string;
  name: string;
  org: string;
  docType: string;
  submitted: string; // human label
  risk: 'low' | 'medium' | 'high';
}

/** Heatmap: rows = segments, cols = risk dimensions, value = 0–100 risk score. */
export const RISK_DIMENSIONS = ['Fraud', 'AML', 'Credit', 'Liquidity', 'Compliance'] as const;

export const heatmap: { segment: string; scores: number[] }[] = [
  { segment: 'VSLAs',          scores: [22, 14, 31, 18, 9] },
  { segment: 'SACCOs',         scores: [41, 38, 55, 47, 26] },
  { segment: 'Organizations',           scores: [12, 19, 8, 15, 33] },
  { segment: 'Microfinance',   scores: [63, 71, 68, 58, 44] },
  { segment: 'Cooperatives',   scores: [29, 24, 37, 22, 17] },
  { segment: 'Enterprise',     scores: [18, 27, 14, 11, 21] },
];

export const fraudAlerts: FraudAlert[] = [
  { id: 'FA-2041', org: 'Mwangaza SACCO',        type: 'Velocity anomaly',    severity: 'critical', amount: 480000, detail: '14 disbursements to one phone in 6 min', ago: 3,  status: 'open' },
  { id: 'FA-2040', org: 'Tujenge Microfinance',  type: 'Duplicate payout',    severity: 'high',     amount: 125000, detail: 'Identical C2B ref settled twice',        ago: 18, status: 'open' },
  { id: 'FA-2039', org: 'Umoja Women Group',     type: 'Unusual hour',        severity: 'medium',   amount: 32000,  detail: 'Bulk disbursement at 02:14 EAT',          ago: 47, status: 'reviewing' },
  { id: 'FA-2038', org: 'Baraka Chama',          type: 'New device + payout',  severity: 'high',     amount: 78000,  detail: 'Admin login from new device → instant payout', ago: 92, status: 'open' },
  { id: 'FA-2037', org: 'Faraja Cooperative',    type: 'Round-tripping',      severity: 'low',      amount: 9500,   detail: 'Funds in/out within 90s, same member',    ago: 140, status: 'reviewing' },
];

export const kycQueue: KycItem[] = [
  { id: 'KYC-771', name: 'Grace Achieng',   org: 'Mwangaza SACCO',       docType: 'National ID',  submitted: '12 min ago', risk: 'low' },
  { id: 'KYC-770', name: 'Daniel Kiprono',  org: 'Tujenge Microfinance', docType: 'Passport',     submitted: '34 min ago', risk: 'high' },
  { id: 'KYC-769', name: 'Aisha Mohamed',   org: 'Umoja Women Group',    docType: 'National ID',  submitted: '1 hr ago',   risk: 'medium' },
  { id: 'KYC-768', name: 'Peter Otieno',    org: 'Baraka Chama',         docType: 'Alien ID',     submitted: '2 hr ago',   risk: 'low' },
  { id: 'KYC-767', name: 'Mary Wairimu',    org: 'Faraja Cooperative',   docType: 'National ID',  submitted: '3 hr ago',   risk: 'low' },
];

/** 7-day alert trend for the chart. */
export const alertTrend = [
  { day: 'Mon', alerts: 8,  resolved: 6 },
  { day: 'Tue', alerts: 12, resolved: 10 },
  { day: 'Wed', alerts: 6,  resolved: 7 },
  { day: 'Thu', alerts: 15, resolved: 11 },
  { day: 'Fri', alerts: 9,  resolved: 9 },
  { day: 'Sat', alerts: 4,  resolved: 5 },
  { day: 'Sun', alerts: 5,  resolved: 4 },
];

/** Map a 0–100 risk score to a heatmap cell colour (green → red). */
export function riskColor(score: number): { bg: string; fg: string } {
  if (score >= 60) return { bg: '#FEE2E2', fg: '#991B1B' }; // high
  if (score >= 40) return { bg: '#FEF3C7', fg: '#92400E' }; // elevated
  if (score >= 20) return { bg: '#FEF9C3', fg: '#854D0E' }; // moderate
  return { bg: '#DCFCE7', fg: '#166534' };                  // low
}
