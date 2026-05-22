import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { z } from 'zod';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const CreateMeetingSchema = z.object({
  title:           z.string().min(3).max(255),
  meetingType:     z.enum(['regular','special','agm','emergency','committee','training']).default('regular'),
  scheduledAt:     z.string().datetime(),
  venue:           z.string().optional(),
  isVirtual:       z.boolean().default(false),
  meetingLink:     z.string().url().optional(),
  agenda:          z.array(z.string()).default([]),
  quorumRequired:  z.coerce.number().int().positive().optional(),
  chairedBy:       z.string().uuid().optional(),
  secretaryId:     z.string().uuid().optional(),
  notes:           z.string().optional(),
});

export const UpdateMeetingSchema = z.object({
  title:          z.string().min(3).max(255).optional(),
  status:         z.enum(['scheduled','in_progress','completed','cancelled','postponed']).optional(),
  scheduledAt:    z.string().datetime().optional(),
  venue:          z.string().optional(),
  isVirtual:      z.boolean().optional(),
  meetingLink:    z.string().url().optional().nullable(),
  agenda:         z.array(z.string()).optional(),
  minutes:        z.string().optional(),
  quorumAchieved: z.coerce.number().int().positive().optional(),
  chairedBy:      z.string().uuid().optional().nullable(),
  secretaryId:    z.string().uuid().optional().nullable(),
  notes:          z.string().optional(),
  endedAt:        z.string().datetime().optional(),
});

export const RecordAttendanceSchema = z.object({
  attendance: z.array(z.object({
    memberId:     z.string().uuid(),
    status:       z.enum(['present','absent','excused','late']),
    excuseReason: z.string().optional(),
    fineAmount:   z.coerce.number().min(0).default(0),
  })),
});

export const AddResolutionSchema = z.object({
  resolutionText:          z.string().min(10),
  proposedBy:              z.string().uuid().optional(),
  secondedBy:              z.string().uuid().optional(),
  votesFor:                z.coerce.number().int().min(0).default(0),
  votesAgainst:            z.coerce.number().int().min(0).default(0),
  votesAbstain:            z.coerce.number().int().min(0).default(0),
  status:                  z.enum(['carried','defeated','tabled','deferred']).default('carried'),
  implementationDeadline:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  responsibleParty:        z.string().uuid().optional(),
  notes:                   z.string().optional(),
});

export const MeetingQuerySchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(20),
  status: z.string().optional(),
  type:   z.string().optional(),
});

export type CreateMeetingInput    = z.infer<typeof CreateMeetingSchema>;
export type UpdateMeetingInput    = z.infer<typeof UpdateMeetingSchema>;
export type RecordAttendanceInput = z.infer<typeof RecordAttendanceSchema>;
export type AddResolutionInput    = z.infer<typeof AddResolutionSchema>;
export type MeetingQueryInput     = z.infer<typeof MeetingQuerySchema>;

// ─── Service ──────────────────────────────────────────────────────────────────

