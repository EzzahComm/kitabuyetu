/**
 * Posting templates (ACCOUNTING_ARCHITECTURE_AUDIT.md §29.9 — called out as
 * the single highest-leverage architectural change in the audit's target
 * architecture, and #2 in §29.13's foundational ordering): which accounts a
 * business event posts to becomes Configuration Service data instead of
 * hardcoded account-code pairs inside each module's service.
 *
 * First rollout: every postSystemJournal call site (the Shares / Welfare /
 * Dividends / Subscriptions / write-off postings wired into the GL when §7
 * was closed). Each event's template is seeded platform-wide (migration 090)
 * to EXACTLY the mapping previously hardcoded, so resolution changes zero
 * posting behavior until a tenant actually remaps an account.
 *
 * Overrides may only REMAP ACCOUNTS — the line structure (each line's side
 * and amount role) is locked to the platform default's shape. That's the
 * audit's actual ask ("organizations map these templates to the specific
 * accounts in their own chart of accounts"), and it's what keeps a template
 * override from ever unbalancing an entry: balance comes from the role
 * structure (e.g. gross = net + tax), which no override can touch.
 *
 * NOT yet migrated to templates: the contribution/loan posting functions in
 * accounting.service.ts — those carry per-line member splits and repayment
 * waterfalls whose line COUNT varies per transaction, which needs the fuller
 * engine §29.9 describes. This proves the mechanism on every fixed-shape
 * event first.
 */
import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { resolvePolicy, resolvePolicyDetailed, setPolicy, type PolicySource } from './configuration.service';
import { postSystemJournal, DEFAULT_ACCOUNTS, type SystemJournalLine } from './accounting.service';
import { ValidationError } from '@/lib/utils/errors';

const DOMAIN = 'accounting';
const keyFor = (event: PostingEvent) => `posting_template.${event}`;

export type PostingEvent =
  | 'share_purchase'
  | 'share_redemption'
  | 'welfare_disbursement'
  | 'welfare_pool_contribution'
  | 'dividend_declaration'
  | 'dividend_payment'
  | 'subscription_payment'
  | 'loan_writeoff';

export interface TemplateLine {
  accountCode: string;
  side:        'debit' | 'credit';
  /** Which named amount this line posts — 'amount' for single-amount events. */
  amount:      string;
}

export interface PostingTemplate {
  lines: TemplateLine[];
}

// Kept identical to migration 090's seed — each entry is the exact mapping
// the call sites hardcoded before templates existed.
export const DEFAULT_TEMPLATES: Record<PostingEvent, PostingTemplate> = {
  share_purchase: { lines: [
    { accountCode: '1001', side: 'debit',  amount: 'amount' },
    { accountCode: '3001', side: 'credit', amount: 'amount' },
  ]},
  share_redemption: { lines: [
    { accountCode: '3001', side: 'debit',  amount: 'amount' },
    { accountCode: '1001', side: 'credit', amount: 'amount' },
  ]},
  welfare_disbursement: { lines: [
    { accountCode: '2102', side: 'debit',  amount: 'amount' },
    { accountCode: '1001', side: 'credit', amount: 'amount' },
  ]},
  welfare_pool_contribution: { lines: [
    { accountCode: '1001', side: 'debit',  amount: 'amount' },
    { accountCode: '2102', side: 'credit', amount: 'amount' },
  ]},
  // gross = net + tax is guaranteed by the dividend computation itself; a
  // zero tax simply drops the 2104 line (see buildTemplateLines).
  dividend_declaration: { lines: [
    { accountCode: '3101', side: 'debit',  amount: 'gross' },
    { accountCode: '2103', side: 'credit', amount: 'net' },
    { accountCode: '2104', side: 'credit', amount: 'tax' },
  ]},
  dividend_payment: { lines: [
    { accountCode: '2103', side: 'debit',  amount: 'net' },
    { accountCode: '1001', side: 'credit', amount: 'net' },
  ]},
  subscription_payment: { lines: [
    { accountCode: '5003', side: 'debit',  amount: 'amount' },
    { accountCode: '1001', side: 'credit', amount: 'amount' },
  ]},
  loan_writeoff: { lines: [
    { accountCode: '5004', side: 'debit',  amount: 'outstanding' },
    { accountCode: '1101', side: 'credit', amount: 'outstanding' },
  ]},
};

export const POSTING_EVENTS = Object.keys(DEFAULT_TEMPLATES) as PostingEvent[];

/**
 * Pure line builder: applies named amounts to a template. Zero-valued lines
 * are dropped (a dividend declaration with no withholding tax posts two
 * lines, not three); a role the caller didn't supply is a programming error.
 * `invert` swaps every line's side — used by reversal postings so a reversal
 * always mirrors whatever mapping the original event resolves to.
 */
export function buildTemplateLines(
  template: PostingTemplate,
  amounts:  Record<string, number>,
  opts?:    { invert?: boolean },
): SystemJournalLine[] {
  const lines: SystemJournalLine[] = [];
  for (const line of template.lines) {
    const value = amounts[line.amount];
    if (value === undefined) {
      throw new ValidationError(`Posting template references amount '${line.amount}' which was not supplied`);
    }
    if (!(value >= 0)) {
      throw new ValidationError(`Posting amount '${line.amount}' must be zero or positive`);
    }
    if (value === 0) continue;
    const side = opts?.invert
      ? (line.side === 'debit' ? 'credit' : 'debit')
      : line.side;
    lines.push({ accountCode: line.accountCode, [side]: value });
  }
  return lines;
}

