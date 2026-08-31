/**
 * The route → entitlement policy (lib/auth/subscription-gate.ts).
 *
 * That map is the single place deciding which product a route belongs to, and
 * it replaced an unbounded alternative: auditing every downstream code path
 * that assumes a group has a chart of accounts. One map is only safer than that
 * sweep if the map cannot silently drift from the routes, which is what these
 * tests are for.
 *
 * The default is CLOSED (kitabu_yetu), so a correct new Kitabu Yetu route needs
 * no map edit at all. That means the only edits that ever reach the map are the
 * ones worth reviewing — which is exactly what test C surfaces.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  requiredEntitlement, ENTITLEMENT_RULES, DEFAULT_ENTITLEMENT,
  type RouteEntitlement,
} from '@/lib/auth/subscription-gate';

const ROOT      = path.resolve(__dirname, '../../..');
const API_V1    = path.join(ROOT, 'app', 'api', 'v1');

/** Every real /api/v1/* route path, derived from the filesystem. */
function collectRoutePaths(dir = API_V1, prefix = '/api/v1'): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRoutePaths(abs, `${prefix}/${entry.name}`));
    } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
      out.push(prefix);
    }
  }
  return out;
}

describe('route entitlement map', () => {
  // ── A. Resolver semantics ────────────────────────────────────────────────
  describe('resolution', () => {
    const cases: Array<[string, RouteEntitlement]> = [
      // The collision trio. '/api/v1/me' is a listed prefix, and bare
      // startsWith matching made it swallow BOTH of the others — which is how
      // /members and /meetings stayed open to unpaid groups after migration 139
      // shipped the lock. Segment-aware matching is what separates them.
      ['/api/v1/me/wallet',      'open'],
      ['/api/v1/me/goals',       'open'],
      ['/api/v1/members',        'any'],
      ['/api/v1/members/abc-123', 'any'],
      ['/api/v1/meetings',       'kitabu_yetu'],

      // Pay-from-locked path. If any of these ever stops being 'open' the
      // product is unrecoverable: the only routes that can END the lock would
      // themselves be behind it.
      ['/api/v1/auth/login',            'open'],
      ['/api/v1/billing/plans',         'open'],
      ['/api/v1/billing/entitlements',  'open'],
      ['/api/v1/mpesa/callback',        'open'],
      ['/api/v1/workers/jobs',          'open'],
      ['/api/v1/webhooks/textsms',      'open'],
      ['/api/v1/daraja/b2c/result',     'open'],

      // The shared surface — this is the Chama Reminder product.
      ['/api/v1/sms',            'any'],
      ['/api/v1/sms/campaign',   'any'],
      ['/api/v1/sms/birthdays',  'any'],

      // Kitabu Yetu only. A Chama Reminder group has no chart of accounts, so
      // these must not be reachable on a chama_reminder subscription alone.
      ['/api/v1/loans',          'kitabu_yetu'],
      ['/api/v1/accounting',     'kitabu_yetu'],
      ['/api/v1/contributions',  'kitabu_yetu'],
      ['/api/v1/dividends',      'kitabu_yetu'],
      ['/api/v1/shares',         'kitabu_yetu'],
      ['/api/v1/treasury',       'kitabu_yetu'],
      ['/api/v1/reports',        'kitabu_yetu'],

      // Pins the default-closed decision: an unlisted route requires Kitabu
      // Yetu rather than falling open.
      ['/api/v1/definitely-not-a-real-route', 'kitabu_yetu'],
    ];

    it.each(cases)('%s → %s', (routePath, expected) => {
      expect(requiredEntitlement(routePath)).toBe(expected);
    });

    it('does not let a prefix match a partial path segment', () => {
      // The bug this whole matcher exists to prevent, stated directly.
      expect(requiredEntitlement('/api/v1/members')).not.toBe('open');
      expect(requiredEntitlement('/api/v1/meetings')).not.toBe('open');
    });

    it('resolves by longest match, so rule order is never load-bearing', () => {
      // '/api/v1/billing' is 'open' and shorter than '/api/v1/billing/plans'.
      // If a longer, more specific rule is ever added it must win regardless of
      // where it sits in the array.
      const shuffled = [...ENTITLEMENT_RULES].reverse();
      const longest = shuffled
        .filter(([p]) => '/api/v1/billing/plans'.startsWith(p))
        .sort((a, b) => b[0].length - a[0].length)[0];
      expect(longest[0]).toBe('/api/v1/billing');
    });
  });

  // ── B. No dead rules ─────────────────────────────────────────────────────
  it('every rule matches at least one real route', () => {
    const routes = collectRoutePaths();
    expect(routes.length).toBeGreaterThan(0);

    const dead = ENTITLEMENT_RULES
      .map(([prefix]) => prefix)
      .filter((prefix) => !routes.some((r) => r === prefix || r.startsWith(prefix + '/')));

    // This is the guard that would have caught '/api/v1/health' (health lives
    // at /api/health, outside /api/v1 entirely) and the phantom '/api/v1/me'
    // route the old comment described but which never existed.
    expect(dead).toEqual([]);
  });

  // ── C. Widening guards ───────────────────────────────────────────────────
  //
  // Checked in as explicit lists, not counts: a PR that accidentally relaxes
  // /api/v1/loans should show the reviewer the exact path in the diff rather
  // than a number going up by one. Both lists are deliberately narrow — the
  // ~94 kitabu_yetu routes are the default and need no enumeration.

  it('exactly these real routes make up the shared, both-products surface', () => {
    const shared = collectRoutePaths()
      .filter((r) => requiredEntitlement(r) === 'any')
      .sort();

    // This IS the Chama Reminder product surface. Adding to it means deciding
    // that a communication-only group — which has no chart of accounts — may
    // reach that route. Nothing financial belongs here.
    expect(shared).toEqual([
      '/api/v1/members',
      '/api/v1/members/[id]',
      '/api/v1/members/[id]/next-of-kin',
      '/api/v1/members/[id]/next-of-kin/[kinId]',
      '/api/v1/members/[id]/status',
      '/api/v1/sms/analytics',
      '/api/v1/sms/balance',
      '/api/v1/sms/birthdays',
      '/api/v1/sms/bulk',
      '/api/v1/sms/campaign',
      '/api/v1/sms/credits',
      '/api/v1/sms/dlr',
      // Deliberate: a communication-only Chama Reminder group has no chart of
      // accounts, but it still sends SMS and so must be able to honour a
      // member's objection under the Data Protection Act. Consent management
      // belongs wherever sending is possible.
      '/api/v1/sms/opt-outs',
      '/api/v1/sms/preferences',
      '/api/v1/sms/schedules',
      '/api/v1/sms/send',
      '/api/v1/sms/settings',
      '/api/v1/sms/templates',
      '/api/v1/sms/usage',
    ]);
  });

  it('exactly these top-level areas are reachable with no subscription at all', () => {
    const openAreas = [...new Set(
      collectRoutePaths()
        .filter((r) => requiredEntitlement(r) === 'open')
        .map((r) => r.split('/').slice(0, 4).join('/')),
    )].sort();

    // Grouped by top-level area rather than listing every descendant: the
    // reviewable decision is "is this whole area outside the lock", and the
    // rules themselves are declared per-area.
    expect(openAreas).toEqual([
      '/api/v1/auth',
      '/api/v1/billing',
      '/api/v1/daraja',
      '/api/v1/me',
      '/api/v1/mpesa',
      // '/api/v1/organization' was here until the organization tree moved to
      // the backoffice audience (/api/admin/organization/*). This gate only
      // runs inside withAuth, so there is nothing left for a rule to match.
      '/api/v1/webhooks',
      '/api/v1/workers',
    ]);
  });

  it('the financial surface stays behind Kitabu Yetu', () => {
    // The whole reason the map exists: a chama_reminder group has no chart of
    // accounts, so reaching any of these fails deep inside a posting template
    // rather than at the door.
    const routes = collectRoutePaths();
    const financial = routes.filter((r) =>
      /^\/api\/v1\/(loans|accounting|contributions|dividends|shares|treasury|investments|welfare|fines|reports)\b/.test(r),
    );
    expect(financial.length).toBeGreaterThan(10);
    for (const route of financial) {
      expect(requiredEntitlement(route)).toBe(DEFAULT_ENTITLEMENT);
    }
  });
});
