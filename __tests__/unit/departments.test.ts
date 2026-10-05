import { DEPARTMENTS, departmentEmail, departmentsForEvent, type Department } from '@/lib/departments';
import { ActivityEventType, ALL_EVENT_TYPES } from '@/lib/notifications/activity-events';
import { getAdminRecipients } from '@/lib/notifications/config';
import { CONTACT } from '@/components/marketing/routes';

/** The six real cPanel mailboxes on kitabuyetu.co.ke. */
const MAILBOXES = [
  'info@kitabuyetu.co.ke',
  'admin@kitabuyetu.co.ke',
  'billing@kitabuyetu.co.ke',
  'support@kitabuyetu.co.ke',
  'hr@kitabuyetu.co.ke',
  'enterprise@kitabuyetu.co.ke',
];

describe('departments', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });

  it('maps every department to a real mailbox', () => {
    for (const d of Object.values(DEPARTMENTS)) expect(MAILBOXES).toContain(d.email);
    expect(new Set(Object.values(DEPARTMENTS).map((d) => d.email)).size).toBe(6);
  });

  it('public contact details use only real mailboxes (no careers@ / sales@)', () => {
    for (const e of [
      CONTACT.email,
      CONTACT.careersEmail,
      CONTACT.supportEmail,
      CONTACT.billingEmail,
      CONTACT.enterpriseEmail,
    ]) {
      expect(MAILBOXES).toContain(e);
    }
    expect(CONTACT.careersEmail).toBe('hr@kitabuyetu.co.ke');
  });

  it('allows a per-department override from the environment', () => {
    process.env.KITABU_EMAIL_BILLING = 'Finance@kitabuyetu.co.ke';
    expect(departmentEmail('billing')).toBe('finance@kitabuyetu.co.ke');
    expect(departmentEmail('hr')).toBe('hr@kitabuyetu.co.ke');
  });

  it.each([
    [ActivityEventType.SUBSCRIPTION_CREATED, ['billing']],
    [ActivityEventType.PAYMENT_FAILED, ['billing']],
    [ActivityEventType.WITHDRAWAL_PENDING_REVIEW, ['billing', 'admin']],
    [ActivityEventType.SECURITY_ALERT, ['admin']],
    [ActivityEventType.ROLE_CHANGED, ['admin']],
    [ActivityEventType.SYSTEM_DOWNTIME, ['admin']],
    [ActivityEventType.ACCOUNT_LOCKED, ['support']],
    [ActivityEventType.MPESA_UNROUTED_PAYMENT, ['billing', 'support']],
    [ActivityEventType.JOB_APPLICATION_SUBMITTED, ['hr']],
    [ActivityEventType.ORGANIZATION_CREATED, ['enterprise']],
  ] as [string, Department[]][])('routes %s to %j', (type, depts) => {
    expect(departmentsForEvent(type)).toEqual(depts);
  });

  it('every mapped department exists', () => {
    for (const t of ALL_EVENT_TYPES) for (const d of departmentsForEvent(t)) expect(DEPARTMENTS[d]).toBeTruthy();
  });

  it('unmapped events go to the general mailbox only', () => {
    expect(departmentsForEvent(ActivityEventType.MEMBER_ADDED)).toEqual([]);
  });
});

describe('alert recipients by event', () => {
  beforeEach(() => {
    process.env.KITABU_ADMIN_ALERT_PHONE = '+254182625807';
    process.env.KITABU_ADMIN_ALERT_EMAIL = 'info@kitabuyetu.co.ke';
  });

  it('always includes the official address, plus the responsible departments', () => {
    const r = getAdminRecipients(ActivityEventType.WITHDRAWAL_PENDING_REVIEW);
    expect(r.emails).toEqual(['info@kitabuyetu.co.ke', 'billing@kitabuyetu.co.ke', 'admin@kitabuyetu.co.ke']);
    expect(r.phones).toEqual(['254182625807']); // SMS stays on the single official phone
  });

  it('a job application reaches HR; an unmapped event reaches only info@', () => {
    expect(getAdminRecipients(ActivityEventType.JOB_APPLICATION_SUBMITTED).emails).toContain('hr@kitabuyetu.co.ke');
    expect(getAdminRecipients(ActivityEventType.MEMBER_ADDED).emails).toEqual(['info@kitabuyetu.co.ke']);
    expect(getAdminRecipients().emails).toEqual(['info@kitabuyetu.co.ke']);
  });

  it('does not duplicate an address configured both ways', () => {
    process.env.KITABU_ADMIN_ALERT_EMAIL = 'info@kitabuyetu.co.ke, billing@kitabuyetu.co.ke';
    const r = getAdminRecipients(ActivityEventType.PAYMENT_FAILED);
    expect(r.emails.filter((e) => e === 'billing@kitabuyetu.co.ke')).toHaveLength(1);
  });
});
