/**
 * Marketing campaign service — audience resolution (SMS + email, Phase 9.2 +
 * 9.3), the mandatory approval workflow (maker-checker: approver != creator,
 * role must match the campaign's scope), dual group/organization scoping,
 * consent/suppression enforcement at resolution time, and the email-channel
 * live-status overlay in getCampaignById.
 */
import { withDb, withAdminDb } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { resolveSmsRecipients } from '@/lib/services/sms.service';
import { getCampaignRecipients } from '@/lib/services/campaign.service';
import {
  createAudience,
  createCampaign,
  getCampaignById,
  submitForReview,
  approveCampaign,
  rejectCampaign,
  completeMarketingCampaignSend,
} from '@/lib/services/marketing-campaigns.service';
import { ValidationError, ForbiddenError, NotFoundError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withAdminDb: jest.fn(),
}));
jest.mock('@/lib/jobs', () => ({
  enqueueJob: jest.fn(),
}));
jest.mock('@/lib/services/sms.service', () => ({
  resolveSmsRecipients: jest.fn(),
}));
jest.mock('@/lib/services/campaign.service', () => ({
  getCampaignRecipients: jest.fn(),
}));

const mockQuery = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (enqueueJob as jest.Mock).mockReset().mockResolvedValue('job-1');
  (resolveSmsRecipients as jest.Mock).mockReset().mockResolvedValue(['254700000001', '254700000002']);
  (getCampaignRecipients as jest.Mock).mockReset().mockResolvedValue([]);
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
});

const chairCtx = { groupId: 'grp-1', userId: 'chair-1', role: 'chairperson' };
const treasurerCtx = { groupId: 'grp-1', userId: 'treasurer-1', role: 'treasurer' };
const coordCtx = { groupId: '', organizationId: 'org-1', userId: 'coord-1', role: 'organization_coordinator' };

