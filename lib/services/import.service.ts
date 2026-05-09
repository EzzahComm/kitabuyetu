import { parse } from 'csv-parse/sync';
import { withTransaction, type TenantContext } from '@/lib/db';
import { ValidationError } from '@/lib/utils/errors';
import { normalizePhone, isValidKenyanPhone } from '@/lib/utils/phone';
import { ContributionCsvRowSchema, MemberCsvRowSchema } from '@/lib/validators/import.schema';
import type { ContributionCsvRow, MemberCsvRow } from '@/lib/validators/import.schema';

const MAX_ROWS = parseInt(process.env.CSV_MAX_ROWS ?? '5000', 10);

export const importService = {

  async importContributions(
    ctx: TenantContext,
    csvBuffer: Buffer,
  ): Promise<{ imported: number; errors: { row: number; message: string }[] }> {
    const rows = parseCsv(csvBuffer);
    if (rows.length > MAX_ROWS) throw new ValidationError(`CSV exceeds maximum of ${MAX_ROWS} rows`);

    const errors: { row: number; message: string }[] = [];
    const valid: (ContributionCsvRow & { member_id: string })[] = [];

    return withTransaction(ctx, async (client) => {
      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2; // 1-indexed, plus header row
        const parse  = ContributionCsvRowSchema.safeParse(rows[i]);
        if (!parse.success) {
          errors.push({ row: rowNum, message: parse.error.errors.map(e => e.message).join('; ') });
          continue;
        }
        const row = parse.data;

        if (!isValidKenyanPhone(row.member_phone)) {
          errors.push({ row: rowNum, message: `Invalid phone: ${row.member_phone}` });
          continue;
        }

        const phone = normalizePhone(row.member_phone);
        const { rows: member } = await client.query<{ id: string }>(
          `SELECT m.id FROM members m
           JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $2 AND gm.is_active = true
           WHERE m.phone = $1 LIMIT 1`,
          [phone, ctx.groupId],
        );
        if (!member[0]) {
          errors.push({ row: rowNum, message: `No active member with phone ${row.member_phone}` });
          continue;
        }
        valid.push({ ...row, member_id: member[0].id });
      }

      let imported = 0;
      for (const row of valid) {
        try {
          await client.query(
            `INSERT INTO contributions
               (group_id, member_id, amount, contribution_date, status, payment_method, mpesa_receipt_number, notes, recorded_by)
             VALUES ($1,$2,$3,$4,'completed',$5,$6,$7,$8)
             ON CONFLICT (mpesa_receipt_number) DO NOTHING`,
            [
              ctx.groupId, row.member_id, row.amount.toFixed(2),
              row.contribution_date,
              row.payment_method ?? null,
              row.mpesa_receipt ?? null,
              row.notes ?? null,
              ctx.userId,
            ],
          );
          imported++;
        } catch {
          // Duplicate or constraint violation — skip silently
        }
      }

      return { imported, errors };
    });
  },

  async importMembers(
    ctx: TenantContext,
    csvBuffer: Buffer,
  ): Promise<{ imported: number; errors: { row: number; message: string }[] }> {
    const rows = parseCsv(csvBuffer);
    if (rows.length > MAX_ROWS) throw new ValidationError(`CSV exceeds maximum of ${MAX_ROWS} rows`);

    const errors: { row: number; message: string }[] = [];
    let imported = 0;

    return withTransaction(ctx, async (client) => {
      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2;
        const parsed = MemberCsvRowSchema.safeParse(rows[i]);
        if (!parsed.success) {
          errors.push({ row: rowNum, message: parsed.error.errors.map(e => e.message).join('; ') });
          continue;
        }
        const row = parsed.data as MemberCsvRow;

        if (!isValidKenyanPhone(row.phone)) {
          errors.push({ row: rowNum, message: `Invalid phone: ${row.phone}` });
          continue;
        }

        const phone = normalizePhone(row.phone);
        try {
          const { rows: existing } = await client.query<{ id: string }>(
            'SELECT id FROM members WHERE phone = $1', [phone],
          );

          let memberId: string;
          if (existing[0]) {
            memberId = existing[0].id;
          } else {
            const bcrypt = await import('bcryptjs');
            const hash = await bcrypt.hash(Math.random().toString(36).slice(-10) + 'A1', 10);
            const { rows: newMember } = await client.query<{ id: string }>(
              `INSERT INTO members (phone, password_hash, first_name, last_name, email, national_id)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
              [phone, hash, row.first_name, row.last_name, row.email ?? null, row.national_id ?? null],
            );
            memberId = newMember[0].id;
          }

          await client.query(
            `INSERT INTO group_members (group_id, member_id, role, joined_at, invited_by)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (group_id, member_id) DO NOTHING`,
            [ctx.groupId, memberId, row.role, row.joined_at ?? new Date().toISOString().split('T')[0], ctx.userId],
          );
          imported++;
        } catch (err) {
          errors.push({ row: rowNum, message: `Failed to import: ${(err as Error).message}` });
        }
      }

      return { imported, errors };
    });
  },
};

function parseCsv(buffer: Buffer): Record<string, string>[] {
  try {
    return parse(buffer, {
      columns:          true,
      skip_empty_lines: true,
      trim:             true,
    }) as Record<string, string>[];
  } catch (err) {
    throw new ValidationError(`Invalid CSV file: ${(err as Error).message}`);
  }
}
