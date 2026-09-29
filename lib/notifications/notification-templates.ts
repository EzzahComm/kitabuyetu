/**
 * SMS and email rendering for administrator alerts.
 *
 * SMS: concise, actionable, no secrets, and no metadata dump — only the
 * whitelisted fields below. Email: full detail plus a link to the
 * authenticated admin screen (never a token).
 */
import { officialAppUrl } from '@/lib/app-links';
import { gsmSafe } from './sanitize';
import { ActivityEventType } from './activity-events';
import type { PlatformActivityEvent } from './notification-types';

const SMS_MAX = 320; // two GSM segments

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "29 Sep 2026 14:35 EAT". Kenya is UTC+3 all year (no DST); month names are fixed, not ICU-dependent. */
export function formatEat(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} EAT`;
}

export function formatMoney(amount?: number, currency = 'KES'): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  return `${currency} ${amount.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

/** Admin screen an event should link to. */
export function adminPathFor(type: string, override?: string): string {
  if (override) return override;
  if (type.startsWith('WITHDRAWAL_') || type.startsWith('CAMPAIGN_') || type === ActivityEventType.APPROVAL_REQUESTED) {
    return '/admin/campaigns';
  }
  if (type === ActivityEventType.MPESA_UNROUTED_PAYMENT) return '/admin/mpesa-unrouted';
  if (type.startsWith('SYSTEM_') || type.endsWith('_FAILURE') || type === ActivityEventType.ERROR_SPIKE) {
    return '/admin/monitoring';
  }
  return '/admin/activity';
}

export function adminUrlFor(type: string, override?: string): string {
  return `${officialAppUrl}${adminPathFor(type, override)}`;
}

/** Events that need a human to act, not just read. */
const ACTION_REQUIRED = new Set<string>([
  ActivityEventType.WITHDRAWAL_PENDING_REVIEW,
  ActivityEventType.APPROVAL_REQUESTED,
  ActivityEventType.CAMPAIGN_SUBMITTED,
]);

export const isActionRequired = (type: string) => ACTION_REQUIRED.has(type);

interface Row {
  label: string;
  value: string;
}

/** Ordered label/value pairs shared by both channels. */
function coreRows(e: PlatformActivityEvent): Row[] {
  const rows: Row[] = [];
  const add = (label: string, value: unknown) => {
    if (value == null || value === '') return;
    rows.push({ label, value: String(value) });
  };
  const tx = e.transaction;
  add('Amount', formatMoney(tx?.amount, tx?.currency));
  add('Type', tx?.type);
  add('By', e.actor?.name);
  add('Role', e.actor?.role);
  add('Organization', e.organization?.name);
  add('Group', e.group?.name);
  add('Reference', tx?.reference ?? tx?.id);
  add('Status', tx?.status);
  add('Time', formatEat(e.occurredAt));
  return rows;
}

function metaLines(e: PlatformActivityEvent): string[] {
  const m = e.metadata ?? {};
  const lines = m.smsLines;
  return Array.isArray(lines) ? lines.map(String) : [];
}

export function renderSms(e: PlatformActivityEvent): string {
  const head = isActionRequired(e.type) ? 'KITABU YETU - ACTION REQUIRED' : 'KITABU YETU ALERT';
  const lines = [head, e.title + (e.severity === 'CRITICAL' || e.severity === 'HIGH' ? ` [${e.severity}]` : '')];
  for (const r of coreRows(e)) lines.push(`${r.label}: ${r.value}`);
  lines.push(...metaLines(e));
  if (e.activityRef) lines.push(`Ref: ${e.activityRef}`);
  if (isActionRequired(e.type)) lines.push('ADMIN APPROVAL REQUIRED.');
  let out = gsmSafe(lines.join('\n'));
  if (out.length > SMS_MAX) out = `${out.slice(0, SMS_MAX - 3)}...`;
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SEV_COLOR: Record<string, string> = { INFO: '#2563eb', WARNING: '#d97706', HIGH: '#dc2626', CRITICAL: '#7f1d1d' };

function metaRows(e: PlatformActivityEvent): Row[] {
  const rows: Row[] = [];
  for (const [k, v] of Object.entries(e.metadata ?? {})) {
    if (k === 'smsLines' || v == null || typeof v === 'object') continue;
    rows.push({
      label: k.includes(' ')
        ? k
        : k
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .trim(),
      value: String(v),
    });
  }
  return rows;
}

export function renderEmail(
  e: PlatformActivityEvent,
  adminPath?: string,
): { subject: string; html: string; text: string } {
  const rows = [
    ...coreRows(e),
    ...(e.actor?.email ? [{ label: 'Email', value: e.actor.email }] : []),
    ...(e.actor?.phone ? [{ label: 'Phone', value: e.actor.phone }] : []),
    ...(e.actor?.userId ? [{ label: 'User ID', value: e.actor.userId }] : []),
    ...metaRows(e),
    ...(e.activityRef ? [{ label: 'Activity ID', value: e.activityRef }] : []),
  ];
  const action = isActionRequired(e.type);
  const link = adminUrlFor(e.type, adminPath);
  const color = SEV_COLOR[e.severity] ?? '#2563eb';
  const subject = `[Kitabu Yetu ${e.severity}] ${e.title}${e.group?.name ? ` - ${e.group.name}` : ''}`;

  const tableRows = rows
    .map(
      (r) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;vertical-align:top;white-space:nowrap">${esc(r.label)}</td><td style="padding:6px 0;color:#0f172a;font-weight:600">${esc(r.value)}</td></tr>`,
    )
    .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#0f172a;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
    <div style="font-size:18px;font-weight:700;letter-spacing:.5px">KITABU YETU</div>
    <div style="font-size:12px;opacity:.8">Platform Activity Alert</div>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px">
    <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a;text-transform:uppercase">${esc(e.title)}</h2>
    <p style="margin:0 0 16px"><span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">${esc(e.severity)}</span></p>
    ${e.description ? `<p style="margin:0 0 16px;color:#334155">${esc(e.description)}</p>` : ''}
    <table style="border-collapse:collapse;font-size:14px;width:100%">${tableRows}</table>
    ${
      action
        ? `<p style="margin:20px 0 8px;color:#0f172a;font-weight:700">Action required: review this request.</p>`
        : ''
    }
    <p style="margin:12px 0"><a href="${esc(link)}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:700">${action ? 'REVIEW REQUEST' : 'OPEN ADMIN DASHBOARD'}</a></p>
    <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">This is an automated Kitabu Yetu platform notification. Sign-in is required to act on it.</p>
  </div>
</div></body></html>`;

  const text = [
    'KITABU YETU - Platform Activity Alert',
    '',
    `${e.title} [${e.severity}]`,
    e.description ?? '',
    ...rows.map((r) => `${r.label}: ${r.value}`),
    '',
    action ? `Action required: ${link}` : `Admin dashboard: ${link}`,
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');

  return { subject, html, text };
}
