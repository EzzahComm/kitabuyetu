/**
 * Group registration status — groups.is_government_registered /
 * registration_number / registration_certificate_url / registration_date
 * (columns from migrations 033 and 074; nothing wrote them until sign-up and
 * Settings did). Entirely optional and non-blocking by design — a group can
 * onboard, subscribe and use every feature with this unset, and can add or
 * change it later from Settings.
 *
 * Writes here run as the tenant role, so the database's own `groups_update`
 * policy applies: only the group's chairperson may update the group record. The
 * routes enforce the same rule up front. (Sign-up writes the same columns through
 * the admin pool, in lib/services/group-signup-extras.ts, before any officer
 * session exists.)
 */
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import {
  createGroupDocumentSignedUrl,
  registrationCertificatePath,
  uploadGroupDocument,
} from '@/lib/supabase/group-document-storage';
import { ValidationError } from '@/lib/utils/errors';

export interface GroupRegistrationStatus {
  isGovernmentRegistered: boolean;
  registrationNumber: string | null;
  registrationDate: string | null;
  /** Short-lived signed URL, minted fresh on every read — never a stored public link. */
  certificateUrl: string | null;
}

interface GroupRegistrationRow {
  is_government_registered: boolean;
  registration_number: string | null;
  registration_date: string | null;
  registration_certificate_url: string | null;
}

async function toStatus(row: GroupRegistrationRow): Promise<GroupRegistrationStatus> {
  let certificateUrl: string | null = null;
  if (row.registration_certificate_url) {
    try {
      certificateUrl = await createGroupDocumentSignedUrl(row.registration_certificate_url);
    } catch {
      // Storage hiccup — the group's own status fields are still real and
      // useful; just surface no link rather than failing the whole read.
      certificateUrl = null;
    }
  }
  return {
    isGovernmentRegistered: row.is_government_registered,
    registrationNumber: row.registration_number,
    registrationDate: row.registration_date,
    certificateUrl,
  };
}

export const groupRegistrationService = {
  async get(ctx: TenantContext): Promise<GroupRegistrationStatus> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<GroupRegistrationRow>(
        `SELECT is_government_registered, registration_number, registration_date, registration_certificate_url
         FROM groups WHERE id = $1`,
        [ctx.groupId],
      );
      return toStatus(
        rows[0] ?? {
          is_government_registered: false,
          registration_number: null,
          registration_date: null,
          registration_certificate_url: null,
        },
      );
    });
  },

  /** Chairperson-only (gated at the route). registrationNumber may be blank — a group can flag itself registered and add the number later. */
  async setStatus(
    ctx: TenantContext,
    input: { isGovernmentRegistered: boolean; registrationNumber: string | null },
  ): Promise<GroupRegistrationStatus> {
    const registrationNumber = input.isGovernmentRegistered ? input.registrationNumber?.trim() || null : null;
    return withTransaction(ctx, async (client) => {
      // Flipping the flag off clears the number and certificate together —
      // the CHECK constraint on registration_date mirrors this for dates, and
      // leaving a stale number/cert behind a false flag would be the
      // confusing state (the CHECK constraint doesn't reach the cert URL,
      // which this keeps consistent by hand).
      const { rows } = await client.query<GroupRegistrationRow>(
        `UPDATE groups
         SET is_government_registered = $1::boolean,
             registration_number = $2,
             registration_certificate_url = CASE WHEN $1::boolean THEN registration_certificate_url ELSE NULL END,
             registration_date = CASE WHEN $1::boolean THEN registration_date ELSE NULL END
         WHERE id = $3
         RETURNING is_government_registered, registration_number, registration_date, registration_certificate_url`,
        [input.isGovernmentRegistered, registrationNumber, ctx.groupId],
      );
      // Zero rows means RLS filtered the update out (not the group's chairperson)
      // or the group is gone — never a silent success.
      if (!rows[0]) throw new ValidationError('Group not found');

      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
         VALUES ($1, $2, 'group.registration_status_update', 'group', $1, $3::jsonb)`,
        [
          ctx.groupId,
          ctx.userId,
          JSON.stringify({ isGovernmentRegistered: input.isGovernmentRegistered, registrationNumber }),
        ],
      );

      return toStatus(rows[0]);
    });
  },

  /** Chairperson-only (gated at the route). Marks the group registered — a certificate implies the flag, even if the number was never entered. */
  async setCertificate(
    ctx: TenantContext,
    file: { buffer: Buffer; contentType: string },
  ): Promise<GroupRegistrationStatus> {
    const path = registrationCertificatePath(ctx.groupId);
    await uploadGroupDocument(path, file.buffer, file.contentType);

    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query<GroupRegistrationRow>(
        `UPDATE groups
         SET is_government_registered = true, registration_certificate_url = $1
         WHERE id = $2
         RETURNING is_government_registered, registration_number, registration_date, registration_certificate_url`,
        [path, ctx.groupId],
      );
      if (!rows[0]) throw new ValidationError('Group not found');

      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
         VALUES ($1, $2, 'group.registration_certificate_upload', 'group', $1, $3::jsonb)`,
        [ctx.groupId, ctx.userId, JSON.stringify({ path })],
      );

      return toStatus(rows[0]);
    });
  },
};
