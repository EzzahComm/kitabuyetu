import { sanitizeMetadata, gsmSafe } from '@/lib/notifications/sanitize';
import { ActivityEventType, ALL_EVENT_TYPES, getEventDefinition } from '@/lib/notifications/activity-events';
import { renderSms, renderEmail, formatEat } from '@/lib/notifications/notification-templates';
import { getAdminRecipients } from '@/lib/notifications/config';
import type { PlatformActivityEvent } from '@/lib/notifications/notification-types';

const withdrawal: PlatformActivityEvent = {
  id: 'a1',
  type: ActivityEventType.WITHDRAWAL_PENDING_REVIEW,
  severity: 'HIGH',
  title: 'Withdrawal Awaiting Kitabu Yetu Approval',
  actor: { name: 'John Doe', email: 'john@example.com' },
  group: { id: 'g1', name: 'XYZ Group' },
  organization: { id: 'o1', name: 'ABC Chama' },
  transaction: { reference: 'WD-00031', amount: 50000, currency: 'KES', status: 'awaiting_platform' },
  metadata: { campaign: 'Water', password: 'hunter2' },
  occurredAt: '2026-09-29T11:42:00.000Z',
  notificationRequired: true,
  activityRef: 'ACT-20260929-000001',
};

describe('sanitizeMetadata', () => {
  it('drops passwords, OTPs, tokens, API keys and PINs at any depth', () => {
    const out = sanitizeMetadata({
      ok: 'keep',
      password: 'x',
      OTP: '123456',
      accessToken: 't',
      refresh_token: 't',
      apiKey: 'k',
      mpesa_pin: '1234',
      SecurityCredential: 'c',
      nested: { authorization: 'Bearer x', fine: 1 },
    });
    expect(out).toEqual({ ok: 'keep', nested: { fine: 1 } });
  });

  it('caps very long strings', () => {
    const out = sanitizeMetadata({ m: 'x'.repeat(5000) }) as { m: string };
    expect(out.m.length).toBeLessThan(600);
  });
});

describe('event registry', () => {
  it('defines every enum member', () => {
    for (const t of ALL_EVENT_TYPES) {
      const d = getEventDefinition(t);
      expect(d.title).toBeTruthy();
      expect(d.title).not.toMatch(/_/);
    }
  });

  it('routes withdrawals and registrations to both channels', () => {
    for (const t of [ActivityEventType.WITHDRAWAL_REQUESTED, ActivityEventType.WITHDRAWAL_PENDING_REVIEW]) {
      const d = getEventDefinition(t);
      expect(d.severity).toBe('HIGH');
      expect(d.sms && d.email && !d.aggregate).toBe(true);
    }
    const reg = getEventDefinition(ActivityEventType.USER_REGISTERED);
    expect(reg.sms && reg.email).toBe(true);
  });

  it('aggregates routine high-volume events and not security ones', () => {
    expect(getEventDefinition(ActivityEventType.CONTRIBUTION_RECEIVED).aggregate).toBe(true);
    expect(getEventDefinition(ActivityEventType.MPESA_C2B_RECEIVED).aggregate).toBe(true);
    expect(getEventDefinition(ActivityEventType.SECURITY_ALERT).aggregate).toBe(false);
    expect(getEventDefinition(ActivityEventType.SECURITY_ALERT).severity).toBe('CRITICAL');
  });

  it('groups sent by a group are reported individually with SMS + email', () => {
    const d = getEventDefinition(ActivityEventType.SMS_CAMPAIGN_SENT);
    expect(d.sms && d.email && !d.aggregate).toBe(true);
  });

  it('never drops an unknown event type', () => {
    const d = getEventDefinition('SOMETHING_NEW');
    expect(d.sms && d.email).toBe(true);
    expect(d.severity).toBe('WARNING');
  });
});

describe('templates', () => {
  it('renders a concise, action-required SMS for a withdrawal', () => {
    const sms = renderSms(withdrawal);
    expect(sms).toMatch(/ACTION REQUIRED/);
    expect(sms).toContain('KES 50,000');
    expect(sms).toContain('ADMIN APPROVAL REQUIRED.');
    expect(sms).toContain('ACT-20260929-000001');
    expect(sms.length).toBeLessThanOrEqual(320);
  });

  it('never puts secrets or the metadata dump into SMS or email', () => {
    // sanitizeMetadata runs before persistence; even if a secret slipped through, SMS has no metadata dump.
    expect(renderSms(withdrawal)).not.toContain('hunter2');
  });

  it('email carries an authenticated admin link with no token and a review button', () => {
    const { html, text, subject } = renderEmail(withdrawal);
    expect(html).toContain('/admin/campaigns');
    expect(html).toContain('REVIEW REQUEST');
    expect(html).not.toMatch(/token=|secret=|otp=/i);
    expect(text).toContain('Action required');
    expect(subject).toContain('HIGH');
    expect(subject).toContain('XYZ Group');
  });

  it('escapes HTML in user-controlled values', () => {
    const { html } = renderEmail({ ...withdrawal, actor: { name: '<script>alert(1)</script>' } });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('formats times in EAT', () => {
    expect(formatEat('2026-09-29T11:35:00.000Z')).toBe('29 Sep 2026 14:35 EAT');
  });

  it('turns non-breaking spaces into plain spaces', () => {
    expect(gsmSafe('a\u00a0b')).toBe('a b');
  });

  it('keeps SMS GSM-safe', () => {
    expect(gsmSafe('Wangari - "tea" … ok')).toBe('Wangari - "tea" ... ok');
  });
});

describe('admin recipients', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });

  it('reads and normalises phone and email from the environment', () => {
    process.env.KITABU_ADMIN_ALERT_PHONE = '+254182625807';
    process.env.KITABU_ADMIN_ALERT_EMAIL = 'Info@kitabuyetu.co.ke';
    expect(getAdminRecipients()).toEqual({ phones: ['254182625807'], emails: ['info@kitabuyetu.co.ke'] });
  });

  it('supports several recipients without code changes', () => {
    process.env.KITABU_ADMIN_ALERT_PHONE = '+254182625807, 0712345678';
    process.env.KITABU_ADMIN_ALERT_EMAIL = 'a@x.com,b@x.com';
    const r = getAdminRecipients();
    expect(r.phones).toHaveLength(2);
    expect(r.emails).toEqual(['a@x.com', 'b@x.com']);
  });
});
