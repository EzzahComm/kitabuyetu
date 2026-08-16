import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/utils/errors';
import { isValidKenyanPhone, normalizePhone } from '@/lib/utils/phone';
import {
  ContributionCsvRowSchema,
  LoanCsvRowSchema,
  MEMBER_CSV_COLUMNS,
  MemberCsvRowSchema,
  resolveCsvHeader,
  resolveHeaderFor,
  type MemberCsvColumn,
  type ContributionCsvRow,
  type ImportKind,
} from '@/lib/validators/import.schema';
import type { PoolClient } from 'pg';
import { linkMemberToGroup } from './group-membership';

const MAX_ROWS    = parseInt(process.env.CSV_MAX_ROWS    ?? '5000', 10);
const BCRYPT_RND  = parseInt(process.env.BCRYPT_ROUNDS   ?? '10',   10);

// Shape of a single per-row error/warning recorded against an import job.
export interface ImportRowError {
  row:     number;
  message: string;
  raw?:    Record<string, string>;
}

// Validated + normalised contribution row held in import_jobs.preview_rows
// between preview and commit. The member_id is resolved from member_phone.
interface PreparedContributionRow {
  row_num:           number;
  member_id:         string;
  member_phone:      string;        // already E.164
  amount:            number;
  contribution_date: string;        // YYYY-MM-DD
  payment_method:    string | null;
  mpesa_receipt:     string | null;
  notes:             string | null;
  warnings:          string[];
}

// Same shape for loans. status uses the LOAN_HISTORICAL_STATUSES set
// (active/completed/defaulted/written_off), not the full loan_status enum.
interface PreparedLoanRow {
  row_num:           number;
  member_id:         string;
  principal_amount:  number;
  interest_rate:     number;        // percent annual
  term_months:       number;
  disbursement_date: string;        // YYYY-MM-DD
  status:            'active' | 'completed' | 'defaulted' | 'written_off';
  purpose:           string | null;
  notes:             string | null;
  warnings:          string[];
}

// Validated + normalised row held in import_jobs.preview_rows between
// preview and commit. The county_id is already resolved from county_name.
interface PreparedMemberRow {
  row_num:           number;
  phone:             string;          // already E.164
  first_name:        string;
  middle_name:       string | null;
  last_name:         string;
  email:             string | null;
  national_id:       string | null;
  date_of_birth:     string | null;   // YYYY-MM-DD
  gender:            string | null;
  address:           string | null;
  alternative_phone: string | null;   // already E.164 or null
  county_id:         string | null;
  occupation:        string | null;
  role:              'chairperson' | 'treasurer' | 'secretary' | 'member';
  joined_at:         string | null;   // YYYY-MM-DD
  warnings:          string[];
}

export interface ImportJob {
  id:                 string;
  group_id:           string;
  kind:               string;
  status:             string;
  filename:           string | null;
  total_rows:         number;
  valid_rows:         number;
  error_rows:         number;
  errors:             ImportRowError[];
  created_member_ids: string[];
  rollback_reason:    string | null;
  failure_reason:     string | null;
  created_by:         string;
  created_at:         string;
  committed_at:       string | null;
  rolled_back_at:     string | null;
  cancelled_at:       string | null;
}

