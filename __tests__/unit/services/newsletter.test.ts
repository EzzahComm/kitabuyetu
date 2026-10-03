/**
 * Newsletter service (Phase 10) — platform-level, not tenant. Covers the
 * subscribe/resubscribe upsert, idempotent unsubscribe-by-token, and the
 * admin list/stats queries.
 */
import { withAdminDb } from '@/lib/db';
import {
  subscribeToNewsletter,
  unsubscribeFromNewsletter,
  listNewsletterSubscribers,
  getNewsletterStats,
} from '@/lib/services/newsletter.service';
import { NotFoundError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withAdminDb: jest.fn(),
}));

const mockQuery = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
});

describe('subscribeToNewsletter', () => {
  it('upserts on lower(email) with an ON CONFLICT clause that clears unsubscribed_at', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', email: 'a@x.com', unsubscribed_at: null }] });

    const result = await subscribeToNewsletter({ email: 'A@X.com', name: 'Alice' });

    expect(result.id).toBe('s1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('ON CONFLICT (lower(email))');
    expect(String(sql)).toContain('unsubscribed_at = NULL');
    expect(params).toEqual(['A@X.com', 'Alice', 'website']);
  });

  it('defaults source to "website" when not given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1' }] });
    await subscribeToNewsletter({ email: 'a@x.com' });
    expect(mockQuery.mock.calls[0][1]).toEqual(['a@x.com', null, 'website']);
  });
});

describe('unsubscribeFromNewsletter', () => {
  it('throws NotFoundError for an unknown token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(unsubscribeFromNewsletter('bad-token')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('is idempotent — preserves the original unsubscribed_at on a repeat call', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', unsubscribed_at: '2026-09-01T00:00:00Z' }] });
    const result = await unsubscribeFromNewsletter('tok-1');
    expect(result.id).toBe('s1');
    const [sql] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('COALESCE(unsubscribed_at, NOW())');
  });
});

describe('listNewsletterSubscribers', () => {
  it('filters to active-only when requested', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listNewsletterSubscribers({ activeOnly: true });
    expect(String(mockQuery.mock.calls[0][0])).toContain('WHERE unsubscribed_at IS NULL');
  });

  it('returns everyone when no filter is given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1' }, { id: 's2' }] });
    const result = await listNewsletterSubscribers();
    expect(result).toHaveLength(2);
    expect(String(mockQuery.mock.calls[0][0])).not.toContain('WHERE');
  });
});

describe('getNewsletterStats', () => {
  it('derives unsubscribed as total minus active', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '10', active: '7' }] });
    const stats = await getNewsletterStats();
    expect(stats).toEqual({ total: 10, active: 7, unsubscribed: 3 });
  });
});
