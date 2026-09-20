/**
 * Automation rules service (Phase 9.4.3) — unified CRUD over sms_trigger_rules
 * and email_trigger_rules: validation of the recipient_spec/conditions
 * grammars, the template-exists guard (the direct fix for the class of bug
 * this phase surfaced in email-trigger.service.ts — a rule silently no-op'ing
 * because its template_key was never created), scope requirements, and the
 * ownership check that keeps an inherited org/platform rule read-only.
 */
import { withDb } from '@/lib/db';
import {
  listAutomationRules,
  getAutomationRule,
  createAutomationRule,
  updateAutomationRule,
  listRuleExecutions,
  listFrequencyCaps,
  upsertFrequencyCap,
} from '@/lib/services/automation-rules.service';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
}));

const mockQuery = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const groupCtx = { groupId: 'grp-1', userId: 'user-1', role: 'chairperson' };
const orgCtx = { groupId: '', organizationId: 'org-1', userId: 'user-2', role: 'organization_coordinator' };
const noScopeCtx = { groupId: '', userId: 'user-3', role: 'member' };

const validSmsInput = {
  name: 'Loan approved notice',
  event_type: 'loan.approved',
  template_key: 'loan_approved',
  recipient_spec: { type: 'active_members' },
};

describe('createAutomationRule — validation', () => {
  it('rejects a blank name before any query runs', async () => {
    await expect(createAutomationRule(groupCtx, 'sms', { ...validSmsInput, name: '  ' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects an unknown channel', async () => {
    await expect(createAutomationRule(groupCtx, 'whatsapp', validSmsInput)).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a malformed recipient_spec', async () => {
    await expect(
      createAutomationRule(groupCtx, 'sms', { ...validSmsInput, recipient_spec: { type: 'literally_anything' } }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects event_phone recipient_spec for the email channel (SMS-only spec)', async () => {
    await expect(
      createAutomationRule(groupCtx, 'email', {
        ...validSmsInput,
        recipient_spec: { type: 'event_phone', field: 'phone' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a roles spec with an empty roles array', async () => {
    await expect(
      createAutomationRule(groupCtx, 'sms', { ...validSmsInput, recipient_spec: { type: 'roles', roles: [] } }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects conditions that are not {} or a single {field, op} leaf', async () => {
    await expect(
      createAutomationRule(groupCtx, 'sms', { ...validSmsInput, conditions: { all: [{ field: 'a', op: 'eq' }] } }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects delay_seconds out of range', async () => {
    await expect(createAutomationRule(groupCtx, 'sms', { ...validSmsInput, delay_seconds: -1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a caller with neither a group nor an organization', async () => {
    await expect(createAutomationRule(noScopeCtx, 'sms', validSmsInput)).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a template_key with no matching active template for the scope', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // assertTemplateExists finds nothing
    await expect(createAutomationRule(groupCtx, 'sms', validSmsInput)).rejects.toBeInstanceOf(ValidationError);
  });

  it('creates a group-scoped SMS rule once the template exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tpl-1' }] }); // assertTemplateExists
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'rule-1', group_id: 'grp-1', organization_id: null, name: 'Loan approved notice' }],
    });

    const result = await createAutomationRule(groupCtx, 'sms', validSmsInput);

    expect(result.id).toBe('rule-1');
    expect(result.channel).toBe('sms');
    const insertCall = mockQuery.mock.calls[1];
    expect(String(insertCall[0])).toContain('INSERT INTO sms_trigger_rules');
    expect(insertCall[1][0]).toBe('grp-1'); // group_id
    expect(insertCall[1][1]).toBeNull(); // organization_id
  });

  it('creates an organization-scoped email rule for a groupless organization context', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tpl-1' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'rule-2', group_id: null, organization_id: 'org-1', name: 'Newsletter' }],
    });

    const result = await createAutomationRule(orgCtx, 'email', {
      name: 'Newsletter',
      event_type: 'contribution.recorded',
      template_key: 'newsletter',
      recipient_spec: { type: 'active_members' },
    });

    expect(result.channel).toBe('email');
    const insertCall = mockQuery.mock.calls[1];
    expect(String(insertCall[0])).toContain('INSERT INTO email_trigger_rules');
    expect(insertCall[1][0]).toBeNull(); // group_id
    expect(insertCall[1][1]).toBe('org-1'); // organization_id
  });
});

describe('listAutomationRules', () => {
  it('queries both tables and tags each row with its channel when no filter is given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'sms-1', created_at: new Date('2026-01-01') }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'email-1', created_at: new Date('2026-01-02') }] });

    const result = await listAutomationRules(groupCtx);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(result.map((r) => r.channel).sort()).toEqual(['email', 'sms']);
    expect(result[0].id).toBe('email-1'); // sorted newest first
  });

  it('queries only sms_trigger_rules when channel=sms', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listAutomationRules(groupCtx, 'sms');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(String(mockQuery.mock.calls[0][0])).toContain('FROM sms_trigger_rules');
  });
});

describe('getAutomationRule', () => {
  it('returns null when the rule does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getAutomationRule(groupCtx, 'email', 'missing')).toBeNull();
  });

  it('rejects an invalid channel before querying', async () => {
    await expect(getAutomationRule(groupCtx, 'carrier-pigeon', 'x')).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('updateAutomationRule — ownership + validation', () => {
  it("throws NotFoundError when the rule does not belong to the caller's own group", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ownership-scoped UPDATE matches nothing
    await expect(
      updateAutomationRule(groupCtx, 'sms', 'other-groups-rule', { is_active: false }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an update with an out-of-range max_retries before any query runs', async () => {
    await expect(updateAutomationRule(groupCtx, 'sms', 'rule-1', { max_retries: 11 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('re-validates template_key against the templates table when it changes', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // assertTemplateExists finds nothing
    await expect(
      updateAutomationRule(groupCtx, 'email', 'rule-1', { template_key: 'ghost_template' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("toggles is_active scoped to the caller's own group", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'rule-1', group_id: 'grp-1', organization_id: null, is_active: false }],
    });

    const result = await updateAutomationRule(groupCtx, 'sms', 'rule-1', { is_active: false });

    expect(result.is_active).toBe(false);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('WHERE id = $1 AND group_id = $');
    expect(params).toContain('grp-1');
  });
});

describe('listRuleExecutions', () => {
  it('caps an out-of-range limit and falls back to 20 for a non-numeric one', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listRuleExecutions(groupCtx, 'sms', 'rule-1', NaN);
    expect(mockQuery.mock.calls[0][1]).toEqual(['rule-1', 20]);

    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listRuleExecutions(groupCtx, 'sms', 'rule-1', 500);
    expect(mockQuery.mock.calls[1][1]).toEqual(['rule-1', 100]);
  });
});

describe('frequency caps', () => {
  it('rejects max_per_day out of range before any query runs', async () => {
    await expect(
      upsertFrequencyCap(groupCtx, 'rule-1', { category: 'marketing', max_per_day: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a caller with no group (caps are group-scoped)', async () => {
    await expect(
      upsertFrequencyCap(orgCtx, 'rule-1', { category: 'marketing', max_per_day: 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the rule is not an email_trigger_rules row owned by this group', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      upsertFrequencyCap(groupCtx, 'sms-rule-1', { category: 'marketing', max_per_day: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('upserts a cap for an owned email rule', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ event_type: 'contribution.recorded' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'cap-1', rule_id: 'rule-1', category: 'marketing', max_per_day: 1, is_active: true }],
    });

    const result = await upsertFrequencyCap(groupCtx, 'rule-1', { category: 'marketing', max_per_day: 1 });
    expect(result.id).toBe('cap-1');
  });

  it('lists caps for a rule', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cap-1', category: 'transactional', max_per_day: 5 }] });
    const caps = await listFrequencyCaps(groupCtx, 'rule-1');
    expect(caps).toHaveLength(1);
  });
});
