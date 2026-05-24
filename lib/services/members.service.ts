import bcrypt from 'bcryptjs';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { applyMemberMask } from '@/lib/utils/mask';
import { normalizePhone } from '@/lib/utils/phone';
import {
  NotFoundError, ConflictError, ValidationError,
} from '@/lib/utils/errors';
import type { Member, GroupMember, PaginatedResult } from '@/types/db.types';
import type {
  CreateMemberInput, UpdateMemberInput, MemberQueryInput,
  MemberStatus, CreateNextOfKinInput, UpdateNextOfKinInput,
} from '@/lib/validators/member.schema';
import { billingService } from './billing.service';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? '10', 10);

// Member statuses that need a reason recorded when a transition lands.
const REASON_REQUIRED_STATUSES = new Set<MemberStatus>([
  'suspended', 'rejected', 'blacklisted', 'exited',
]);

export const membersService = {

  async list(
    ctx: TenantContext,
    params: MemberQueryInput,
  ): Promise<PaginatedResult<Member & { group_role: string; group_status: string; joined_at: Date }>> {
    return withDb(ctx, async (client) => {
      const { page, limit, search, role, status, includeArchived, countyId, sortBy, sortDir } = params;
      const offset = (page - 1) * limit;

      const conditions: string[] = [];
      const values: unknown[] = [ctx.groupId];
      let   idx = 2;

      if (search) {
        conditions.push(
          `(m.first_name ILIKE $${idx} OR m.last_name ILIKE $${idx} OR m.phone ILIKE $${idx} OR m.middle_name ILIKE $${idx})`,
        );
        values.push(`%${search}%`);
        idx++;
      }
      if (role)     { conditions.push(`gm.role = $${idx++}`);      values.push(role); }
      if (status)   { conditions.push(`gm.status = $${idx++}`);    values.push(status); }
      if (countyId) { conditions.push(`m.county_id = $${idx++}`);  values.push(countyId); }
      // Hide archived rows by default; explicit toggle to include them. Archive
      // is a soft delete, so the list-view default matches user expectations.
      if (!includeArchived && !status) { conditions.push(`gm.status <> 'archived'`); }

      const where = conditions.length ? 'AND ' + conditions.join(' AND ') : '';
      const validSortColumns: Record<string, string> = {
        first_name: 'm.first_name', last_name: 'm.last_name',
        joined_at:  'gm.joined_at', created_at: 'm.created_at',
      };
      const orderCol = validSortColumns[sortBy] ?? 'm.first_name';
      const orderDir = sortDir === 'desc' ? 'DESC' : 'ASC';

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM group_members gm
         JOIN members m ON m.id = gm.member_id
         WHERE gm.group_id = $1 ${where}`,
        values,
      );
      const total = parseInt(countResult.rows[0].count, 10);

      const rows = await client.query<Member & { group_role: string; group_status: string; joined_at: Date }>(
        `SELECT m.*, gm.role AS group_role, gm.status AS group_status, gm.joined_at
         FROM group_members gm
         JOIN members m ON m.id = gm.member_id
         WHERE gm.group_id = $1 ${where}
         ORDER BY ${orderCol} ${orderDir}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset],
      );

      const data = rows.rows.map((m) => applyMemberMask(m, ctx.role) as typeof m);

      return { items: data, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
    });
  },

  async getById(ctx: TenantContext, memberId: string): Promise<Member & { group_role: string; group_status: string; joined_at: Date }> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<Member & { group_role: string; group_status: string; joined_at: Date }>(
        `SELECT m.*, gm.role AS group_role, gm.status AS group_status, gm.joined_at
         FROM members m
         JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $2
         WHERE m.id = $1`,
        [memberId, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Member', memberId);
      return applyMemberMask(rows[0], ctx.role) as typeof rows[0];
    });
  },

  async create(ctx: TenantContext, data: CreateMemberInput): Promise<Member> {
    return withTransaction(ctx, async (client) => {
      // Enforce member cap before adding
      await billingService.assertMemberCap(ctx, client);

      const phone = normalizePhone(data.phone);

      // Check if member already exists anywhere in the platform
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM members WHERE phone = $1',
        [phone],
      );

      let memberId: string;

      if (existing.rows[0]) {
        memberId = existing.rows[0].id;
        const inGroup = await client.query<{ id: string }>(
          'SELECT id FROM group_members WHERE group_id = $1 AND member_id = $2',
          [ctx.groupId, memberId],
        );
        if (inGroup.rows[0]) throw new ConflictError('Member already belongs to this group');
        // Existing platform members may also receive the E1 personal-info
        // updates (middle_name, alt_phone, county, occupation, referred_by).
        // We do this so a re-add picks up the latest details rather than
        // silently keeping stale data from a prior group's record.
        await client.query(
          `UPDATE members SET
             middle_name       = COALESCE($2, middle_name),
             alternative_phone = COALESCE($3, alternative_phone),
             county_id         = COALESCE($4, county_id),
             occupation        = COALESCE($5, occupation),
             referred_by       = COALESCE($6, referred_by)
           WHERE id = $1`,
          [memberId, data.middleName, data.alternativePhone, data.countyId, data.occupation, data.referredBy],
        );
      } else {
        // Create new platform member with a temporary password they must reset
        const passwordHash = await bcrypt.hash(
          (data as Record<string, unknown>).password as string | undefined ?? generateTempPassword(),
          BCRYPT_ROUNDS,
        );
        const { rows } = await client.query<Member>(
          `INSERT INTO members
             (phone, email, password_hash, first_name, middle_name, last_name,
              national_id, date_of_birth, gender, address,
              alternative_phone, county_id, occupation, referred_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *`,
          [
            phone, data.email ?? null, passwordHash,
            data.firstName, data.middleName ?? null, data.lastName,
            data.nationalId ?? null, data.dateOfBirth ?? null,
            data.gender ?? null, data.address ?? null,
            data.alternativePhone ?? null, data.countyId ?? null,
            data.occupation ?? null, data.referredBy ?? null,
          ],
        );
        memberId = rows[0].id;
      }

      await client.query(
        `INSERT INTO group_members (group_id, member_id, role, invited_by)
         VALUES ($1, $2, $3, $4)`,
        [ctx.groupId, memberId, data.role ?? 'member', ctx.userId],
      );

      const { rows } = await client.query<Member>(
        'SELECT * FROM members WHERE id = $1',
        [memberId],
      );
      return rows[0];
    });
  },

  async update(ctx: TenantContext, memberId: string, data: UpdateMemberInput): Promise<Member> {
    return withTransaction(ctx, async (client) => {
      // Field mapping kept explicit so unknown fields can't be smuggled into
      // the SQL via a dynamic object spread.
      const fieldMap: Record<string, string> = {
        firstName:        'first_name',
        lastName:         'last_name',
        email:            'email',
        nationalId:       'national_id',
        dateOfBirth:      'date_of_birth',
        gender:           'gender',
        address:          'address',
        profilePhotoUrl:  'profile_photo_url',
        // Phase E1
        middleName:       'middle_name',
        alternativePhone: 'alternative_phone',
        countyId:         'county_id',
        occupation:       'occupation',
        referredBy:       'referred_by',
      };

      const sets: string[]   = [];
      const values: unknown[] = [];
      let idx = 1;

      for (const [field, column] of Object.entries(fieldMap)) {
        const v = (data as Record<string, unknown>)[field];
        if (v !== undefined) {
          sets.push(`${column} = $${idx++}`);
          values.push(v);
        }
      }

      if (sets.length === 0) throw new ValidationError('No fields to update');

      values.push(memberId);
      const { rows } = await client.query<Member>(
        `UPDATE members SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        values,
      );
      if (!rows[0]) throw new NotFoundError('Member', memberId);
      return rows[0];
    });
  },

  async updateRole(ctx: TenantContext, memberId: string, role: string): Promise<GroupMember> {
    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query<GroupMember>(
        `UPDATE group_members SET role = $1
         WHERE group_id = $2 AND member_id = $3
         RETURNING *`,
        [role, ctx.groupId, memberId],
      );
      if (!rows[0]) throw new NotFoundError('Group membership for member', memberId);
      return rows[0];
    });
  },

  /**
   * Atomically transition a member's status with optional reason + audit
   * trail. Stamps the correct *_at / *_by / *_reason columns based on the
   * target status so the soft-delete history is preserved.
   *
   * Allowed transitions match the state machine in spec §5:
   *   pending_verification → active | rejected
   *   active               → suspended | archived | blacklisted | exited
   *   inactive             → active | archived
   *   suspended            → active | archived
   *   rejected             → archived
   *   blacklisted          → archived
   *   exited               → archived
   *   archived             → active   (restore)
   */
  async transitionStatus(
    ctx: TenantContext,
    memberId: string,
    target: MemberStatus,
    reason?: string,
  ): Promise<GroupMember> {
    if (REASON_REQUIRED_STATUSES.has(target) && !reason?.trim()) {
      throw new ValidationError(`A reason is required when setting status to '${target}'`);
    }

    return withTransaction(ctx, async (client) => {
      const { rows: current } = await client.query<{ status: MemberStatus }>(
        `SELECT status FROM group_members WHERE group_id = $1 AND member_id = $2`,
        [ctx.groupId, memberId],
      );
      if (!current[0]) throw new NotFoundError('Group membership for member', memberId);

      const validNext: Partial<Record<MemberStatus, Set<MemberStatus>>> = {
        pending_verification: new Set(['active', 'rejected']),
        active:               new Set(['suspended', 'inactive', 'archived', 'blacklisted', 'exited']),
        inactive:             new Set(['active', 'archived']),
        suspended:            new Set(['active', 'archived']),
        rejected:             new Set(['archived']),
        blacklisted:          new Set(['archived']),
        exited:               new Set(['archived']),
        archived:             new Set(['active']),
      };

      const allowed = validNext[current[0].status];
      if (!allowed || !allowed.has(target)) {
        throw new ConflictError(
          `Cannot transition member from '${current[0].status}' to '${target}'`,
        );
      }

      // Build the per-status audit columns. Each terminal status writes its
      // own _at / _by / _reason. Restoring to 'active' clears archived_at
      // so the row no longer reads as soft-deleted.
      const setClauses: string[] = [`status = $1`];
      const values: unknown[]    = [target];
      let idx = 2;

      if (target === 'archived') {
        setClauses.push(`archived_at = NOW()`);
        setClauses.push(`archived_by = $${idx++}`); values.push(ctx.userId);
      } else if (target === 'blacklisted') {
        setClauses.push(`blacklisted_at = NOW()`);
        setClauses.push(`blacklisted_by = $${idx++}`);   values.push(ctx.userId);
        setClauses.push(`blacklist_reason = $${idx++}`); values.push(reason!);
      } else if (target === 'exited') {
        setClauses.push(`exited_at = NOW()`);
        setClauses.push(`exited_by = $${idx++}`);   values.push(ctx.userId);
        setClauses.push(`exit_reason = $${idx++}`); values.push(reason!);
      } else if (target === 'rejected') {
        setClauses.push(`rejected_at = NOW()`);
        setClauses.push(`reject_reason = $${idx++}`); values.push(reason!);
      } else if (target === 'suspended') {
        // group_members has no suspended_at column — store reason on
        // reject_reason for now (Phase A added it as a generic reason field).
        setClauses.push(`reject_reason = $${idx++}`); values.push(reason!);
      } else if (target === 'active' && current[0].status === 'archived') {
        // Restoring from archive: clear archive metadata.
        setClauses.push(`archived_at = NULL`, `archived_by = NULL`);
      }

      values.push(ctx.groupId, memberId);
      const { rows } = await client.query<GroupMember>(
        `UPDATE group_members SET ${setClauses.join(', ')}
         WHERE group_id = $${idx++} AND member_id = $${idx++}
         RETURNING *`,
        values,
      );
      return rows[0];
    });
  },

  /** Convenience: soft-archive a member (status → 'archived'). */
  async archive(ctx: TenantContext, memberId: string): Promise<GroupMember> {
    return this.transitionStatus(ctx, memberId, 'archived');
  },

  /** Convenience: restore a previously archived member (status → 'active'). */
  async restore(ctx: TenantContext, memberId: string): Promise<GroupMember> {
    return this.transitionStatus(ctx, memberId, 'active');
  },

  /**
   * @deprecated kept for the existing DELETE endpoint. Prefer
   * transitionStatus(..., 'archived', reason) for new code so the audit
   * trail is populated.
   */
  async deactivate(ctx: TenantContext, memberId: string): Promise<void> {
    await this.archive(ctx, memberId);
  },

  async changePassword(
    ctx: TenantContext,
    memberId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query<{ password_hash: string }>(
        'SELECT password_hash FROM members WHERE id = $1',
        [memberId],
      );
      if (!rows[0]) throw new NotFoundError('Member', memberId);

      const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!valid) throw new ValidationError('Current password is incorrect');

      const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await client.query('UPDATE members SET password_hash = $1 WHERE id = $2', [newHash, memberId]);
    });
  },

  // ── Next of Kin ─────────────────────────────────────────────────────────

  async listNextOfKin(ctx: TenantContext, memberId: string) {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT id, full_name, relationship, phone, alternative_phone,
                email, address, national_id, priority, notes,
                created_at, updated_at
         FROM   next_of_kin
         WHERE  group_id = $1 AND member_id = $2
         ORDER  BY priority ASC, created_at ASC`,
        [ctx.groupId, memberId],
      );
      return rows;
    });
  },

  async createNextOfKin(ctx: TenantContext, memberId: string, data: CreateNextOfKinInput) {
    return withTransaction(ctx, async (client) => {
      // Make sure the member belongs to this tenant (RLS would block anyway,
      // but a clear 404 is friendlier than an opaque 403).
      const { rows: m } = await client.query<{ id: string }>(
        `SELECT id FROM group_members WHERE group_id = $1 AND member_id = $2`,
        [ctx.groupId, memberId],
      );
      if (!m[0]) throw new NotFoundError('Group membership for member', memberId);

      // The unique partial index on next_of_kin(member_id) WHERE priority=1
      // catches duplicate primaries — surface a clean conflict instead of the
      // raw 23505 to make the UI message readable.
      try {
        const phone = normalizePhone(data.phone);
        const altPhone = data.alternativePhone
          ? normalizePhone(data.alternativePhone)
          : null;

        const { rows } = await client.query(
          `INSERT INTO next_of_kin (
             group_id, member_id,
             full_name, relationship, phone, alternative_phone,
             email, address, national_id, priority, notes
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [
            ctx.groupId, memberId,
            data.fullName, data.relationship, phone, altPhone,
            data.email || null, data.address || null,
            data.nationalId || null, data.priority, data.notes || null,
          ],
        );
        return rows[0];
      } catch (e: any) {
        if (e?.code === '23505' && e?.constraint === 'uq_nok_one_primary_per_member') {
          throw new ConflictError(
            'This member already has a primary next-of-kin (priority 1). Use a different priority or update the existing primary.',
          );
        }
        throw e;
      }
    });
  },

  async updateNextOfKin(
    ctx: TenantContext,
    memberId: string,
    kinId: string,
    data: UpdateNextOfKinInput,
  ) {
    return withTransaction(ctx, async (client) => {
      const fieldMap: Record<string, string> = {
        fullName:         'full_name',
        relationship:     'relationship',
        phone:            'phone',
        alternativePhone: 'alternative_phone',
        email:            'email',
        address:          'address',
        nationalId:       'national_id',
        priority:         'priority',
        notes:            'notes',
      };
      const sets: string[]   = [];
      const values: unknown[] = [];
      let idx = 1;

      for (const [field, column] of Object.entries(fieldMap)) {
        const v = (data as Record<string, unknown>)[field];
        if (v !== undefined) {
          let value: unknown = v;
          if ((field === 'phone' || field === 'alternativePhone') && typeof v === 'string' && v.length > 0) {
            value = normalizePhone(v);
          }
          if ((field === 'email' || field === 'alternativePhone' || field === 'address' || field === 'nationalId' || field === 'notes')
              && v === '') {
            value = null;
          }
          sets.push(`${column} = $${idx++}`);
          values.push(value);
        }
      }

      if (sets.length === 0) throw new ValidationError('No fields to update');

      sets.push(`updated_at = NOW()`);
      values.push(ctx.groupId, memberId, kinId);
      const { rows } = await client.query(
        `UPDATE next_of_kin SET ${sets.join(', ')}
         WHERE group_id = $${idx++} AND member_id = $${idx++} AND id = $${idx++}
         RETURNING *`,
        values,
      );
      if (!rows[0]) throw new NotFoundError('Next of kin', kinId);
      return rows[0];
    });
  },

  async deleteNextOfKin(ctx: TenantContext, memberId: string, kinId: string): Promise<void> {
    return withTransaction(ctx, async (client) => {
      const { rowCount } = await client.query(
        `DELETE FROM next_of_kin WHERE group_id = $1 AND member_id = $2 AND id = $3`,
        [ctx.groupId, memberId, kinId],
      );
      if (!rowCount) throw new NotFoundError('Next of kin', kinId);
    });
  },
};

function generateTempPassword(): string {
  return Math.random().toString(36).slice(-10) + 'A1';
}
