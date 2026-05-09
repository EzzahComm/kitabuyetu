import bcrypt from 'bcryptjs';
import { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { applyMemberMask } from '@/lib/utils/mask';
import { normalizePhone } from '@/lib/utils/phone';
import {
  NotFoundError, ConflictError, MemberCapError, ValidationError,
} from '@/lib/utils/errors';
import type { Member, GroupMember, PaginatedResult } from '@/types/db.types';
import type { CreateMemberInput, UpdateMemberInput, MemberQueryInput } from '@/lib/validators/member.schema';
import { billingService } from './billing.service';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? '10', 10);

export const membersService = {

  async list(
    ctx: TenantContext,
    params: MemberQueryInput,
  ): Promise<PaginatedResult<Member & { group_role: string; joined_at: Date }>> {
    return withDb(ctx, async (client) => {
      const { page, limit, search, role, active, sortBy, sortDir } = params;
      const offset = (page - 1) * limit;

      const conditions: string[] = [];
      const values: unknown[] = [ctx.groupId];
      let   idx = 2;

      if (search) {
        conditions.push(
          `(m.first_name ILIKE $${idx} OR m.last_name ILIKE $${idx} OR m.phone ILIKE $${idx})`,
        );
        values.push(`%${search}%`);
        idx++;
      }
      if (role)   { conditions.push(`gm.role = $${idx++}`);       values.push(role); }
      if (active !== undefined) { conditions.push(`gm.is_active = $${idx++}`); values.push(active); }

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

      const rows = await client.query<Member & { group_role: string; joined_at: Date }>(
        `SELECT m.*, gm.role AS group_role, gm.joined_at
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

  async getById(ctx: TenantContext, memberId: string): Promise<Member & { group_role: string; joined_at: Date }> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<Member & { group_role: string; joined_at: Date }>(
        `SELECT m.*, gm.role AS group_role, gm.joined_at
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
        // Check if already in this group
        const inGroup = await client.query<{ id: string }>(
          'SELECT id FROM group_members WHERE group_id = $1 AND member_id = $2',
          [ctx.groupId, memberId],
        );
        if (inGroup.rows[0]) throw new ConflictError('Member already belongs to this group');
      } else {
        // Create new platform member with a temporary password they must reset
        const passwordHash = await bcrypt.hash(
          (data as Record<string, unknown>).password as string | undefined ?? generateTempPassword(),
          BCRYPT_ROUNDS,
        );
        const { rows } = await client.query<Member>(
          `INSERT INTO members
             (phone, email, password_hash, first_name, last_name,
              national_id, date_of_birth, gender, address)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING *`,
          [
            phone, data.email ?? null, passwordHash,
            data.firstName, data.lastName, data.nationalId ?? null,
            data.dateOfBirth ?? null, data.gender ?? null, data.address ?? null,
          ],
        );
        memberId = rows[0].id;
      }

      // Add to group
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
      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (data.firstName    !== undefined) { sets.push(`first_name = $${idx++}`);        values.push(data.firstName); }
      if (data.lastName     !== undefined) { sets.push(`last_name = $${idx++}`);         values.push(data.lastName); }
      if (data.email        !== undefined) { sets.push(`email = $${idx++}`);             values.push(data.email); }
      if (data.nationalId   !== undefined) { sets.push(`national_id = $${idx++}`);       values.push(data.nationalId); }
      if (data.dateOfBirth  !== undefined) { sets.push(`date_of_birth = $${idx++}`);     values.push(data.dateOfBirth); }
      if (data.gender       !== undefined) { sets.push(`gender = $${idx++}`);            values.push(data.gender); }
      if (data.address      !== undefined) { sets.push(`address = $${idx++}`);           values.push(data.address); }
      if (data.profilePhotoUrl !== undefined) { sets.push(`profile_photo_url = $${idx++}`); values.push(data.profilePhotoUrl); }

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

  async deactivate(ctx: TenantContext, memberId: string): Promise<void> {
    return withTransaction(ctx, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE group_members SET is_active = false
         WHERE group_id = $1 AND member_id = $2`,
        [ctx.groupId, memberId],
      );
      if (!rowCount) throw new NotFoundError('Group membership for member', memberId);
    });
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
};

function generateTempPassword(): string {
  return Math.random().toString(36).slice(-10) + 'A1';
}
