import { CampaignCreateSchema } from '@/lib/validators/sms.schema';

const base = { name: 'Reminder', message: 'Pay up', recipientType: 'all_members' as const };

describe('CampaignCreateSchema funding', () => {
  it('defaults to group funding, preserving prior behaviour', () => {
    const parsed = CampaignCreateSchema.parse(base);
    expect(parsed.fundedBy).toBe('group');
    expect(parsed.organizationId).toBeUndefined();
  });

  it('accepts organization funding when an organizationId is supplied', () => {
    const orgId  = '3f1a2b4c-5d6e-4f70-8901-234567890abc';
    const parsed = CampaignCreateSchema.parse({ ...base, fundedBy: 'organization', organizationId: orgId });
    expect(parsed).toMatchObject({ fundedBy: 'organization', organizationId: orgId });
  });

  it('rejects organization funding with no organizationId — the payer would be unresolvable', () => {
    expect(() => CampaignCreateSchema.parse({ ...base, fundedBy: 'organization' })).toThrow();
  });

  it('rejects a non-uuid organizationId', () => {
    expect(() =>
      CampaignCreateSchema.parse({ ...base, fundedBy: 'organization', organizationId: 'acme' }),
    ).toThrow();
  });
});
