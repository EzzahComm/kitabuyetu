/**
 * CRM service (Phase 9.1) — consent-first contact creation, opt-in/opt-out
 * audit trail, and the email-suppression check Phase 9.3's send path will
 * rely on.
 */
import type { PoolClient } from 'pg';
import { withDb } from '@/lib/db';
import {
  createContact,
  recordOptIn,
  recordOptOut,
  createOpportunity,
  updateOpportunity,
  listOpportunities,
  listActivitiesForContact,
  listRecentActivity,
  logActivityForContact,
  isEmailSuppressed,
} from '@/lib/services/crm.service';
import { ValidationError, NotFoundError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
}));

const mockQuery = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'member-1', role: 'treasurer' };

describe('createContact', () => {
  it('rejects a blank name before any query runs', async () => {
    await expect(createContact(ctx, { contact_type: 'donor', name: '   ' })).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('creates with marketing_opt_in=false and no opted_in_at when not explicitly opted in', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', marketing_opt_in: false }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1' }] }); // activity log insert

    await createContact(ctx, { contact_type: 'lead', name: 'Jane Donor' });

    const insertCall = mockQuery.mock.calls[0];
    // params: [group_id, org_id, contact_type, name, email, phone, notes, donor_id, partner_id, optIn, optedInAt, optedInBy, created_by]
    expect(insertCall[1][9]).toBe(false); // marketing_opt_in
    expect(insertCall[1][10]).toBeNull(); // opted_in_at
    expect(insertCall[1][11]).toBeNull(); // opted_in_by
  });

  it('stamps opted_in_at/opted_in_by to the acting user when marketing_opt_in is explicitly true', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', marketing_opt_in: true }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });

    await createContact(ctx, { contact_type: 'donor', name: 'Jane Donor', marketing_opt_in: true });

    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[1][9]).toBe(true);
    expect(insertCall[1][10]).toBeInstanceOf(Date);
    expect(insertCall[1][11]).toBe('member-1');
  });

  it('scopes to the group when ctx.groupId is set, leaving organization_id null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });

    await createContact(ctx, { contact_type: 'lead', name: 'Jane' });

    const [groupId, orgId] = mockQuery.mock.calls[0][1];
    expect(groupId).toBe('grp-1');
    expect(orgId).toBeNull();
  });
});

describe('recordOptIn / recordOptOut', () => {
  it('recordOptIn stamps opted_in_by to the acting user and logs an activity', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', marketing_opt_in: true }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });

    const result = await recordOptIn(ctx, 'c1');

    expect(result.id).toBe('c1');
    const updateCall = mockQuery.mock.calls[0];
    expect(updateCall[1]).toEqual(['c1', 'member-1']);
    // The activity log insert happened too.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('recordOptIn throws NotFoundError when the contact does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(recordOptIn(ctx, 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('recordOptOut clears the flag without requiring opted_in_at to be cleared explicitly', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', marketing_opt_in: false }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });

    const result = await recordOptOut(ctx, 'c1');
    expect(result.marketing_opt_in).toBe(false);
  });
});

describe('createOpportunity', () => {
  it('rejects a blank title before any query runs', async () => {
    await expect(createOpportunity(ctx, { contact_id: 'c1', title: '' })).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('defaults stage to draft', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', stage: 'draft' }] });

    await createOpportunity(ctx, { contact_id: 'c1', title: 'Grant application' });

    expect(mockQuery.mock.calls[0][1][2]).toBe('draft');
  });
});

describe('updateOpportunity — Phase 9.5 pipeline moves', () => {
  it('rejects an update with no fields before any query runs', async () => {
    await expect(updateOpportunity(ctx, 'o1', {})).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a blank title before any query runs', async () => {
    await expect(updateOpportunity(ctx, 'o1', { title: '   ' })).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the opportunity does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(updateOpportunity(ctx, 'missing', { stage: 'won' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('logs a stage-change activity when stage is part of the update', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', stage: 'won' }] }); // UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1' }] }); // activity log insert

    const result = await updateOpportunity(ctx, 'o1', { stage: 'won' });

    expect(result.stage).toBe('won');
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const activityCall = mockQuery.mock.calls[1];
    expect(String(activityCall[0])).toContain('INSERT INTO crm_activities');
    expect(activityCall[1]).toEqual([undefined, 'o1', 'note', 'Stage changed to won', 'member-1']);
  });

  it('does not log an activity when only title/amount/notes change (no stage in the update)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', title: 'Renamed' }] });

    await updateOpportunity(ctx, 'o1', { title: 'Renamed' });

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('listOpportunities — pipeline board data source', () => {
  it('joins contact name/type and orders by stage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', stage: 'draft', contact_name: 'Jane' }] });
    const result = await listOpportunities(ctx);
    expect(result).toHaveLength(1);
    expect(String(mockQuery.mock.calls[0][0])).toContain('JOIN crm_contacts');
  });

  it('filters by stage when given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listOpportunities(ctx, { stage: 'won' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('AND o.stage = $1');
    expect(params).toEqual(['won']);
  });
});

describe('listActivitiesForContact — includes opportunity-only activities', () => {
  it('queries by contact_id OR an opportunity owned by that contact', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listActivitiesForContact(ctx, 'c1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('opportunity_id IN (SELECT id FROM crm_opportunities WHERE contact_id = $1)');
    expect(params).toEqual(['c1']);
  });
});

describe('listRecentActivity — cross-CRM feed', () => {
  it('caps an out-of-range limit and falls back to 30 for a non-numeric one', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listRecentActivity(ctx, NaN);
    expect(mockQuery.mock.calls[0][1]).toEqual([30]);

    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listRecentActivity(ctx, 500);
    expect(mockQuery.mock.calls[1][1]).toEqual([100]);
  });

  it("resolves contact_name from either the direct contact or the opportunity's contact", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'a1', contact_name: 'Jane', opportunity_title: null }],
    });
    const result = await listRecentActivity(ctx);
    expect(result[0].contact_name).toBe('Jane');
    expect(String(mockQuery.mock.calls[0][0])).toContain('COALESCE(c.name, oc.name)');
  });
});

describe('logActivityForContact', () => {
  it('rejects an activity with neither contact_id nor opportunity_id', async () => {
    await expect(logActivityForContact(ctx, { activity_type: 'note', body: 'x' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('accepts an activity scoped to an opportunity alone', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
    await logActivityForContact(ctx, { opportunity_id: 'o1', activity_type: 'call', body: 'Follow-up call' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('isEmailSuppressed', () => {
  it('returns true when a matching suppression row exists for the scope', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
    const suppressed = await isEmailSuppressed(mockClient as unknown as PoolClient, 'bounced@example.com', {
      groupId: 'grp-1',
    });
    expect(suppressed).toBe(true);
  });

  it('returns false when no suppression row exists', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const suppressed = await isEmailSuppressed(mockClient as unknown as PoolClient, 'ok@example.com', {
      groupId: 'grp-1',
    });
    expect(suppressed).toBe(false);
  });
});