export const meetingsService = {

  async list(ctx: TenantContext, params: MeetingQueryInput) {
    return withDb(ctx, async (client) => {
      const offset = (params.page - 1) * params.limit;
      const conditions: string[] = ['m.group_id = $1'];
      const args: unknown[] = [ctx.groupId];
      let p = 2;

      if (params.status) { conditions.push(`m.status = $${p++}`); args.push(params.status); }
      if (params.type)   { conditions.push(`m.meeting_type = $${p++}`); args.push(params.type); }

      const where = conditions.join(' AND ');

      const { rows: items } = await client.query(
        `SELECT m.*,
                cb.first_name || ' ' || cb.last_name AS created_by_name,
                ch.first_name || ' ' || ch.last_name AS chaired_by_name,
                (SELECT COUNT(*) FROM meeting_attendance ma WHERE ma.meeting_id=m.id AND ma.status='present') AS attendees_present,
                (SELECT COUNT(*) FROM meeting_resolutions mr WHERE mr.meeting_id=m.id) AS resolution_count
         FROM   meetings m
         JOIN   members cb ON cb.id = m.created_by
         LEFT JOIN members ch ON ch.id = m.chaired_by
         WHERE  ${where}
         ORDER  BY m.scheduled_at DESC
         LIMIT  $${p++} OFFSET $${p++}`,
        [...args, params.limit, offset],
      );
      const { rows: [{ count }] } = await client.query(
        `SELECT COUNT(*) FROM meetings m WHERE ${where}`, args,
      );
      return { items, total: Number(count), totalPages: Math.ceil(Number(count) / params.limit), page: params.page };
    });
  },

  async getById(ctx: TenantContext, id: string) {
    return withDb(ctx, async (client) => {
      const { rows: [meeting] } = await client.query(
        `SELECT m.*,
                cb.first_name || ' ' || cb.last_name AS created_by_name,
                ch.first_name || ' ' || ch.last_name AS chaired_by_name,
                sec.first_name || ' ' || sec.last_name AS secretary_name
         FROM   meetings m
         JOIN   members cb ON cb.id = m.created_by
         LEFT JOIN members ch  ON ch.id  = m.chaired_by
         LEFT JOIN members sec ON sec.id = m.secretary_id
         WHERE  m.id = $1 AND m.group_id = $2`,
        [id, ctx.groupId],
      );
      if (!meeting) throw new NotFoundError('Meeting', id);

      const { rows: attendance } = await client.query(
        `SELECT ma.*, m.first_name || ' ' || m.last_name AS member_name, m.phone AS member_phone
         FROM meeting_attendance ma
         JOIN members m ON m.id = ma.member_id
         WHERE ma.meeting_id = $1 ORDER BY m.first_name`,
        [id],
      );
      const { rows: resolutions } = await client.query(
        `SELECT mr.*,
                pb.first_name || ' ' || pb.last_name AS proposed_by_name,
                rp.first_name || ' ' || rp.last_name AS responsible_party_name
         FROM meeting_resolutions mr
         LEFT JOIN members pb ON pb.id = mr.proposed_by
         LEFT JOIN members rp ON rp.id = mr.responsible_party
         WHERE mr.meeting_id = $1 ORDER BY mr.sort_order`,
        [id],
      );
      return { ...meeting, attendance, resolutions };
    });
  },

  async create(ctx: TenantContext, data: CreateMeetingInput) {
    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO meetings
           (group_id, title, meeting_type, scheduled_at, venue, is_virtual,
            meeting_link, agenda, quorum_required, chaired_by, secretary_id,
            notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)
         RETURNING *`,
        [ctx.groupId, data.title, data.meetingType, data.scheduledAt,
         data.venue ?? null, data.isVirtual, data.meetingLink ?? null,
         JSON.stringify(data.agenda), data.quorumRequired ?? null,
         data.chairedBy ?? null, data.secretaryId ?? null,
         data.notes ?? null, ctx.userId],
      );
      return rows[0];
    });
  },

  async update(ctx: TenantContext, id: string, data: UpdateMeetingInput) {
    return withTransaction(ctx, async (client) => {
      const { rows: [meeting] } = await client.query(
        'SELECT * FROM meetings WHERE id=$1 AND group_id=$2', [id, ctx.groupId],
      );
      if (!meeting) throw new NotFoundError('Meeting', id);

      const updates: string[] = ['updated_at=now()'];
      const args: unknown[] = [];
      let p = 1;

      const fields: Record<string, unknown> = {
        title: data.title, status: data.status, scheduled_at: data.scheduledAt,
        venue: data.venue, is_virtual: data.isVirtual, meeting_link: data.meetingLink,
        minutes: data.minutes, quorum_achieved: data.quorumAchieved,
        chaired_by: data.chairedBy, secretary_id: data.secretaryId,
        notes: data.notes, ended_at: data.endedAt,
      };

      for (const [col, val] of Object.entries(fields)) {
        if (val !== undefined) {
          updates.push(`${col}=$${p++}`);
          args.push(val);
        }
      }
      if (data.agenda !== undefined) {
        updates.push(`agenda=$${p++}::jsonb`);
        args.push(JSON.stringify(data.agenda));
      }

      args.push(id, ctx.groupId);
      const { rows } = await client.query(
        `UPDATE meetings SET ${updates.join(',')} WHERE id=$${p++} AND group_id=$${p++} RETURNING *`,
        args,
      );
      return rows[0];
    });
  },

  async recordAttendance(ctx: TenantContext, meetingId: string, data: RecordAttendanceInput) {
    return withTransaction(ctx, async (client) => {
      const { rows: [meeting] } = await client.query(
        'SELECT * FROM meetings WHERE id=$1 AND group_id=$2', [meetingId, ctx.groupId],
      );
      if (!meeting) throw new NotFoundError('Meeting', meetingId);

      for (const a of data.attendance) {
        await client.query(
          `INSERT INTO meeting_attendance (meeting_id, group_id, member_id, status, excuse_reason, fine_amount, marked_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (meeting_id, member_id)
           DO UPDATE SET status=$4, excuse_reason=$5, fine_amount=$6, marked_by=$7, marked_at=now()`,
          [meetingId, ctx.groupId, a.memberId, a.status,
           a.excuseReason ?? null, a.fineAmount, ctx.userId],
        );
      }

      const { rows: [{ present }] } = await client.query(
        `SELECT COUNT(*) FILTER (WHERE status='present') AS present
         FROM meeting_attendance WHERE meeting_id=$1`,
        [meetingId],
      );
      await client.query(
        'UPDATE meetings SET quorum_achieved=$1, updated_at=now() WHERE id=$2',
        [Number(present), meetingId],
      );

      return { recorded: data.attendance.length, presentCount: Number(present) };
    });
  },

  async addResolution(ctx: TenantContext, meetingId: string, data: AddResolutionInput) {
    return withTransaction(ctx, async (client) => {
      const { rows: [meeting] } = await client.query(
        'SELECT * FROM meetings WHERE id=$1 AND group_id=$2', [meetingId, ctx.groupId],
      );
      if (!meeting) throw new NotFoundError('Meeting', meetingId);

      const { rows: [{ max_order }] } = await client.query(
        'SELECT COALESCE(MAX(sort_order),0) AS max_order FROM meeting_resolutions WHERE meeting_id=$1',
        [meetingId],
      );

      const { rows } = await client.query(
        `INSERT INTO meeting_resolutions
           (meeting_id, group_id, sort_order, resolution_text, proposed_by, seconded_by,
            votes_for, votes_against, votes_abstain, status,
            implementation_deadline, responsible_party, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [meetingId, ctx.groupId, Number(max_order) + 1, data.resolutionText,
         data.proposedBy ?? null, data.secondedBy ?? null,
         data.votesFor, data.votesAgainst, data.votesAbstain, data.status,
         data.implementationDeadline ?? null, data.responsibleParty ?? null,
         data.notes ?? null],
      );
      return rows[0];
    });
  },

  async getStats(ctx: TenantContext) {
    return withDb(ctx, async (client) => {
      const { rows: [s] } = await client.query(
        `SELECT
           COUNT(*)                                              AS total_meetings,
           COUNT(*) FILTER (WHERE status='completed')           AS completed,
           COUNT(*) FILTER (WHERE status='scheduled'
             AND scheduled_at > now())                          AS upcoming,
           COALESCE(AVG(quorum_achieved::float / NULLIF(quorum_required,0)) * 100, 0) AS avg_attendance_pct
         FROM meetings WHERE group_id=$1`,
        [ctx.groupId],
      );
      const { rows: [r] } = await client.query(
        `SELECT COUNT(*) AS total_resolutions,
                COUNT(*) FILTER (WHERE implemented=true) AS implemented
         FROM meeting_resolutions mr
         JOIN meetings m ON m.id=mr.meeting_id
         WHERE m.group_id=$1`,
        [ctx.groupId],
      );
      return {
        totalMeetings:      Number(s.total_meetings),
        completedMeetings:  Number(s.completed),
        upcomingMeetings:   Number(s.upcoming),
        avgAttendancePct:   Math.round(Number(s.avg_attendance_pct)),
        totalResolutions:   Number(r.total_resolutions),
        implementedResolutions: Number(r.implemented),
      };
    });
  },
};
