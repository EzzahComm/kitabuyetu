/**
 * Representative data for the B2B Enterprise portal.
 *
 * ⚠️ No enterprise/portfolio API yet — this is the seam for the real hooks:
 *   • portfolio + branches → `usePortfolio()` aggregating across child groups
 *   • API keys / webhooks  → developer-settings endpoints
 * The enterprise tier aggregates many groups (a federation, NGO programme, or
 * microfinance branch network), so every figure here is a roll-up.
 */

export interface Organization {
  id: string;
  name: string;
  type: 'Federation' | 'NGO Programme' | 'Microfinance' | 'Cooperative Union';
  branches: number;
}

export const organizations: Organization[] = [
  { id: 'org1', name: 'Hisa Africa Federation', type: 'Federation', branches: 12 },
  { id: 'org2', name: 'Imani Microfinance', type: 'Microfinance', branches: 8 },
  { id: 'org3', name: 'Jenga Mashinani Programme', type: 'NGO Programme', branches: 21 },
];

export const portfolio = {
  members: 18420,
  savings: 248_500_000,
  loansOut: 96_200_000,
  /** Portfolio at risk (>30d) %. */
  par: 4.2,
  activeGroups: 412,
  branches: 12,
  /** YoY growth %. */
  savingsGrowth: 18.4,
  membersGrowth: 11.2,
};

export interface Branch {
  id: string;
  name: string;
  region: string;
  members: number;
  savings: number;
  loansOut: number;
  /** Portfolio at risk %. */
  par: number;
  status: 'active' | 'review' | 'onboarding';
  /** 6-pt savings sparkline. */
  trend: { v: number }[];
}

const spark = (base: number) =>
  Array.from({ length: 6 }, (_, i) => ({ v: Math.round(base * (0.8 + i * 0.05 + Math.random() * 0.05)) }));

export const branches: Branch[] = [
  { id: 'b1', name: 'Nairobi Central', region: 'Nairobi',   members: 3240, savings: 62_400_000, loansOut: 28_100_000, par: 3.1, status: 'active',     trend: spark(60) },
  { id: 'b2', name: 'Mombasa',         region: 'Coast',     members: 2110, savings: 38_900_000, loansOut: 16_400_000, par: 5.8, status: 'active',     trend: spark(38) },
  { id: 'b3', name: 'Kisumu',          region: 'Nyanza',    members: 1980, savings: 31_200_000, loansOut: 12_900_000, par: 4.4, status: 'active',     trend: spark(31) },
  { id: 'b4', name: 'Nakuru',          region: 'Rift Valley', members: 1740, savings: 27_600_000, loansOut: 11_200_000, par: 6.9, status: 'review',   trend: spark(27) },
  { id: 'b5', name: 'Eldoret',         region: 'Rift Valley', members: 1520, savings: 22_100_000, loansOut: 8_700_000,  par: 3.7, status: 'active',     trend: spark(22) },
  { id: 'b6', name: 'Nyeri',           region: 'Central',   members: 1280, savings: 18_400_000, loansOut: 6_900_000,  par: 2.9, status: 'active',     trend: spark(18) },
  { id: 'b7', name: 'Garissa',         region: 'North East', members: 640,  savings: 6_200_000,  loansOut: 2_100_000,  par: 8.1, status: 'review',   trend: spark(6) },
  { id: 'b8', name: 'Machakos',        region: 'Eastern',   members: 410,   savings: 3_100_000,  loansOut: 900_000,    par: 1.8, status: 'onboarding', trend: spark(3) },
];

export const portfolioTrend = [
  { month: 'Dec', savings: 198_000_000, loans: 74_000_000 },
  { month: 'Jan', savings: 210_000_000, loans: 79_000_000 },
  { month: 'Feb', savings: 219_000_000, loans: 83_000_000 },
  { month: 'Mar', savings: 228_000_000, loans: 88_000_000 },
  { month: 'Apr', savings: 239_000_000, loans: 92_000_000 },
  { month: 'May', savings: 248_500_000, loans: 96_200_000 },
];

export const savingsByRegion = [
  { name: 'Nairobi', value: 62_400_000 },
  { name: 'Rift Valley', value: 49_700_000 },
  { name: 'Coast', value: 38_900_000 },
  { name: 'Nyanza', value: 31_200_000 },
  { name: 'Central', value: 18_400_000 },
  { name: 'Other', value: 47_900_000 },
];

/** Program / impact analytics — the metrics NGOs & funders report on. */
export const impact = [
  { label: 'Women members', value: 68, hint: '12,525 women' },
  { label: 'Youth (18–35)', value: 41, hint: '7,552 members' },
  { label: 'Rural reach', value: 57, hint: '235 villages' },
  { label: 'Loan repayment rate', value: 95, hint: 'On-time, 90d' },
];

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created: string;
  lastUsed: string;
  status: 'active' | 'revoked';
}

export const apiKeys: ApiKey[] = [
  { id: 'k1', name: 'Production server', prefix: 'ky_live_8fK2', scopes: ['read', 'write', 'disburse'], created: '12 Jan 2026', lastUsed: '2 min ago', status: 'active' },
  { id: 'k2', name: 'Reporting (read-only)', prefix: 'ky_live_2pL9', scopes: ['read'], created: '03 Mar 2026', lastUsed: '1 hr ago', status: 'active' },
  { id: 'k3', name: 'Old integration', prefix: 'ky_live_0aZ1', scopes: ['read', 'write'], created: '20 Aug 2025', lastUsed: '4 months ago', status: 'revoked' },
];

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  status: 'active' | 'failing';
  lastDelivery: string;
}

export const webhooks: Webhook[] = [
  { id: 'w1', url: 'https://api.hisa.africa/hooks/kitabu', events: ['contribution.created', 'loan.disbursed', 'member.joined'], status: 'active', lastDelivery: '30s ago · 200' },
  { id: 'w2', url: 'https://reports.hisa.africa/ingest', events: ['payout.completed'], status: 'failing', lastDelivery: '5 min ago · 503' },
];
