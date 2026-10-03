/**
 * Optional sign-up data written AFTER register_group()/create_additional_group()
 * has committed: the contribution plan, and the government-registration flag
 * with its number and certificate. All of it is deliberately non-fatal - the
 * group exists either way, registration data is optional, and an officer can
 * supply it later from Settings if a write fails here.
 */
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { registrationCertificatePath, uploadGroupDocument } from '@/lib/supabase/group-document-storage';
import type { CertificateUpload } from '@/lib/utils/signup-request';
import { contributionPlanService } from './contribution-plan.service';

export interface GroupSignupExtras {
  product: string;
  groupId: string;
  memberId: string;
  role: string;
  monthlyContribution?: number;
  welfareAmount?: number;
  isGovernmentRegistered?: boolean;
  registrationNumber?: string;
  /** A validated PDF (see checkCertificate). Only stored when the group is flagged registered. */
  certificate?: CertificateUpload;
}

export interface GroupSignupExtrasResult {
  certificateStored: boolean;
}

export async function applyGroupSignupExtras(x: GroupSignupExtras, logTag: string): Promise<GroupSignupExtrasResult> {
  const monthlyContribution = x.monthlyContribution ?? 0;
  const welfareAmount = x.welfareAmount ?? 0;

  // chama_reminder has no ledger, and a blank plan writes no row rather than an inert 0/0 one.
  if (x.product === 'kitabu_yetu' && (monthlyContribution > 0 || welfareAmount > 0)) {
    try {
      await contributionPlanService.setGroupPlanOverride(
        { userId: x.memberId, groupId: x.groupId, role: x.role },
        { monthlyContribution, welfareAmount },
      );
    } catch (err) {
      logger.error(`[${logTag}] failed to set initial contribution plan (non-fatal)`, err);
    }
  }

  if (!x.isGovernmentRegistered) return { certificateStored: false };

  let certificatePath: string | null = null;
  if (x.certificate) {
    const path = registrationCertificatePath(x.groupId);
    try {
      await uploadGroupDocument(path, x.certificate.buffer, x.certificate.contentType);
      certificatePath = path;
    } catch (err) {
      logger.error(`[${logTag}] failed to store registration certificate (non-fatal)`, err);
    }
  }

  try {
    await withAdminDb((client) =>
      client.query(
        `UPDATE groups
            SET is_government_registered = true,
                registration_number = $1,
                registration_certificate_url = $2
          WHERE id = $3`,
        [x.registrationNumber?.trim() || null, certificatePath, x.groupId],
      ),
    );
  } catch (err) {
    logger.error(`[${logTag}] failed to set registration status (non-fatal)`, err);
    // The object is stored but nothing points at it, so do not report it as saved.
    certificatePath = null;
  }

  return { certificateStored: certificatePath !== null };
}