describe('createAudience / createCampaign validation', () => {
  it('rejects a blank audience name before any query runs', async () => {
    await expect(createAudience(treasurerCtx, { name: '  ', source: 'all_members' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects org_group_officers for a group-scoped caller before any query runs', async () => {
    await expect(
      createAudience(treasurerCtx, { name: 'Officers', source: 'org_group_officers' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('allows org_group_officers for an organization-scoped caller', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'aud-1', organization_id: 'org-1', source: 'org_group_officers' }],
    });
    const result = await createAudience(coordCtx, { name: 'Officers', source: 'org_group_officers' });
    expect(result.id).toBe('aud-1');
  });

  it('rejects a campaign with a blank message', async () => {
    await expect(
      createCampaign(treasurerCtx, { title: 'Reminder', message: '  ', audience_id: 'a1' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects an email campaign with no subject', async () => {
    await expect(
      createCampaign(treasurerCtx, { title: 'Newsletter', message: 'Hi', audience_id: 'a1', channel: 'email' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects an SMS campaign from an organization-scoped (groupless) caller', async () => {
    await expect(
      createCampaign(coordCtx, { title: 'Reminder', message: 'Hi', audience_id: 'a1', channel: 'sms' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('allows an organization-scoped email campaign with a subject', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', organization_id: 'org-1', channel: 'email', subject: 'News', title: 'Newsletter' }],
    });
    const result = await createCampaign(coordCtx, {
      title: 'Newsletter',
      message: 'Hi all',
      audience_id: 'a1',
      channel: 'email',
      subject: 'News',
    });
    expect(result.id).toBe('c1');
  });
});

describe('getCampaignById', () => {
  it('returns null when the campaign does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getCampaignById(chairCtx, 'missing')).toBeNull();
  });

  it('returns an SMS campaign as-is, without querying email_campaigns', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', channel: 'sms', status: 'sending', sent_count: 3, failed_count: 0 }],
    });
    const result = await getCampaignById(chairCtx, 'c1');
    expect(result?.sent_count).toBe(3);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns a draft email campaign as-is, without querying email_campaigns', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', channel: 'email', status: 'draft' }] });
    const result = await getCampaignById(chairCtx, 'c1');
    expect(result?.status).toBe('draft');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('overlays live sent/failed counts and completed status from email_campaigns for a sending email campaign', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', channel: 'email', status: 'sending', sent_count: 0, failed_count: 0 }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ status: 'sent', sent_count: 9, failed_count: 1, total_recipients: 10 }],
    });

    const result = await getCampaignById(chairCtx, 'c1');

    expect(result?.status).toBe('completed');
    expect(result?.sent_count).toBe(9);
    expect(result?.failed_count).toBe(1);
  });

  it('leaves the campaign unchanged if no matching email_campaigns row exists', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', channel: 'email', status: 'sending', sent_count: 0, failed_count: 0 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getCampaignById(chairCtx, 'c1');

    expect(result?.status).toBe('sending');
    expect(result?.sent_count).toBe(0);
  });
});

describe('submitForReview', () => {
  it('throws NotFoundError when the campaign is not in draft status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(submitForReview(treasurerCtx, 'c1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('approveCampaign — maker-checker across group and organization scope', () => {
  it('throws NotFoundError when the campaign is not pending review', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(approveCampaign(chairCtx, 'c1')).rejects.toBeInstanceOf(NotFoundError);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects a group campaign approval by a non-chairperson', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'c1',
          status: 'pending_review',
          created_by: 'treasurer-1',
          group_id: 'grp-1',
          channel: 'sms',
          audience_id: 'a1',
          message: 'Hi',
        },
      ],
    });
    await expect(approveCampaign(treasurerCtx, 'c1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects an organization campaign approval by a non-coordinator', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'c1',
          status: 'pending_review',
          created_by: 'someone-else',
          organization_id: 'org-1',
          channel: 'email',
          audience_id: 'a1',
          message: 'Hi',
          subject: 'News',
        },
      ],
    });
    await expect(approveCampaign(chairCtx, 'c1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects the campaign creator approving their own campaign, even as chairperson', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'c1',
          status: 'pending_review',
          created_by: 'chair-1',
          group_id: 'grp-1',
          channel: 'sms',
          audience_id: 'a1',
          message: 'Hi',
        },
      ],
    });

    await expect(approveCampaign(chairCtx, 'c1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('throws ValidationError when the audience resolves to zero recipients', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'c1',
          status: 'pending_review',
          created_by: 'treasurer-1',
          group_id: 'grp-1',
          channel: 'sms',
          audience_id: 'a1',
          message: 'Hi',
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', source: 'active_members', group_id: 'grp-1' }] });
    (resolveSmsRecipients as jest.Mock).mockResolvedValueOnce([]);

    await expect(approveCampaign(chairCtx, 'c1')).rejects.toBeInstanceOf(ValidationError);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('freezes the SMS audience snapshot, marks sending, and enqueues the send job on success', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'c1',
          status: 'pending_review',
          created_by: 'treasurer-1',
          group_id: 'grp-1',
          channel: 'sms',
          audience_id: 'a1',
          message: 'Hello!',
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', source: 'active_members', group_id: 'grp-1' }] });
    // Two INSERT INTO marketing_audience_members calls (one per recipient)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', status: 'sending', recipient_count: 2, reviewed_by: 'chair-1' }],
    });

    const result = await approveCampaign(chairCtx, 'c1');

    expect(result.status).toBe('sending');
    expect(enqueueJob).toHaveBeenCalledWith(
      'marketing_campaign_sms_send',
      expect.objectContaining({
        campaignId: 'c1',
        groupId: 'grp-1',
        phones: ['254700000001', '254700000002'],
      }),
      expect.objectContaining({ dedup_key: 'marketing_campaign_send:c1' }),
    );
  });

  it('resolves crm_contacts_opted_in audiences by querying crm_contacts directly, not resolveSmsRecipients', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'c1',
          status: 'pending_review',
          created_by: 'treasurer-1',
          group_id: 'grp-1',
          channel: 'sms',
          audience_id: 'a1',
          message: 'Hi',
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', source: 'crm_contacts_opted_in', group_id: 'grp-1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'contact-1', phone: '254711111111' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // insert audience member
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', status: 'sending', recipient_count: 1 }] });

    await approveCampaign(chairCtx, 'c1');

    expect(resolveSmsRecipients).not.toHaveBeenCalled();
    const insertCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('marketing_audience_members'));
    expect(insertCall![1]).toEqual(['c1', 'a1', 'crm_contact', 'contact-1', '254711111111']);
  });

  it("resolves org_group_officers audiences across an organization's active groups", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'c1',
          status: 'pending_review',
          created_by: 'someone-else',
          organization_id: 'org-1',
          channel: 'sms',
          audience_id: 'a1',
          message: 'Hi',
          subject: null,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', source: 'org_group_officers', organization_id: 'org-1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ member_id: 'mem-1', phone: '254722222222', name: 'Officer One' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // insert audience member
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', status: 'sending', recipient_count: 1 }] });

    await approveCampaign(coordCtx, 'c1');

    expect(resolveSmsRecipients).not.toHaveBeenCalled();
    const officersQuery = mockQuery.mock.calls.find((c) => String(c[0]).includes('organization_group_access'));
    expect(officersQuery![1]).toEqual(['org-1']);
    expect(enqueueJob).toHaveBeenCalledWith(
      'marketing_campaign_sms_send',
      expect.objectContaining({ campaignId: 'c1', phones: ['254722222222'] }),
      expect.anything(),
    );
  });

  it('sends an email campaign via email_campaigns/email_campaign_recipients, without enqueuing an SMS job', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'c1',
          status: 'pending_review',
          created_by: 'treasurer-1',
          group_id: 'grp-1',
          channel: 'email',
          audience_id: 'a1',
          message: '<p>Hi</p>',
          subject: 'Newsletter',
          title: 'Sept newsletter',
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', source: 'active_members', group_id: 'grp-1' }] });
    (getCampaignRecipients as jest.Mock).mockResolvedValueOnce([
      { memberId: 'mem-1', email: 'a@example.com', name: 'Alice' },
    ]);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no suppressions
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'ec-1' }] }); // INSERT INTO email_campaigns
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT INTO email_campaign_recipients
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT INTO marketing_audience_members
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', status: 'sending', recipient_count: 1 }] });

    const result = await approveCampaign(chairCtx, 'c1');

    expect(result.status).toBe('sending');
    expect(enqueueJob).not.toHaveBeenCalled();
    const ecInsert = mockQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO email_campaigns'));
    expect(ecInsert![1]).toEqual([
      'grp-1',
      null,
      'Sept newsletter',
      'Newsletter',
      '<p>Hi</p>',
      1,
      'a1',
      'c1',
      'chair-1',
    ]);
  });

  it('filters suppressed emails out of the resolved audience before creating any recipient rows', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'c1',
          status: 'pending_review',
          created_by: 'treasurer-1',
          group_id: 'grp-1',
          channel: 'email',
          audience_id: 'a1',
          message: 'Hi',
          subject: 'News',
          title: 'News',
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', source: 'active_members', group_id: 'grp-1' }] });
    (getCampaignRecipients as jest.Mock).mockResolvedValueOnce([
      { memberId: 'mem-1', email: 'good@example.com', name: 'Good' },
      { memberId: 'mem-2', email: 'bounced@example.com', name: 'Bounced' },
    ]);
    mockQuery.mockResolvedValueOnce({ rows: [{ email: 'bounced@example.com' }] }); // email_suppressions
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'ec-1' }] }); // INSERT INTO email_campaigns
    mockQuery.mockResolvedValueOnce({ rows: [] }); // recipient insert (only 1 survives)
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audience member insert
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', status: 'sending', recipient_count: 1 }] });

    const result = await approveCampaign(chairCtx, 'c1');

    expect(result.recipient_count).toBe(1);
    const ecInsert = mockQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO email_campaigns'));
    expect(ecInsert![1][5]).toBe(1); // total_recipients reflects only the surviving recipient
    const recipientInsert = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO email_campaign_recipients'),
    );
    expect(recipientInsert![1]).toContain('good@example.com');
  });
});

describe('rejectCampaign', () => {
  it('requires a non-blank reason before any query runs', async () => {
    await expect(rejectCampaign(chairCtx, 'c1', '  ')).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the campaign is not pending review', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(rejectCampaign(chairCtx, 'c1', 'Budget too high')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a non-chairperson trying to reject a group campaign', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', status: 'pending_review', group_id: 'grp-1', channel: 'sms' }],
    });
    await expect(rejectCampaign(treasurerCtx, 'c1', 'Budget too high')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows the chairperson to reject a group campaign', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', status: 'pending_review', group_id: 'grp-1', channel: 'sms' }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', status: 'rejected', rejection_reason: 'Budget too high' }],
    });
    const result = await rejectCampaign(chairCtx, 'c1', 'Budget too high');
    expect(result.status).toBe('rejected');
  });
});

describe('completeMarketingCampaignSend', () => {
  it('writes sent/failed counts and marks the campaign completed via the admin pool', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await completeMarketingCampaignSend('c1', 10, 1);
    expect(withAdminDb).toHaveBeenCalled();
    expect(mockQuery.mock.calls[0][1]).toEqual(['c1', 10, 1]);
  });
});
