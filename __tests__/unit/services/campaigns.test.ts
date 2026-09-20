/**
 * Changi$ha campaigns (migration 182) — creation, review lifecycle, and the
 * admin approval gate that makes this the one surface a member of the public
 * can eventually push money into.
 */
import { withDb, withTransaction, withAdminDb } from '@/lib/db';
import { campaignsService } from '@/lib/services/campaigns.service';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
  withAdminDb: jest.fn(),
}));

const mockQuery = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'treasurer-1', role: 'treasurer' };

describe('campaignsService.createCampaign', () => {
  const input = {
    title: 'Water for Kianjege',
    story: 'Our borehole broke and the village needs a new one urgently.',
    targetAmount: 50000,
  };

  it('rejects a member (not an officer)', async () => {
    await expect(campaignsService.createCampaign({ ...ctx, role: 'member' }, input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a non-positive target amount', async () => {
    await expect(campaignsService.createCampaign(ctx, { ...input, targetAmount: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('creates a draft campaign with a unique slug', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // slug uniqueness check — free
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'camp-1', title: input.title, slug: 'water-for-kianjege', status: 'draft' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit log

    const campaign = await campaignsService.createCampaign(ctx, input);

    expect(campaign.status).toBe('draft');
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[1]).toContain('water-for-kianjege');
  });

  it('appends a numeric suffix when the slug is already taken', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ x: 1 }] }); // 'water-for-kianjege' taken
    mockQuery.mockResolvedValueOnce({ rows: [] }); // 'water-for-kianjege-2' free
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'camp-2', title: input.title, slug: 'water-for-kianjege-2', status: 'draft' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit log

    const campaign = await campaignsService.createCampaign(ctx, input);

    expect(campaign.slug).toBe('water-for-kianjege-2');
  });
});

describe('campaignsService.submitForReview', () => {
  it('rejects when the campaign is not a draft', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'camp-1', status: 'active' }] });
    await expect(campaignsService.submitForReview(ctx, 'camp-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('moves a draft to pending_review', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'camp-1', status: 'draft' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'camp-1', status: 'pending_review' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit log

    const campaign = await campaignsService.submitForReview(ctx, 'camp-1');
    expect(campaign.status).toBe('pending_review');
  });

  it("throws NotFoundError for a campaign outside the caller's group", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(campaignsService.submitForReview(ctx, 'camp-x')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('campaignsService admin review', () => {
  it('approveCampaign moves pending_review to active', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'camp-1', group_id: 'grp-1', status: 'pending_review' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'camp-1', status: 'active' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit log

    const campaign = await campaignsService.approveCampaign('admin-1', 'camp-1');
    expect(campaign.status).toBe('active');
  });

  it('rejectCampaign requires a non-empty reason', async () => {
    await expect(campaignsService.rejectCampaign('admin-1', 'camp-1', '  ')).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejectCampaign moves pending_review to rejected with a reason', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'camp-1', group_id: 'grp-1', status: 'pending_review' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'camp-1', status: 'rejected', rejection_reason: 'Incomplete story' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit log

    const campaign = await campaignsService.rejectCampaign('admin-1', 'camp-1', 'Incomplete story');
    expect(campaign.status).toBe('rejected');
  });

  it('throws NotFoundError when approving a campaign that is not pending_review', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(campaignsService.approveCampaign('admin-1', 'camp-1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('campaignsService public reads', () => {
  it('getPublicCampaignBySlug only returns active campaigns (enforced in the query, not just by caller intent)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'camp-1', slug: 'water-for-kianjege', status: 'active' }] });
    const campaign = await campaignsService.getPublicCampaignBySlug('water-for-kianjege');
    expect(campaign?.status).toBe('active');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'active'");
  });

  it('getPublicCampaignBySlug returns null for an unknown or non-active slug', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const campaign = await campaignsService.getPublicCampaignBySlug('nonexistent');
    expect(campaign).toBeNull();
  });
});
