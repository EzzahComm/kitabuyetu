/**
 * Email trigger engine (Phase 9.4.2, fixed while building Phase 9.4.3's
 * automation rules UI). Regression coverage for the bug this phase found:
 * emitEmailTriggerEvent used to call renderTemplate(rule.template_key, vars)
 * directly — substituting {{vars}} into the KEY STRING itself instead of a
 * template body fetched from email_templates — so every email trigger send
 * would have mailed the literal template_key. These tests pin the fix: the
 * subject/body actually sent come from the email_templates row, rendered.
 */
import { withAdminDb } from '@/lib/db';
import { getCampaignRecipients } from '@/lib/services/campaign.service';
import { emitEmailTriggerEvent } from '@/lib/services/email-trigger.service';

jest.mock('@/lib/db', () => ({
  withAdminDb: jest.fn(),
}));
jest.mock('@/lib/services/campaign.service', () => ({
  getCampaignRecipients: jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (getCampaignRecipients as jest.Mock).mockReset();
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
});

const rolesRule = {
  id: 'rule-1', group_id: 'grp-1', organization_id: null, name: 'Welcome email',
  event_type: 'member.registered', conditions: {}, template_key: 'welcome_email',
  recipient_spec: { type: 'roles', roles: ['chairperson'] },
  delay_seconds: 0, max_retries: 3, created_by: 'user-1',
};

const event = {
  eventType: 'member.registered' as const, eventId: 'evt-1', groupId: 'grp-1',
  payload: { first_name: 'Alice' },
};

describe('emitEmailTriggerEvent — template lookup', () => {
  it('skips the rule (no email sent) when no email_templates row matches template_key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rolesRule] }); // loadMatchingEmailRules
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'mem-1', email: 'a@x.com', name: 'Alice' }] }); // roles recipients
    mockQuery.mockResolvedValueOnce({ rows: [] }); // frequency_caps: none
    mockQuery.mockResolvedValueOnce({ rows: [] }); // loadEmailTemplate: not found

    const summary = await emitEmailTriggerEvent(event);

    expect(summary.skipped).toBe(1);
    expect(summary.dispatched).toBe(0);
    // No INSERT INTO email_campaigns should ever have been attempted.
    expect(mockQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO email_campaigns'))).toBe(false);
  });

  it('renders the email_templates row\'s subject + body, not the raw template_key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rolesRule] }); // loadMatchingEmailRules
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'mem-1', email: 'a@x.com', name: 'Alice' }] }); // roles recipients
    mockQuery.mockResolvedValueOnce({ rows: [] }); // frequency_caps: none
    mockQuery.mockResolvedValueOnce({
      rows: [{ subject: 'Welcome {{first_name}}', body: 'Hi {{first_name}}, glad to have you.' }],
    }); // loadEmailTemplate
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'exec-1' }] }); // email_trigger_executions insert (idempotency claim)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'camp-1' }] }); // email_campaigns insert
    mockQuery.mockResolvedValueOnce({ rows: [] }); // email_campaign_recipients insert

    const summary = await emitEmailTriggerEvent(event);

    expect(summary.dispatched).toBe(1);
    expect(summary.skipped).toBe(0);

    const campaignInsert = mockQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO email_campaigns'));
    expect(campaignInsert).toBeDefined();
    const [, params] = campaignInsert!;
    // params: [groupId, name, subject, html_body, recipients, created_by]
    expect(params[2]).toBe('Welcome Alice');                          // rendered subject, not 'welcome_email'
    expect(params[3]).toBe('Hi Alice, glad to have you.');            // rendered body, not 'welcome_email'
    expect(params[3]).not.toContain('welcome_email');
  });
});
