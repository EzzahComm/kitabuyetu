/**
 * Marketing campaign service (Phase 9.2) — audience resolution, the
 * mandatory approval workflow (maker-checker: approver != creator,
 * chairperson-only), and the frozen-snapshot + job-enqueue side effects of
 * approveCampaign.
 */
import { withDb, withAdminDb } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { resolveSmsRecipients } from '@/lib/services/sms.service';
import {
  createAudience, createCampaign, submitForReview, approveCampaign,
  rejectCampaign, completeMarketingCampaignSend,
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

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (enqueueJob as jest.Mock).mockReset().mockResolvedValue('job-1');
  (resolveSmsRecipients as jest.Mock).mockReset().mockResolvedValue(['254700000001', '254700000002']);
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
});

const chairCtx     = { groupId: 'grp-1', userId: 'chair-1', role: 'chairperson' };
const treasurerCtx = { groupId: 'grp-1', userId: 'treasurer-1', role: 'treasurer' };

describe('createAudience / createCampaign validation', () => {
  it('rejects a blank audience name before any query runs', async () => {
    await expect(createAudience(treasurerCtx, { name: '  ', source: 'all_members' }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a campaign with a blank message', async () => {
    await expect(createCampaign(treasurerCtx, { title: 'Reminder', message: '  ', audience_id: 'a1' }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('submitForReview', () => {
  it('throws NotFoundError when the campaign is not in draft status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(submitForReview(treasurerCtx, 'c1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('approveCampaign — maker-checker', () => {
  it('rejects a non-chairperson before any query runs', async () => {
    await expect(approveCampaign(treasurerCtx, 'c1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects the campaign creator approving their own campaign, even as chairperson', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', status: 'pending_review', created_by: 'chair-1', group_id: 'grp-1', audience_id: 'a1', message: 'Hi' }],
    });

    await expect(approveCampaign(chairCtx, 'c1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the campaign is not pending review', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(approveCampaign(chairCtx, 'c1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError when the audience resolves to zero recipients', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', status: 'pending_review', created_by: 'treasurer-1', group_id: 'grp-1', audience_id: 'a1', message: 'Hi' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', source: 'active_members', group_id: 'grp-1' }] });
    (resolveSmsRecipients as jest.Mock).mockResolvedValueOnce([]);

    await expect(approveCampaign(chairCtx, 'c1')).rejects.toBeInstanceOf(ValidationError);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('freezes the audience snapshot, marks sending, and enqueues the send job on success', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', status: 'pending_review', created_by: 'treasurer-1', group_id: 'grp-1', audience_id: 'a1', message: 'Hello!' }],
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
      rows: [{ id: 'c1', status: 'pending_review', created_by: 'treasurer-1', group_id: 'grp-1', audience_id: 'a1', message: 'Hi' }],
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
});

describe('rejectCampaign', () => {
  it('rejects a non-chairperson', async () => {
    await expect(rejectCampaign(treasurerCtx, 'c1', 'Budget too high')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('requires a non-blank reason', async () => {
    await expect(rejectCampaign(chairCtx, 'c1', '  ')).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
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
