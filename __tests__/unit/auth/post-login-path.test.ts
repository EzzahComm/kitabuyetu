/**
 * Where a session lands after sign-in, verification or a group switch.
 *
 * Migration 140 put a second axis ahead of role: which PRODUCT. A group holding
 * only Chama Reminder is refused every financial route, so routing it to
 * /dashboard renders a page of 402s — and a group that has registered for it
 * but not paid holds no subscription at all, so nothing but signupProduct can
 * tell it apart from an unpaid Kitabu Yetu group.
 */
import { postLoginPath } from '@/lib/auth/post-login-path';

describe('postLoginPath', () => {
  describe('without entitlements (every pre-existing caller)', () => {
    it('sends a plain member to their own portal', () => {
      expect(postLoginPath('member')).toBe('/me');
    });

    it('sends officers to the dashboard', () => {
      expect(postLoginPath('chairperson')).toBe('/dashboard');
      expect(postLoginPath('treasurer')).toBe('/dashboard');
      expect(postLoginPath('secretary')).toBe('/dashboard');
      expect(postLoginPath(undefined)).toBe('/dashboard');
    });
  });

  describe('product routing', () => {
    it('sends a Chama-Reminder-only group to the reminder portal', () => {
      expect(postLoginPath('chairperson', { products: ['chama_reminder'] })).toBe('/reminder');
    });

    it('keeps a group holding BOTH products on the dashboard', () => {
      // A Kitabu Yetu customer with an add-on. The reminder portal is reachable
      // from there, and demoting a full customer to the lighter product would
      // be a downgrade, not a convenience.
      expect(postLoginPath('chairperson', {
        products: ['kitabu_yetu', 'chama_reminder'],
      })).toBe('/dashboard');
    });

    it('keeps a Kitabu-Yetu-only group on the dashboard', () => {
      expect(postLoginPath('chairperson', { products: ['kitabu_yetu'] })).toBe('/dashboard');
    });

    it('routes a member of a reminder-only group to the reminder portal, not /me', () => {
      // Product wins over role: /me is a Kitabu Yetu surface (passbook, wallet,
      // goals) that a communication-only group has no data for.
      expect(postLoginPath('member', { products: ['chama_reminder'] })).toBe('/reminder');
    });
  });

  describe('never-paid groups', () => {
    it('routes an unpaid Chama Reminder signup by signupProduct', () => {
      // The case products CANNOT answer: since migration 139 a brand-new group
      // holds no subscription at all.
      expect(postLoginPath('chairperson', {
        products: [], signupProduct: 'chama_reminder',
      })).toBe('/reminder');
    });

    it('routes an unpaid Kitabu Yetu signup to the dashboard', () => {
      expect(postLoginPath('chairperson', {
        products: [], signupProduct: 'kitabu_yetu',
      })).toBe('/dashboard');
    });

    it('ignores signupProduct once the group actually holds Kitabu Yetu', () => {
      // Signed up for Chama Reminder, then bought Kitabu Yetu. What it PAYS for
      // outranks what it once registered for — otherwise a converted customer
      // would be stuck in the lighter portal forever.
      expect(postLoginPath('chairperson', {
        products: ['kitabu_yetu'], signupProduct: 'chama_reminder',
      })).toBe('/dashboard');
    });

    it('falls back to the dashboard when nothing is known', () => {
      expect(postLoginPath('chairperson', {})).toBe('/dashboard');
      expect(postLoginPath('chairperson', { products: [] })).toBe('/dashboard');
    });
  });
});
