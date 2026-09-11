/**
 * Remaining mock data for the B2B Enterprise portal.
 *
 * Portfolio/branch figures now come from real data (organizationApi.groups /
 * '/organization/dashboard' — see enterprise/page.tsx and
 * enterprise/branches/page.tsx). API keys and webhooks stay mock: there is no
 * developer-settings backend yet (no API key issuance, no webhook delivery
 * pipeline), so this is intentionally not wired — a future, separate build,
 * not a "quick win" gap.
 */

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
