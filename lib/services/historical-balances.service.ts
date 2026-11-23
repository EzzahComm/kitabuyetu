import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { withDb, type TenantContext } from '@/lib/db';
import { ValidationError } from '@/lib/utils/errors';
import { isValidMembershipNo, normalizeAccountRef } from '@/lib/utils/membership-no';

const categories = ['savings', 'share_capital', 'loan_principal', 'loan_interest', 'member_welfare'] as const;
const commonColumns = ['group_id', 'as_of', 'currency'];
const columns = {
  balances: [...commonColumns, 'membership_no', 'category', 'amount'],
  member_close: [...commonColumns, 'membership_no', 'category', 'amount', 'source_ref'],
  controls: [...commonColumns, 'category', 'amount', 'source_ref'],
};
type FileKind = keyof typeof columns;
type Files = Record<FileKind, Buffer>;
const MAX_ROWS = 5000;

function readRows(file: Buffer, kind: FileKind): Record<string, string>[] {
  const header = columns[kind];
  try {
    const records: Record<string, string>[] = parse(new TextDecoder('utf-8', { fatal: true }).decode(file), {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      max_record_size: 1024,
      to: MAX_ROWS + 1,
      columns(received: string[]) {
        if (received.length !== header.length || !header.every((field) => received.includes(field))) {
          throw new ValidationError(`${kind} requires these CSV columns: ${header.join(', ')}.`);
        }
        return received;
      },
    });
    if (!records.length || records.length > MAX_ROWS) {
      throw new ValidationError(`${kind} must contain 1 to ${MAX_ROWS} data rows.`);
    }
    return records;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(`${kind} must be a valid UTF-8 CSV with consistent columns.`);
  }
}

function formatKES(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

type Scope = { groupId: string; asOf: string };
interface ClosingRow {
  category: string;
  membership: string;
  amount: bigint;
  record: number;
}

function closingRows(file: Buffer, kind: FileKind, scope: Scope): ClosingRow[] {
  const references = new Set<string>();
  return readRows(file, kind).map((row, index) => {
    const record = index + 2;
    const location = `${kind} row ${record}`;
    if (row.group_id !== scope.groupId || row.as_of !== scope.asOf || row.currency !== 'KES') {
      throw new ValidationError(`${location}: group, closing date or currency differs from the review scope.`);
    }
    if (!categories.some((category) => category === row.category))
      throw new ValidationError(`${location}: unknown balance category.`);
    // Match NUMERIC(15,2) in the chart of accounts. Parse the text without a float round trip.
    if (!/^(0|[1-9]\d{0,12})(\.\d{1,2})?$/.test(row.amount)) {
      throw new ValidationError(
        `${location}: expected a nonnegative KES amount with up to 13 whole digits and two decimal places.`,
      );
    }
    const [whole, fraction = ''] = row.amount.split('.');
    const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (kind !== 'balances') {
      if (
        !row.source_ref ||
        row.source_ref.length > 128 ||
        /[\r\n]/.test(row.source_ref) ||
        references.has(row.source_ref)
      ) {
        throw new ValidationError(`${location}: supply a distinct source document and line reference.`);
      }
      references.add(row.source_ref);
    }
    const membership = normalizeAccountRef(row.membership_no ?? '');
    if (kind !== 'controls' && !isValidMembershipNo(membership)) {
      throw new ValidationError(`${location}: invalid membership number.`);
    }
    return { category: row.category, amount, membership, record };
  });
}

function memberBalances(file: Buffer, kind: 'balances' | 'member_close', scope: Scope) {
  const byMemberCategory = new Map<string, ClosingRow>();
  for (const row of closingRows(file, kind, scope)) {
    const key = `${row.membership}:${row.category}`;
    if (byMemberCategory.has(key))
      throw new ValidationError(`${kind} row ${row.record}: duplicate member and category.`);
    byMemberCategory.set(key, row);
  }
  return byMemberCategory;
}

export async function checkHistoricalBalances(ctx: TenantContext, asOf: string, files: Files) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Nairobi' }).format(new Date());
  if (!z.string().date().safeParse(asOf).success || asOf >= today) {
    throw new ValidationError('Choose a completed Nairobi calendar day in YYYY-MM-DD format.');
  }
  const scope = { groupId: ctx.groupId, asOf };
  const proposed = memberBalances(files.balances, 'balances', scope);
  const independent = memberBalances(files.member_close, 'member_close', scope);
  for (const [key, row] of independent) {
    if (proposed.get(key)?.amount !== row.amount) {
      throw new ValidationError(
        `member_close row ${row.record}: member balance is missing or differs from the proposal.`,
      );
    }
  }
  const membershipRows = new Map<string, number>();
  const totals = new Map<string, bigint>(categories.map((category) => [category, 0n]));
  for (const [key, row] of proposed) {
    if (!independent.has(key))
      throw new ValidationError(`balances row ${row.record}: missing independent member balance.`);
    totals.set(row.category, totals.get(row.category)! + row.amount);
    membershipRows.set(row.membership, row.record);
  }
  const controlled = new Set<string>();
  for (const row of closingRows(files.controls, 'controls', scope)) {
    if (controlled.has(row.category))
      throw new ValidationError(`controls row ${row.record}: duplicate category control.`);
    if (totals.get(row.category) !== row.amount) {
      throw new ValidationError(`controls row ${row.record}: ${row.category} total differs from the closing control.`);
    }
    controlled.add(row.category);
  }
  for (const category of categories) {
    if (!controlled.has(category)) throw new ValidationError(`controls: missing closing control for ${category}.`);
  }

  // The membership number survives contact changes. Former members may legitimately appear in a closing schedule.
  const memberships = await withDb(ctx, async (db) => {
    const { rows } = await db.query<{ membership_no: string }>(
      'SELECT membership_no FROM group_members WHERE group_id = $1 AND membership_no = ANY($2::text[])',
      [ctx.groupId, [...membershipRows.keys()]],
    );
    return new Set(rows.map((row) => row.membership_no));
  });
  for (const [membership, row] of membershipRows) {
    if (!memberships.has(membership))
      throw new ValidationError(`balances row ${row}: membership unavailable in this group.`);
  }
  return {
    status: 'matched_for_review' as const,
    groupId: ctx.groupId,
    asOf,
    rows: proposed.size,
    members: memberships.size,
    totalsKES: Object.fromEntries([...totals].map(([category, amount]) => [category, formatKES(amount)])),
    sha256: Object.fromEntries(
      Object.entries(files).map(([kind, bytes]) => [kind, createHash('sha256').update(bytes).digest('hex')]),
    ),
  };
}