/** Used inline by posting paths — resolves the group's effective template for an event. */
export async function resolvePostingTemplate(
  client: PoolClient,
  event:  PostingEvent,
  scope:  { organizationId?: string | null; groupId?: string | null },
): Promise<PostingTemplate> {
  return resolvePolicy<PostingTemplate>(client, DOMAIN, keyFor(event), scope, DEFAULT_TEMPLATES[event]);
}

/**
 * The template-driven replacement for calling postSystemJournal with
 * hardcoded lines: resolves the group's effective template for the event,
 * builds the lines from the named amounts, and posts within the caller's
 * transaction. Same missing-account tolerance as postSystemJournal (logs and
 * returns null rather than failing the business transaction).
 */
export async function postTemplatedJournal(
  client:      PoolClient,
  groupId:     string,
  userId:      string | null,
  event:       PostingEvent,
  description: string,
  amounts:     Record<string, number>,
  opts?: {
    reference?: string; memberId?: string; groupMembershipId?: string;
    entryDate?: string; isTest?: boolean; invert?: boolean;
  },
): Promise<string | null> {
  const template = await resolvePostingTemplate(client, event, { groupId });
  const lines = buildTemplateLines(template, amounts, { invert: opts?.invert });
  if (lines.length === 0) return null;
  const { invert: _invert, ...journalOpts } = opts ?? {};
  return postSystemJournal(client, groupId, userId, description, lines, journalOpts);
}

/**
 * Structure lock: an override must keep the default's exact multiset of
 * (side, amount-role) pairs — only account codes may change. This is what
 * makes overrides safe to expose to tenants: they can redirect an event to a
 * different account, never restructure the entry.
 */
function validateOverrideStructure(event: PostingEvent, lines: TemplateLine[]): void {
  const shape = (ls: TemplateLine[]) =>
    ls.map((l) => `${l.side}:${l.amount}`).sort().join('|');
  const expected = DEFAULT_TEMPLATES[event].lines;
  if (lines.length !== expected.length || shape(lines) !== shape(expected)) {
    throw new ValidationError(
      'A posting-template override may only remap accounts — the entry structure (sides and amount roles) is fixed',
    );
  }
  for (const l of lines) {
    if (!/^\d{4}$/.test(l.accountCode)) {
      throw new ValidationError(`'${l.accountCode}' is not a valid 4-digit account code`);
    }
  }
}

async function assertCodesExistInGroupCoa(client: PoolClient, groupId: string, lines: TemplateLine[]): Promise<void> {
  const codes = [...new Set(lines.map((l) => l.accountCode))];
  const { rows } = await client.query<{ account_code: string }>(
    `SELECT account_code FROM accounts WHERE group_id = $1 AND account_code = ANY($2) AND is_active = true`,
    [groupId, codes],
  );
  const found = new Set(rows.map((r) => r.account_code));
  const missing = codes.filter((c) => !found.has(c));
  if (missing.length > 0) {
    throw new ValidationError(`Account code(s) not in your chart of accounts: ${missing.join(', ')}`);
  }
}

export interface EffectiveTemplate {
  event:  PostingEvent;
  lines:  TemplateLine[];
  source: PolicySource;
}

export const postingTemplatesService = {
  /** Every event's effective template for the caller's group, with provenance. */
  async getGroupTemplates(ctx: TenantContext): Promise<EffectiveTemplate[]> {
    return withDb(ctx, async (client) => {
      const results: EffectiveTemplate[] = [];
      for (const event of POSTING_EVENTS) {
        const resolved = await resolvePolicyDetailed<PostingTemplate>(
          client, DOMAIN, keyFor(event), { groupId: ctx.groupId }, DEFAULT_TEMPLATES[event],
        );
        results.push({ event, lines: resolved.value.lines, source: resolved.source });
      }
      return results;
    });
  },

  /** Access gated at the route (withRole(req, 'treasurer', ...)) — same bar as the chart of accounts itself. */
  async setGroupOverride(ctx: TenantContext, event: PostingEvent, lines: TemplateLine[]): Promise<void> {
    validateOverrideStructure(event, lines);
    await withTransaction(ctx, async (client) => {
      await assertCodesExistInGroupCoa(client, ctx.groupId, lines);
      await setPolicy(client, DOMAIN, keyFor(event), { groupId: ctx.groupId }, { lines }, ctx.userId);
    });
  },

  /** Platform-wide defaults — super_admin only (enforced at the route via withPlatformRole). */
  async getPlatformTemplates(client: PoolClient): Promise<EffectiveTemplate[]> {
    const results: EffectiveTemplate[] = [];
    for (const event of POSTING_EVENTS) {
      const resolved = await resolvePolicyDetailed<PostingTemplate>(
        client, DOMAIN, keyFor(event), {}, DEFAULT_TEMPLATES[event],
      );
      results.push({ event, lines: resolved.value.lines, source: resolved.source });
    }
    return results;
  },

  async setPlatformDefault(userId: string, client: PoolClient, event: PostingEvent, lines: TemplateLine[]): Promise<void> {
    validateOverrideStructure(event, lines);
    // Platform templates must stick to the standard seeded chart — every
    // group is guaranteed those codes, anything else would silently skip
    // posting (postSystemJournal's missing-account tolerance) somewhere.
    const standard = new Set(DEFAULT_ACCOUNTS.map((a) => a.code));
    const offenders = lines.filter((l) => !standard.has(l.accountCode));
    if (offenders.length > 0) {
      throw new ValidationError(
        `Platform-wide templates may only use standard chart codes; not standard: ${offenders.map((l) => l.accountCode).join(', ')}`,
      );
    }
    await setPolicy(client, DOMAIN, keyFor(event), {}, { lines }, userId);
  },
};
