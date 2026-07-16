/**
 * Configuration Service / Policy Resolution Engine (ACCOUNTING_ARCHITECTURE_AUDIT.md
 * §29) — generalizes lib/sms/trigger-engine.ts's group-beats-organization-
 * beats-platform specificity resolution into one reusable resolver/writer.
 */
import { resolvePolicy, resolvePolicyDetailed, setPolicy } from '@/lib/services/configuration.service';

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery } as never;

beforeEach(() => {
  mockQuery.mockReset();
});

describe('resolvePolicyDetailed', () => {
  it('returns the fallback with source platform when no rows match', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await resolvePolicyDetailed(mockClient, 'approval', 'journal_threshold', { groupId: 'g1' }, { threshold: 0 });
    expect(result).toEqual({ value: { threshold: 0 }, source: 'platform' });
  });

  it('prefers the group-scoped row over organization and platform rows', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { organization_id: null, group_id: null, value: { threshold: 0 } },
        { organization_id: 'org-1', group_id: null, value: { threshold: 30000 } },
        { organization_id: null, group_id: 'g1', value: { threshold: 15000 } },
      ],
    });
    const result = await resolvePolicyDetailed(mockClient, 'approval', 'journal_threshold', { groupId: 'g1', organizationId: 'org-1' }, { threshold: 0 });
    expect(result).toEqual({ value: { threshold: 15000 }, source: 'group' });
  });

  it('prefers the organization-scoped row over the platform default when no group override exists', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { organization_id: null, group_id: null, value: { threshold: 0 } },
        { organization_id: 'org-1', group_id: null, value: { threshold: 30000 } },
      ],
    });
    const result = await resolvePolicyDetailed(mockClient, 'approval', 'journal_threshold', { groupId: 'g1', organizationId: 'org-1' }, { threshold: 0 });
    expect(result).toEqual({ value: { threshold: 30000 }, source: 'organization' });
  });
});

describe('resolvePolicy', () => {
  it('returns only the value, dropping provenance', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ organization_id: null, group_id: 'g1', value: { threshold: 5000 } }] });
    const value = await resolvePolicy(mockClient, 'approval', 'journal_threshold', { groupId: 'g1' }, { threshold: 0 });
    expect(value).toEqual({ threshold: 5000 });
  });
});

describe('setPolicy', () => {
  it('inserts version 1 when no active row exists at this scope yet', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });              // no existing active row
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p-1', version: 1 }] }); // INSERT

    const result = await setPolicy(mockClient, 'approval', 'journal_threshold', { groupId: 'g1' }, { threshold: 5000 }, 'user-1');

    expect(result).toEqual({ id: 'p-1', version: 1 });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[1]).toEqual(['approval', 'journal_threshold', null, 'g1', JSON.stringify({ threshold: 5000 }), 1, 'user-1']);
  });

  it('retires the current active row and inserts version+1', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p-old', version: 2 }] }); // existing active row
    mockQuery.mockResolvedValueOnce({ rows: [] });                            // UPDATE retiring it
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p-new', version: 3 }] }); // INSERT new version

    const result = await setPolicy(mockClient, 'approval', 'journal_threshold', { groupId: 'g1' }, { threshold: 8000 }, 'user-1');

    expect(result).toEqual({ id: 'p-new', version: 3 });
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const retireCall = mockQuery.mock.calls[1];
    expect(retireCall[0]).toContain('is_active = false');
    expect(retireCall[1]).toEqual(['p-old']);
    const insertCall = mockQuery.mock.calls[2];
    expect(insertCall[1][5]).toBe(3); // next version
  });
});
