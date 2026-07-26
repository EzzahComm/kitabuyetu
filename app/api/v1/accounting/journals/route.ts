export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { accountingService } from '@/lib/services/accounting.service';
import { CreateJournalSchema, VoidJournalSchema } from '@/lib/validators/accounting.schema';
import { ok, created } from '@/lib/utils/response';
import type { JournalEntry } from '@/types/api.types';
import type { PaginatedResult } from '@/types/db.types';

export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const { searchParams } = req.nextUrl;
    const page   = parseInt(searchParams.get('page')  ?? '1',  10);
    const limit  = parseInt(searchParams.get('limit') ?? '20', 10);
    const status = searchParams.get('status') ?? undefined;
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    const { withDb } = await import('@/lib/db');
    const result = await withDb(ctx, async (client) => {
      const conds  = ['je.group_id = $1'];
      const vals: unknown[] = [auth.groupId];
      let   idx = 2;
      if (status) { conds.push(`je.status = $${idx++}`); vals.push(status); }
      const where  = conds.join(' AND ');
      const offset = (page - 1) * limit;
      const { rows: countRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM journal_entries je WHERE ${where}`, vals,
      );
      const total = parseInt(countRows[0].count, 10);
      const { rows: items } = await client.query<JournalEntry>(
        `SELECT
           je.id                AS "id",
           je.entry_date::text  AS "entryDate",
           je.reference         AS "reference",
           je.memo              AS "memo",
           je.status            AS "status",
           COUNT(jl.id)::int    AS "lineCount"
         FROM journal_entries je
         LEFT JOIN journal_lines jl ON jl.journal_entry_id = je.id
         WHERE ${where}
         GROUP BY je.id
         ORDER BY je.entry_date DESC
         LIMIT $${idx} OFFSET $${idx+1}`,
        [...vals, limit, offset],
      );
      const result: PaginatedResult<JournalEntry> = { items, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
      return result;
    });
    return ok(result);
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const body  = await req.json();
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    if (body.action === 'post') {
      return ok(await accountingService.postJournalEntry(ctx, body.id));
    }
    if (body.action === 'void') {
      const input = VoidJournalSchema.parse(body);
      return ok(await accountingService.voidJournalEntry(ctx, body.id, input));
    }

    const input = CreateJournalSchema.parse(body);
    return created(await accountingService.createJournalEntry(ctx, input));
  });
}
