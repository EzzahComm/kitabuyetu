import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { normalizePhone, isValidKenyanPhone } from '@/lib/utils/phone';
import { sendText, isWhatsAppConfigured } from '@/lib/integrations/whatsapp-client';
import type {
  SendWhatsAppMessageInput, WhatsAppQueryInput, WhatsAppMessageStatus,
} from '@/lib/validators/whatsapp.schema';

// ── Public types ────────────────────────────────────────────────────────

export interface WhatsAppMessage {
  id:              string;
  group_id:        string;
  member_id:       string | null;
  direction:       'outbound' | 'inbound';
  to_phone:        string;
  from_phone:      string | null;
  message_type:    string;
  body:            string | null;
  template_name:   string | null;
  template_vars:   unknown;
  status:          WhatsAppMessageStatus;
  wa_message_id:   string | null;
  error_code:      string | null;
  error_message:   string | null;
  sent_by:         string | null;
  sent_at:         string | null;
  delivered_at:    string | null;
  read_at:         string | null;
  failed_at:       string | null;
  created_at:      string;

  // Joined fields for list/detail views.
  member_first_name?: string | null;
  member_last_name?:  string | null;
}

// ── Service ────────────────────────────────────────────────────────────

export const whatsappService = {

  /** Whether the Cloud API is configured. UI uses this to render a banner. */
  isConfigured(): boolean {
    return isWhatsAppConfigured();
  },

  /**
   * Send a text message. Resolves the recipient (memberId → phone, or raw
   * phone), pushes through the Meta client, and writes the audit row in a
   * single transaction. When env isn't configured the row is still written
   * with status='dry_run' so the UI works locally.
   */
  async send(ctx: TenantContext, input: SendWhatsAppMessageInput): Promise<WhatsAppMessage> {
    return withTransaction(ctx, async (client) => {
      let memberId: string | null = input.memberId ?? null;
      let toPhone:  string;

      if (memberId) {
        const member = await fetchGroupMemberWithPhone(client, ctx.groupId, memberId);
        toPhone = member.phone;
      } else if (input.toPhone) {
        if (!isValidKenyanPhone(input.toPhone)) {
          throw new ValidationError('toPhone is not a valid Kenyan phone number');
        }
        toPhone = normalizePhone(input.toPhone);

        // If the phone happens to match a member of this group, link the row.
        const linked = await fetchMemberByPhoneIfInGroup(client, ctx.groupId, toPhone);
        if (linked) memberId = linked;
      } else {
        throw new ValidationError('Either memberId or toPhone is required');
      }

      // Hit Meta first — we want the provider's verdict before deciding the
      // row status. Failures still get logged (status='failed') so users can
      // see what happened.
      const result = await sendText({ to: toPhone, body: input.body });

      const status: WhatsAppMessageStatus =
        result.status === 'sent'    ? 'sent'
      : result.status === 'failed'  ? 'failed'
      : 'dry_run';

      const { rows } = await client.query<WhatsAppMessage>(
        `INSERT INTO whatsapp_messages (
           group_id, member_id, direction, to_phone,
           message_type, body, status, wa_message_id,
           error_code, error_message,
           sent_by, sent_at, failed_at
         ) VALUES (
           $1, $2, 'outbound', $3,
           'text', $4, $5::whatsapp_message_status, $6,
           $7, $8,
           $9,
           CASE WHEN $5 IN ('sent', 'dry_run') THEN NOW() ELSE NULL END,
           CASE WHEN $5 = 'failed'              THEN NOW() ELSE NULL END
         )
         RETURNING *`,
        [
          ctx.groupId, memberId, toPhone,
          input.body, status,
          result.status === 'sent' ? result.waMessageId : null,
          result.status === 'failed' ? result.errorCode    : null,
          result.status === 'failed' ? result.errorMessage : null,
          ctx.userId,
        ],
      );

      // Audit-log only the act of sending; the message body itself is
      // already in whatsapp_messages so we don't duplicate it here.
      await writeAuditLog(client, ctx, 'whatsapp.send', rows[0].id, {
        to_phone: toPhone,
        member_id: memberId,
        status,
        wa_message_id: result.status === 'sent' ? result.waMessageId : null,
      });

      return rows[0];
    });
  },

  async list(ctx: TenantContext, params: WhatsAppQueryInput) {
    return withDb(ctx, async (client) => {
      const offset = (params.page - 1) * params.limit;
      const conds: string[] = ['w.group_id = $1'];
      const vals:  unknown[] = [ctx.groupId];
      if (params.status)    { conds.push(`w.status    = $${vals.length + 1}::whatsapp_message_status`);    vals.push(params.status); }
      if (params.direction) { conds.push(`w.direction = $${vals.length + 1}::whatsapp_message_direction`); vals.push(params.direction); }
      if (params.memberId)  { conds.push(`w.member_id = $${vals.length + 1}`); vals.push(params.memberId); }

      const where = conds.join(' AND ');

      const [{ rows: cnt }, { rows: items }] = await Promise.all([
        client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM whatsapp_messages w WHERE ${where}`, vals),
        client.query<WhatsAppMessage>(
          `SELECT w.*,
                  m.first_name AS member_first_name,
                  m.last_name  AS member_last_name
             FROM whatsapp_messages w
        LEFT JOIN members m ON m.id = w.member_id
            WHERE ${where}
            ORDER BY w.created_at DESC
            LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
          [...vals, params.limit, offset],
        ),
      ]);

      const total = parseInt(cnt[0].count, 10);
      return {
        items, total,
        page: params.page, pageSize: params.limit,
        totalPages: Math.max(1, Math.ceil(total / params.limit)),
      };
    });
  },

  async get(ctx: TenantContext, id: string): Promise<WhatsAppMessage> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<WhatsAppMessage>(
        `SELECT w.*,
                m.first_name AS member_first_name,
                m.last_name  AS member_last_name
           FROM whatsapp_messages w
      LEFT JOIN members m ON m.id = w.member_id
          WHERE w.group_id = $1 AND w.id = $2`,
        [ctx.groupId, id],
      );
      if (!rows[0]) throw new NotFoundError('WhatsApp message', id);
      return rows[0];
    });
  },
};

// ── Helpers ────────────────────────────────────────────────────────────

async function fetchGroupMemberWithPhone(
  client:  PoolClient,
  groupId: string,
  memberId: string,
): Promise<{ id: string; phone: string }> {
  const { rows } = await client.query<{ id: string; phone: string }>(
    `SELECT m.id, m.phone
       FROM members m
       JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $1
      WHERE m.id = $2`,
    [groupId, memberId],
  );
  if (!rows[0])         throw new NotFoundError('Group member', memberId);
  if (!rows[0].phone)   throw new ValidationError('Member has no phone number on file');
  return rows[0];
}

async function fetchMemberByPhoneIfInGroup(
  client:  PoolClient,
  groupId: string,
  phone:   string,
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT m.id
       FROM members m
       JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $1
      WHERE m.phone = $2
      LIMIT 1`,
    [groupId, phone],
  );
  return rows[0]?.id ?? null;
}

async function writeAuditLog(
  client: PoolClient,
  ctx:    TenantContext,
  action: string,
  resourceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
     VALUES ($1, $2, $3, 'whatsapp_message', $4, $5::jsonb)`,
    [ctx.groupId, ctx.userId, action, resourceId, JSON.stringify(payload)],
  );
}