export const importService = {

  // ── Two-phase member import ────────────────────────────────────────────

  /**
   * Phase 1: parse the CSV, validate every row, resolve county names, and
   * persist the validated rows + per-row errors as a 'previewed' import_job.
   * Returns the job so the UI can render a preview table before the user
   * confirms the commit.
   */
  async previewMembers(
    ctx: TenantContext,
    csvBuffer: Buffer,
    filename: string | null,
  ): Promise<ImportJob & { preview_rows: PreparedMemberRow[] }> {
    const rawRows = parseCsv(csvBuffer);
    if (rawRows.length === 0)        throw new ValidationError('CSV contains no data rows');
    if (rawRows.length > MAX_ROWS)   throw new ValidationError(`CSV exceeds maximum of ${MAX_ROWS} rows`);

    return withTransaction(ctx, async (client) => {
      // Build header alias map once from the first row's keys. The CSV parser
      // returns the raw header strings as object keys; we normalise them to
      // canonical column names so the row validator below sees consistent shape.
      const headerMap = buildHeaderMap(Object.keys(rawRows[0]));
      const unknownHeaders = Object.keys(rawRows[0]).filter(
        (h) => headerMap[h] === undefined,
      );

      // Counties cached once per import to avoid N queries.
      const counties = await loadCounties(client);

      const errors:        ImportRowError[]    = [];
      const preparedRows:  PreparedMemberRow[] = [];
      const seenPhonesInFile = new Set<string>();

      for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2; // header + 1-indexed
        const raw    = rawRows[i];

        // Re-key the row using canonical column names so the validator sees
        // a shape independent of header casing/punctuation.
        const canon: Record<string, string> = {};
        for (const [origKey, value] of Object.entries(raw)) {
          const canonKey = headerMap[origKey];
          if (canonKey) canon[canonKey] = value;
        }

        const parsed = MemberCsvRowSchema.safeParse(canon);
        if (!parsed.success) {
          errors.push({
            row:     rowNum,
            message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
            raw,
          });
          continue;
        }
        const data = parsed.data;

        if (!isValidKenyanPhone(data.phone)) {
          errors.push({ row: rowNum, message: `Invalid Kenyan phone: ${data.phone}`, raw });
          continue;
        }
        const phone = normalizePhone(data.phone);

        if (data.alternative_phone && !isValidKenyanPhone(data.alternative_phone)) {
          errors.push({ row: rowNum, message: `Invalid alternative phone: ${data.alternative_phone}`, raw });
          continue;
        }
        const altPhone = data.alternative_phone ? normalizePhone(data.alternative_phone) : null;

        if (seenPhonesInFile.has(phone)) {
          errors.push({ row: rowNum, message: `Duplicate phone in file: ${phone}`, raw });
          continue;
        }
        seenPhonesInFile.add(phone);

        // Phone already in this group → reject; the commit step would also
        // fail the row, but flagging at preview lets the user clean their
        // file before confirming.
        const { rows: alreadyInGroup } = await client.query<{ id: string }>(
          `SELECT gm.id
             FROM group_members gm
             JOIN members m ON m.id = gm.member_id
            WHERE gm.group_id = $1 AND m.phone = $2`,
          [ctx.groupId, phone],
        );
        if (alreadyInGroup[0]) {
          errors.push({
            row:     rowNum,
            message: `Member with phone ${phone} is already in this group`,
            raw,
          });
          continue;
        }

        const warnings: string[] = [];
        let countyId: string | null = null;
        if (data.county_name) {
          const found = counties.get(data.county_name.toLowerCase());
          if (found) {
            countyId = found;
          } else {
            warnings.push(`County '${data.county_name}' not recognised — member will be created without a county`);
          }
        }

        preparedRows.push({
          row_num:           rowNum,
          phone,
          first_name:        data.first_name,
          middle_name:       data.middle_name ?? null,
          last_name:         data.last_name,
          email:             data.email ?? null,
          national_id:       data.national_id ?? null,
          date_of_birth:     data.date_of_birth ?? null,
          gender:            data.gender ?? null,
          address:           data.address ?? null,
          alternative_phone: altPhone,
          county_id:         countyId,
          occupation:        data.occupation ?? null,
          role:              data.role,
          joined_at:         data.joined_at ?? null,
          warnings,
        });
      }

      // Surface unknown headers as a job-level warning at the front of errors[]
      // so the UI shows them prominently.
      if (unknownHeaders.length > 0) {
        errors.unshift({
          row:     0,
          message: `Unrecognised columns ignored: ${unknownHeaders.join(', ')}`,
        });
      }

      const { rows } = await client.query<ImportJob>(
        `INSERT INTO import_jobs
           (group_id, created_by, kind, status, filename,
            total_rows, valid_rows, error_rows,
            errors, preview_rows)
         VALUES ($1, $2, 'members', 'previewed', $3,
                 $4, $5, $6,
                 $7::jsonb, $8::jsonb)
         RETURNING *`,
        [
          ctx.groupId, ctx.userId, filename,
          rawRows.length, preparedRows.length, errors.filter((e) => e.row > 0).length,
          JSON.stringify(errors),
          JSON.stringify(preparedRows),
        ],
      );

      await writeAuditLog(client, ctx, 'member_import.preview', rows[0].id, {
        filename,
        total_rows: rawRows.length,
        valid_rows: preparedRows.length,
        error_rows: errors.filter((e) => e.row > 0).length,
      });

      return { ...rows[0], preview_rows: preparedRows };
    });
  },

  /**
   * Phase 2: apply a previewed job. Iterates the stored preview_rows,
   * INSERTing members + group_memberships and recording the created member
   * IDs on the job so a later rollback can target them precisely.
   *
   * Per-row constraint failures are caught and recorded as errors — one bad
   * row never aborts the batch.
   */
  async commitMembers(
    ctx: TenantContext,
    jobId: string,
  ): Promise<ImportJob & { imported: number; skipped: number }> {
    return withTransaction(ctx, async (client) => {
      // SELECT FOR UPDATE so two clients can't commit the same job concurrently.
      const { rows: jobRows } = await client.query<ImportJob & { preview_rows: PreparedMemberRow[] }>(
        `SELECT * FROM import_jobs
          WHERE id = $1 AND group_id = $2
          FOR UPDATE`,
        [jobId, ctx.groupId],
      );
      const job = jobRows[0];
      if (!job)                            throw new NotFoundError('Import job', jobId);
      if (job.kind   !== 'members')        throw new ValidationError(`Job ${jobId} is not a members import`);
      if (job.status !== 'previewed')      throw new ConflictError(`Job ${jobId} is in status '${job.status}' — only 'previewed' jobs can be committed`);

      const rowsToInsert = job.preview_rows as PreparedMemberRow[];
      const createdIds:   string[]          = [];
      const errors:       ImportRowError[]  = [...(job.errors ?? [])];
      let   imported = 0;
      let   skipped  = 0;

      for (const row of rowsToInsert) {
        try {
          // Re-check duplicate-in-group: state may have changed between
          // preview and commit (someone added the member manually).
          const { rows: dupe } = await client.query<{ id: string }>(
            `SELECT gm.id
               FROM group_members gm
               JOIN members m ON m.id = gm.member_id
              WHERE gm.group_id = $1 AND m.phone = $2`,
            [ctx.groupId, row.phone],
          );
          if (dupe[0]) {
            errors.push({ row: row.row_num, message: `Skipped: member with phone ${row.phone} is already in this group` });
            skipped++;
            continue;
          }

          // Reuse an existing platform-level member if their phone is known
          // (e.g. they're already in another group); otherwise create a new
          // member with a random password they reset on first login.
          const { rows: existing } = await client.query<{ id: string }>(
            `SELECT id FROM members WHERE phone = $1`,
            [row.phone],
          );

          let memberId: string;
          if (existing[0]) {
            memberId = existing[0].id;
            await client.query(
              `UPDATE members SET
                 middle_name       = COALESCE(middle_name,       $2),
                 alternative_phone = COALESCE(alternative_phone, $3),
                 county_id         = COALESCE(county_id,         $4),
                 occupation        = COALESCE(occupation,        $5),
                 email             = COALESCE(email,             $6),
                 national_id       = COALESCE(national_id,       $7),
                 date_of_birth     = COALESCE(date_of_birth,     $8),
                 gender            = COALESCE(gender,            $9),
                 address           = COALESCE(address,           $10)
               WHERE id = $1`,
              [
                memberId,
                row.middle_name, row.alternative_phone, row.county_id,
                row.occupation, row.email, row.national_id,
                row.date_of_birth, row.gender, row.address,
              ],
            );
          } else {
            const passwordHash = await bcrypt.hash(generateTempPassword(), BCRYPT_RND);
            const { rows: newMember } = await client.query<{ id: string }>(
              `INSERT INTO members
                 (phone, email, password_hash, first_name, middle_name, last_name,
                  national_id, date_of_birth, gender, address,
                  alternative_phone, county_id, occupation)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
               RETURNING id`,
              [
                row.phone, row.email, passwordHash,
                row.first_name, row.middle_name, row.last_name,
                row.national_id, row.date_of_birth, row.gender, row.address,
                row.alternative_phone, row.county_id, row.occupation,
              ],
            );
            memberId = newMember[0].id;
            createdIds.push(memberId);
          }

          // Use the shared helper so person_id + member_code (both NOT NULL
          // on group_members since mig 030) get populated the same way the
          // register_group RPC does it.
          await linkMemberToGroup(client, {
            memberId,
            groupId:     ctx.groupId,
            role:        row.role,
            joinedAt:    row.joined_at,
            invitedBy:   ctx.userId,
            firstName:   row.first_name,
            lastName:    row.last_name,
            phone:       row.phone,
            nationalId:  row.national_id,
            dateOfBirth: row.date_of_birth,
            gender:      row.gender,
          });
          imported++;
        } catch (err) {
          errors.push({
            row:     row.row_num,
            message: `Failed to import: ${(err as Error).message}`,
          });
          skipped++;
        }
      }

      const { rows: updated } = await client.query<ImportJob>(
        `UPDATE import_jobs SET
           status              = 'committed',
           committed_at        = NOW(),
           valid_rows          = $2,
           error_rows          = $3,
           errors              = $4::jsonb,
           created_member_ids  = $5,
           preview_rows        = '[]'::jsonb
         WHERE id = $1
         RETURNING *`,
        [jobId, imported, errors.filter((e) => e.row > 0).length, JSON.stringify(errors), createdIds],
      );

      await writeAuditLog(client, ctx, 'member_import.commit', jobId, {
        imported, skipped, created_member_ids: createdIds.length,
      });

      return { ...updated[0], imported, skipped };
    });
  },

  /**
   * Undo a committed import by DELETE-ing the member rows that this job
   * created. Group memberships cascade off members. If a created member is
   * referenced by other data (contributions, loans, ...) the DELETE will
   * raise an FK violation — we catch it per-member and surface a clear
   * error rather than partially undoing.
   */
  async rollbackMembers(
    ctx: TenantContext,
    jobId: string,
    reason: string | null,
  ): Promise<ImportJob & { deleted: number; blocked: { memberId: string; reason: string }[] }> {
    return withTransaction(ctx, async (client) => {
      const { rows: jobRows } = await client.query<ImportJob>(
        `SELECT * FROM import_jobs WHERE id = $1 AND group_id = $2 FOR UPDATE`,
        [jobId, ctx.groupId],
      );
      const job = jobRows[0];
      if (!job)                       throw new NotFoundError('Import job', jobId);
      if (job.status !== 'committed') throw new ConflictError(`Job ${jobId} is in status '${job.status}' — only 'committed' jobs can be rolled back`);

      const ids = job.created_member_ids ?? [];
      const blocked: { memberId: string; reason: string }[] = [];
      let deleted = 0;

      for (const memberId of ids) {
        try {
          // Try the full member DELETE first. If FK constraints block it
          // (member has contributions, loans, etc.), fall back to removing
          // only the group_members row so this group's footprint is undone.
          await client.query(`SAVEPOINT del_member`);
          await client.query(`DELETE FROM members WHERE id = $1`, [memberId]);
          await client.query(`RELEASE SAVEPOINT del_member`);
          deleted++;
        } catch (err) {
          await client.query(`ROLLBACK TO SAVEPOINT del_member`);
          // Member has dependent rows. Remove just the group membership so
          // the group doesn't show the imported row, and record what blocked
          // the full delete.
          try {
            await client.query(
              `DELETE FROM group_members WHERE group_id = $1 AND member_id = $2`,
              [ctx.groupId, memberId],
            );
            blocked.push({ memberId, reason: `Member has dependent records and was kept; group membership removed. (${(err as Error).message})` });
          } catch (innerErr) {
            blocked.push({ memberId, reason: `Could not remove: ${(innerErr as Error).message}` });
          }
        }
      }

      const { rows: updated } = await client.query<ImportJob>(
        `UPDATE import_jobs SET
           status          = 'rolled_back',
           rolled_back_at  = NOW(),
           rollback_reason = $2
         WHERE id = $1
         RETURNING *`,
        [jobId, reason],
      );

      await writeAuditLog(client, ctx, 'member_import.rollback', jobId, {
        deleted, blocked: blocked.length, reason,
      });

      return { ...updated[0], deleted, blocked };
    });
  },

  /** Discard a previewed job without committing. Clears the stored rows. */
  async cancelPreview(ctx: TenantContext, jobId: string): Promise<ImportJob> {
    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query<ImportJob>(
        `UPDATE import_jobs SET
           status        = 'cancelled',
           cancelled_at  = NOW(),
           preview_rows  = '[]'::jsonb
         WHERE id = $1 AND group_id = $2 AND status = 'previewed'
         RETURNING *`,
        [jobId, ctx.groupId],
      );
      if (!rows[0]) throw new ConflictError(`Job ${jobId} cannot be cancelled (not found or not in 'previewed' state)`);
      await writeAuditLog(client, ctx, 'member_import.cancel', jobId, {});
      return rows[0];
    });
  },

  async getJob(ctx: TenantContext, jobId: string): Promise<ImportJob & { preview_rows: PreparedMemberRow[] }> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<ImportJob & { preview_rows: PreparedMemberRow[] }>(
        `SELECT * FROM import_jobs WHERE id = $1 AND group_id = $2`,
        [jobId, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Import job', jobId);
      return rows[0];
    });
  },

  async listJobs(
    ctx: TenantContext,
    params: { kind?: string; limit?: number; offset?: number } = {},
  ): Promise<{ items: ImportJob[]; total: number }> {
    return withDb(ctx, async (client) => {
      const limit  = Math.min(params.limit  ?? 50, 200);
      const offset = Math.max(params.offset ?? 0,  0);
      const conds: string[]    = ['group_id = $1'];
      const vals:  unknown[]   = [ctx.groupId];
      if (params.kind) { conds.push(`kind = $${vals.length + 1}`); vals.push(params.kind); }

      const where = conds.join(' AND ');
      const [{ rows: countRow }, { rows: items }] = await Promise.all([
        client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM import_jobs WHERE ${where}`, vals),
        client.query<ImportJob>(
          `SELECT id, group_id, kind, status, filename,
                  total_rows, valid_rows, error_rows,
                  errors, created_member_ids,
                  rollback_reason, failure_reason,
                  created_by, created_at, committed_at, rolled_back_at, cancelled_at
             FROM import_jobs
            WHERE ${where}
            ORDER BY created_at DESC
            LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
          [...vals, limit, offset],
        ),
      ]);
      return { items, total: parseInt(countRow[0].count, 10) };
    });
  },

  // ── Legacy single-shot contribution import (untouched in E3) ──────────

  async importContributions(
    ctx: TenantContext,
    csvBuffer: Buffer,
  ): Promise<{ imported: number; errors: ImportRowError[] }> {
    const rows = parseCsv(csvBuffer);
    if (rows.length > MAX_ROWS) throw new ValidationError(`CSV exceeds maximum of ${MAX_ROWS} rows`);

    const errors: ImportRowError[] = [];
    const valid:  (ContributionCsvRow & { member_id: string })[] = [];

    return withTransaction(ctx, async (client) => {
      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2;
        const result = ContributionCsvRowSchema.safeParse(rows[i]);
        if (!result.success) {
          errors.push({ row: rowNum, message: result.error.errors.map((e) => e.message).join('; ') });
          continue;
        }
        const row = result.data;

        if (!isValidKenyanPhone(row.member_phone)) {
          errors.push({ row: rowNum, message: `Invalid phone: ${row.member_phone}` });
          continue;
        }
        const phone = normalizePhone(row.member_phone);
        const { rows: member } = await client.query<{ id: string }>(
          `SELECT m.id
             FROM members m
             JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $2 AND gm.status = 'active'
            WHERE m.phone = $1
            LIMIT 1`,
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
               (group_id, member_id, group_membership_id, amount, contribution_date, status, payment_method, mpesa_receipt_number, notes, recorded_by)
             VALUES ($1,$2,
                     (SELECT gm.id FROM group_members gm
                      WHERE gm.group_id = $1 AND gm.member_id = $2),
                     $3,$4,'completed',$5,$6,$7,$8)
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
          // Duplicate or constraint violation — skip silently.
        }
      }
      return { imported, errors };
    });
  },

  // ── Two-phase contribution import (Phase E7) ─────────────────────────

  /**
   * Phase 1: parse + validate + resolve members → persist as 'previewed'
   * import_job. Identical state-machine shape to previewMembers.
   */
  async previewContributions(
    ctx: TenantContext,
    csvBuffer: Buffer,
    filename: string | null,
  ): Promise<ImportJob & { preview_rows: PreparedContributionRow[] }> {
    const rawRows = parseCsv(csvBuffer);
    if (rawRows.length === 0)      throw new ValidationError('CSV contains no data rows');
    if (rawRows.length > MAX_ROWS) throw new ValidationError(`CSV exceeds maximum of ${MAX_ROWS} rows`);

    return withTransaction(ctx, async (client) => {
      const headerMap      = buildHeaderMapFor('contributions', Object.keys(rawRows[0]));
      const unknownHeaders = Object.keys(rawRows[0]).filter((h) => headerMap[h] === undefined);

      // Member lookup cache: phone → member_id. Avoids N+1 queries for groups
      // that have the same member contributing in many rows.
      const memberByPhone = new Map<string, string>();
      const errors:       ImportRowError[]             = [];
      const preparedRows: PreparedContributionRow[]    = [];
      const seenReceiptsInFile = new Set<string>();

      for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2;
        const raw    = rawRows[i];

        const canon: Record<string, string> = {};
        for (const [origKey, value] of Object.entries(raw)) {
          const canonKey = headerMap[origKey];
          if (canonKey) canon[canonKey] = value;
        }

        const parsed = ContributionCsvRowSchema.safeParse(canon);
        if (!parsed.success) {
          errors.push({
            row:     rowNum,
            message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
            raw,
          });
          continue;
        }
        const data = parsed.data;

        if (!isValidKenyanPhone(data.member_phone)) {
          errors.push({ row: rowNum, message: `Invalid Kenyan phone: ${data.member_phone}`, raw });
          continue;
        }
        const phone = normalizePhone(data.member_phone);

        let memberId = memberByPhone.get(phone);
        if (!memberId) {
          const { rows: m } = await client.query<{ id: string }>(
            `SELECT m.id FROM members m
               JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $1
              WHERE m.phone = $2
              LIMIT 1`,
            [ctx.groupId, phone],
          );
          if (!m[0]) {
            errors.push({ row: rowNum, message: `No member in this group with phone ${phone}`, raw });
            continue;
          }
          memberId = m[0].id;
          memberByPhone.set(phone, memberId);
        }

        // Within-file duplicate receipt detection (the DB UNIQUE catches
        // existing-row dupes at commit).
        if (data.mpesa_receipt) {
          if (seenReceiptsInFile.has(data.mpesa_receipt)) {
            errors.push({ row: rowNum, message: `Duplicate M-Pesa receipt in file: ${data.mpesa_receipt}`, raw });
            continue;
          }
          seenReceiptsInFile.add(data.mpesa_receipt);
        }

        preparedRows.push({
          row_num:           rowNum,
          member_id:         memberId,
          member_phone:      phone,
          amount:            data.amount,
          contribution_date: data.contribution_date,
          payment_method:    data.payment_method ?? null,
          mpesa_receipt:     data.mpesa_receipt ?? null,
          notes:             data.notes ?? null,
          warnings:          [],
        });
      }

      if (unknownHeaders.length > 0) {
        errors.unshift({
          row:     0,
          message: `Unrecognised columns ignored: ${unknownHeaders.join(', ')}`,
        });
      }

      const { rows } = await client.query<ImportJob>(
        `INSERT INTO import_jobs
           (group_id, created_by, kind, status, filename,
            total_rows, valid_rows, error_rows, errors, preview_rows)
         VALUES ($1, $2, 'contributions', 'previewed', $3,
                 $4, $5, $6, $7::jsonb, $8::jsonb)
         RETURNING *`,
        [
          ctx.groupId, ctx.userId, filename,
          rawRows.length, preparedRows.length, errors.filter((e) => e.row > 0).length,
          JSON.stringify(errors),
          JSON.stringify(preparedRows),
        ],
      );

      await writeAuditLog(client, ctx, 'contribution_import.preview', rows[0].id, {
        filename,
        total_rows: rawRows.length,
        valid_rows: preparedRows.length,
        error_rows: errors.filter((e) => e.row > 0).length,
      });

      return { ...rows[0], preview_rows: preparedRows };
    });
  },

  async commitContributions(
    ctx: TenantContext,
    jobId: string,
  ): Promise<ImportJob & { imported: number; skipped: number }> {
    return withTransaction(ctx, async (client) => {
      const { rows: jobRows } = await client.query<ImportJob & { preview_rows: PreparedContributionRow[] }>(
        `SELECT * FROM import_jobs WHERE id = $1 AND group_id = $2 FOR UPDATE`,
        [jobId, ctx.groupId],
      );
      const job = jobRows[0];
      if (!job)                          throw new NotFoundError('Import job', jobId);
      if (job.kind   !== 'contributions') throw new ValidationError(`Job ${jobId} is not a contributions import`);
      if (job.status !== 'previewed')     throw new ConflictError(`Job ${jobId} is in status '${job.status}' — only 'previewed' jobs can be committed`);

      const rowsToInsert = job.preview_rows as PreparedContributionRow[];
      const createdIds:   string[]          = [];
      const errors:       ImportRowError[]  = [...(job.errors ?? [])];
      let   imported = 0;
      let   skipped  = 0;

      for (const row of rowsToInsert) {
        try {
          // ON CONFLICT (mpesa_receipt_number) is the only dedup path for
          // pre-existing rows; everything else goes through.
          const { rows: ins } = await client.query<{ id: string }>(
            `INSERT INTO contributions
               (group_id, member_id, group_membership_id, amount, contribution_date, status,
                payment_method, mpesa_receipt_number, notes, recorded_by)
             VALUES ($1, $2,
                     (SELECT gm.id FROM group_members gm
                      WHERE gm.group_id = $1 AND gm.member_id = $2),
                     $3, $4, 'completed',
                     $5, $6, $7, $8)
             ON CONFLICT (mpesa_receipt_number) DO NOTHING
             RETURNING id`,
            [
              ctx.groupId, row.member_id, row.amount.toFixed(2),
              row.contribution_date,
              row.payment_method,
              row.mpesa_receipt,
              row.notes,
              ctx.userId,
            ],
          );
          if (ins[0]) {
            createdIds.push(ins[0].id);
            imported++;
          } else {
            errors.push({ row: row.row_num, message: `Skipped: duplicate M-Pesa receipt ${row.mpesa_receipt}` });
            skipped++;
          }
        } catch (err) {
          errors.push({ row: row.row_num, message: `Failed to import: ${(err as Error).message}` });
          skipped++;
        }
      }

      const { rows: updated } = await client.query<ImportJob>(
        `UPDATE import_jobs SET
           status              = 'committed',
           committed_at        = NOW(),
           valid_rows          = $2,
           error_rows          = $3,
           errors              = $4::jsonb,
           created_member_ids  = $5,
           preview_rows        = '[]'::jsonb
         WHERE id = $1
         RETURNING *`,
        // Note: created_member_ids is repurposed as the generic "rows this
        // import created" column. The name is from E3 (members); see memory.
        [jobId, imported, errors.filter((e) => e.row > 0).length, JSON.stringify(errors), createdIds],
      );

      await writeAuditLog(client, ctx, 'contribution_import.commit', jobId, {
        imported, skipped, created_ids: createdIds.length,
      });

      return { ...updated[0], imported, skipped };
    });
  },

  /**
   * Soft-cancel rollback: UPDATE status='cancelled'. Preserves the audit
   * trail per the prior audit finding about hard-deleting financial rows.
   * Returns the count actually cancelled (not just attempted).
   */
  async rollbackContributions(
    ctx: TenantContext,
    jobId: string,
    reason: string | null,
  ): Promise<ImportJob & { cancelled: number; blocked: { id: string; reason: string }[] }> {
    return withTransaction(ctx, async (client) => {
      const { rows: jobRows } = await client.query<ImportJob>(
        `SELECT * FROM import_jobs WHERE id = $1 AND group_id = $2 FOR UPDATE`,
        [jobId, ctx.groupId],
      );
      const job = jobRows[0];
      if (!job)                          throw new NotFoundError('Import job', jobId);
      if (job.kind   !== 'contributions') throw new ValidationError(`Job ${jobId} is not a contributions import`);
      if (job.status !== 'committed')     throw new ConflictError(`Job ${jobId} is in status '${job.status}' — only 'committed' jobs can be rolled back`);

      const ids = job.created_member_ids ?? [];
      const blocked: { id: string; reason: string }[] = [];
      let cancelled = 0;

      // Cancel only rows still 'completed'. If a downstream process already
      // changed status (e.g. moved to 'cancelled' or 'failed'), skip — the
      // operator was looking at a stale state.
      const { rows: updated } = await client.query<{ id: string; previous_status: string }>(
        `UPDATE contributions
            SET status     = 'cancelled',
                notes      = COALESCE(notes || E'\n', '') || $2,
                updated_at = NOW()
          WHERE id = ANY($1::uuid[]) AND status = 'completed'
          RETURNING id, 'completed'::text AS previous_status`,
        [ids, `Reverted by import rollback: ${reason ?? '(no reason)'}`],
      );
      cancelled = updated.length;

      const cancelledIds = new Set(updated.map((r) => r.id));
      for (const id of ids) {
        if (!cancelledIds.has(id)) {
          blocked.push({ id, reason: 'Already cancelled or in a non-completed state' });
        }
      }

      const { rows: jobUpdated } = await client.query<ImportJob>(
        `UPDATE import_jobs SET
           status          = 'rolled_back',
           rolled_back_at  = NOW(),
           rollback_reason = $2
         WHERE id = $1
         RETURNING *`,
        [jobId, reason],
      );

      await writeAuditLog(client, ctx, 'contribution_import.rollback', jobId, {
        cancelled, blocked: blocked.length, reason,
      });

      return { ...jobUpdated[0], cancelled, blocked };
    });
  },

  // ── Two-phase loan import (Phase E7) ─────────────────────────────────

  async previewLoans(
    ctx: TenantContext,
    csvBuffer: Buffer,
    filename: string | null,
  ): Promise<ImportJob & { preview_rows: PreparedLoanRow[] }> {
    const rawRows = parseCsv(csvBuffer);
    if (rawRows.length === 0)      throw new ValidationError('CSV contains no data rows');
    if (rawRows.length > MAX_ROWS) throw new ValidationError(`CSV exceeds maximum of ${MAX_ROWS} rows`);

    return withTransaction(ctx, async (client) => {
      const headerMap      = buildHeaderMapFor('loans', Object.keys(rawRows[0]));
      const unknownHeaders = Object.keys(rawRows[0]).filter((h) => headerMap[h] === undefined);

      const memberByPhone = new Map<string, string>();
      const errors:       ImportRowError[]      = [];
      const preparedRows: PreparedLoanRow[]     = [];

      for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2;
        const raw    = rawRows[i];

        const canon: Record<string, string> = {};
        for (const [origKey, value] of Object.entries(raw)) {
          const canonKey = headerMap[origKey];
          if (canonKey) canon[canonKey] = value;
        }

        const parsed = LoanCsvRowSchema.safeParse(canon);
        if (!parsed.success) {
          errors.push({
            row:     rowNum,
            message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
            raw,
          });
          continue;
        }
        const data = parsed.data;

        if (!isValidKenyanPhone(data.member_phone)) {
          errors.push({ row: rowNum, message: `Invalid Kenyan phone: ${data.member_phone}`, raw });
          continue;
        }
        const phone = normalizePhone(data.member_phone);

        let memberId = memberByPhone.get(phone);
        if (!memberId) {
          const { rows: m } = await client.query<{ id: string }>(
            `SELECT m.id FROM members m
               JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $1
              WHERE m.phone = $2
              LIMIT 1`,
            [ctx.groupId, phone],
          );
          if (!m[0]) {
            errors.push({ row: rowNum, message: `No member in this group with phone ${phone}`, raw });
            continue;
          }
          memberId = m[0].id;
          memberByPhone.set(phone, memberId);
        }

        preparedRows.push({
          row_num:           rowNum,
          member_id:         memberId,
          principal_amount:  data.principal_amount,
          interest_rate:     data.interest_rate,
          term_months:       data.term_months,
          disbursement_date: data.disbursement_date,
          status:            data.status,
          purpose:           data.purpose ?? null,
          notes:             data.notes ?? null,
          warnings:          [],
        });
      }

      if (unknownHeaders.length > 0) {
        errors.unshift({
          row:     0,
          message: `Unrecognised columns ignored: ${unknownHeaders.join(', ')}`,
        });
      }

      const { rows } = await client.query<ImportJob>(
        `INSERT INTO import_jobs
           (group_id, created_by, kind, status, filename,
            total_rows, valid_rows, error_rows, errors, preview_rows)
         VALUES ($1, $2, 'loans', 'previewed', $3,
                 $4, $5, $6, $7::jsonb, $8::jsonb)
         RETURNING *`,
        [
          ctx.groupId, ctx.userId, filename,
          rawRows.length, preparedRows.length, errors.filter((e) => e.row > 0).length,
          JSON.stringify(errors),
          JSON.stringify(preparedRows),
        ],
      );

      await writeAuditLog(client, ctx, 'loan_import.preview', rows[0].id, {
        filename,
        total_rows: rawRows.length,
        valid_rows: preparedRows.length,
        error_rows: errors.filter((e) => e.row > 0).length,
      });

      return { ...rows[0], preview_rows: preparedRows };
    });
  },

  /**
   * Commit historical loans. No repayment schedule is generated — historical
   * loan rows are imported as-is with the supplied status. If the operator
   * wants the per-installment history too, they'll import loan_repayments
   * separately (E7.2).
   */
  async commitLoans(
    ctx: TenantContext,
    jobId: string,
  ): Promise<ImportJob & { imported: number; skipped: number }> {
    return withTransaction(ctx, async (client) => {
      const { rows: jobRows } = await client.query<ImportJob & { preview_rows: PreparedLoanRow[] }>(
        `SELECT * FROM import_jobs WHERE id = $1 AND group_id = $2 FOR UPDATE`,
        [jobId, ctx.groupId],
      );
      const job = jobRows[0];
      if (!job)                      throw new NotFoundError('Import job', jobId);
      if (job.kind   !== 'loans')    throw new ValidationError(`Job ${jobId} is not a loans import`);
      if (job.status !== 'previewed') throw new ConflictError(`Job ${jobId} is in status '${job.status}' — only 'previewed' jobs can be committed`);

      const rowsToInsert = job.preview_rows as PreparedLoanRow[];
      const createdIds:   string[]          = [];
      const errors:       ImportRowError[]  = [...(job.errors ?? [])];
      let   imported = 0;
      let   skipped  = 0;

      for (const row of rowsToInsert) {
        try {
          // outstanding_balance defaults to principal_amount for 'active' loans,
          // 0 for 'completed', and principal for defaulted/written_off (since
          // those represent unpaid amounts). The accounting layer will reconcile
          // when repayments are imported.
          const outstanding =
            row.status === 'completed' ? 0
          : row.principal_amount;

          // The loan and its funding split MUST be one statement.
          // trg_assert_loan_attribution_on_status is DEFERRABLE INITIALLY
          // DEFERRED and covers every status this importer can write
          // ('active' — its default — plus completed/defaulted/written_off),
          // so it fires at COMMIT, long after the per-row catch below has gone
          // out of scope. Before this, EVERY loan import aborted the whole
          // transaction with an opaque check_violation and none of the
          // row-level diagnostics this importer exists to produce.
          //
          // Historical imported loans were funded from the group's own money,
          // so they attribute to the auto-provisioned internal_savings source.
          const { rows: ins } = await client.query<{ id: string }>(
            `WITH new_loan AS (
               INSERT INTO loans
                 (group_id, member_id, group_membership_id, principal_amount, interest_rate,
                  loan_term_months, disbursement_date, status, purpose,
                  approved_by, approved_at,
                  disbursed_by, disbursed_at,
                  outstanding_balance,
                  notes)
               VALUES ($1, $2,
                       (SELECT gm.id FROM group_members gm
                        WHERE gm.group_id = $1 AND gm.member_id = $2),
                       $3, $4,
                       $5, $6, $7::loan_status, $8,
                       $9, NOW(),
                       $9, NOW(),
                       $10,
                       $11)
               RETURNING id, group_id, principal_amount
             )
             INSERT INTO loan_funding_splits (group_id, loan_id, funding_source_id, amount)
             SELECT nl.group_id, nl.id, s.id, nl.principal_amount
             FROM   new_loan nl
             JOIN   group_funding_sources s
               ON   s.group_id = nl.group_id AND s.source_type = 'internal_savings'
             RETURNING loan_id AS id`,
            [
              ctx.groupId, row.member_id,
              row.principal_amount.toFixed(2), row.interest_rate.toFixed(2),
              row.term_months, row.disbursement_date, row.status, row.purpose,
              ctx.userId,
              outstanding.toFixed(2),
              row.notes,
            ],
          );

          if (!ins[0]) {
            // The JOIN above found no internal_savings source, so no row was
            // written. Fail this row loudly rather than let the deferred
            // constraint blow up the entire import at COMMIT.
            throw new Error(
              'No internal savings funding source exists for this group — cannot attribute the loan',
            );
          }

          // total_repayable, outstanding_balance and next_payment_date are set
          // BY generate_loan_schedule. The importer used to compute
          // total_repayable itself with a TypeScript copy of the interest
          // formula that still divided the rate by 12 — after migration 148
          // established interest_rate as MONTHLY, that copy understated
          // interest 12x (13,000 vs 156,000 on a 130,000 @ 10% x 12 loan).
          // One formula, in SQL, is the only way that stays true.
          //
          // This also replaces the schedule that never got generated:
          // trg_loans_generate_schedule is AFTER UPDATE and needs a transition
          // INTO 'disbursed', so a plain INSERT at 'active' never fired it and
          // imported borrowers had no instalments and no reminders at all.
          await client.query(`SELECT generate_loan_schedule($1)`, [ins[0].id]);

          // Completed loans owe nothing; the generator always writes principal.
          if (row.status === 'completed') {
            await client.query(
              `UPDATE loans SET outstanding_balance = 0, next_payment_date = NULL WHERE id = $1`,
              [ins[0].id],
            );
          }
          createdIds.push(ins[0].id);
          imported++;
        } catch (err) {
          errors.push({ row: row.row_num, message: `Failed to import: ${(err as Error).message}` });
          skipped++;
        }
      }

      const { rows: updated } = await client.query<ImportJob>(
        `UPDATE import_jobs SET
           status              = 'committed',
           committed_at        = NOW(),
           valid_rows          = $2,
           error_rows          = $3,
           errors              = $4::jsonb,
           created_member_ids  = $5,
           preview_rows        = '[]'::jsonb
         WHERE id = $1
         RETURNING *`,
        [jobId, imported, errors.filter((e) => e.row > 0).length, JSON.stringify(errors), createdIds],
      );

      await writeAuditLog(client, ctx, 'loan_import.commit', jobId, {
        imported, skipped, created_ids: createdIds.length,
      });

      return { ...updated[0], imported, skipped };
    });
  },

  /**
   * Hard-delete rollback for loans, blocked per-id if the loan has any
   * repayment rows. We can't safely soft-delete since loan_status has no
   * 'cancelled' value and writing 'written_off' here would mislead reports.
   */
  async rollbackLoans(
    ctx: TenantContext,
    jobId: string,
    reason: string | null,
  ): Promise<ImportJob & { deleted: number; blocked: { id: string; reason: string }[] }> {
    return withTransaction(ctx, async (client) => {
      const { rows: jobRows } = await client.query<ImportJob>(
        `SELECT * FROM import_jobs WHERE id = $1 AND group_id = $2 FOR UPDATE`,
        [jobId, ctx.groupId],
      );
      const job = jobRows[0];
      if (!job)                  throw new NotFoundError('Import job', jobId);
      if (job.kind   !== 'loans') throw new ValidationError(`Job ${jobId} is not a loans import`);
      if (job.status !== 'committed') throw new ConflictError(`Job ${jobId} is in status '${job.status}' — only 'committed' jobs can be rolled back`);

      const ids = job.created_member_ids ?? [];
      const blocked: { id: string; reason: string }[] = [];
      let deleted = 0;

      for (const loanId of ids) {
        const { rows: rep } = await client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM loan_repayments
            WHERE loan_id = $1 AND status = 'completed'`,
          [loanId],
        );
        if (parseInt(rep[0].count, 10) > 0) {
          blocked.push({ id: loanId, reason: 'Loan has completed repayments; manual review required' });
          continue;
        }

        try {
          await client.query(`SAVEPOINT del_loan`);
          // CASCADE removes the unpaid repayment schedule rows (if any) too.
          await client.query(`DELETE FROM loans WHERE id = $1`, [loanId]);
          await client.query(`RELEASE SAVEPOINT del_loan`);
          deleted++;
        } catch (err) {
          await client.query(`ROLLBACK TO SAVEPOINT del_loan`);
          blocked.push({ id: loanId, reason: `DB error: ${(err as Error).message}` });
        }
      }

      const { rows: jobUpdated } = await client.query<ImportJob>(
        `UPDATE import_jobs SET
           status          = 'rolled_back',
           rolled_back_at  = NOW(),
           rollback_reason = $2
         WHERE id = $1
         RETURNING *`,
        [jobId, reason],
      );

      await writeAuditLog(client, ctx, 'loan_import.rollback', jobId, {
        deleted, blocked: blocked.length, reason,
      });

      return { ...jobUpdated[0], deleted, blocked };
    });
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseCsv(buffer: Buffer): Record<string, string>[] {
  try {
    return parse(buffer, {
      columns:          true,
      skip_empty_lines: true,
      trim:             true,
      bom:              true,
    }) as Record<string, string>[];
  } catch (err) {
    throw new ValidationError(`Invalid CSV file: ${(err as Error).message}`);
  }
}

function buildHeaderMap(rawHeaders: string[]): Record<string, MemberCsvColumn | undefined> {
  const map: Record<string, MemberCsvColumn | undefined> = {};
  for (const h of rawHeaders) {
    map[h] = resolveCsvHeader(h) ?? undefined;
  }
  return map;
}

/**
 * Kind-aware header resolver used by E7 importers. Returns a map from raw
 * header → canonical column name (or undefined if the header is unrecognised
 * for that kind).
 */
function buildHeaderMapFor(
  kind: ImportKind,
  rawHeaders: string[],
): Record<string, string | undefined> {
  const map: Record<string, string | undefined> = {};
  for (const h of rawHeaders) {
    map[h] = resolveHeaderFor(kind, h) ?? undefined;
  }
  return map;
}

/**
 * Approximate total repayable for a historical loan: simple interest over
 * the term. Real reducing-balance amortisation lives in the loan-creation
 * flow; for historical imports a close-enough figure is good enough since
 * the operator already has the actual numbers in their ledger.
 */
// computeTotalRepayable() was deleted here. It was a TypeScript re-implementation
// of the interest formula that divided interest_rate by 12, treating it as an
// annual rate. Migration 148 established that the field is MONTHLY, and the
// duplicate silently understated interest 12x on every imported loan.
// generate_loan_schedule now writes total_repayable, so there is one formula.

async function loadCounties(client: PoolClient): Promise<Map<string, string>> {
  const { rows } = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM counties`,
  );
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.name.toLowerCase(), r.id);
  return map;
}

async function writeAuditLog(
  client: PoolClient,
  ctx:    TenantContext,
  action: string,
  resourceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
       (group_id, actor_id, action, resource_type, resource_id, new_values)
     VALUES ($1, $2, $3, 'import_job', $4, $5::jsonb)`,
    [ctx.groupId, ctx.userId, action, resourceId, JSON.stringify(payload)],
  );
}

function generateTempPassword(): string {
  return Math.random().toString(36).slice(-10) + 'A1';
}

// Re-export for callers that import from the service module directly.
export { MEMBER_CSV_COLUMNS };
