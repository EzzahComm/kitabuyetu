import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { consumeOrganizationSignupCode, readOrganizationSignupJson } from '@/lib/auth/organization-signup';
import { withAdminDb } from '@/lib/db';
import { assignOrganizationPlanInTx } from '@/lib/services/organization-plan.service';
import { RegisterOrganizationSchema } from '@/lib/validators/auth.schema';
import { normalizePhone } from '@/lib/utils/phone';
import { created, handleError } from '@/lib/utils/response';
import { AppError, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import { emitActivity, ActivityEventType } from '@/lib/notifications';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? '10', 10);

interface RegisteredOrganization {
  organization_id: string;
  organization_name: string;
  member_id: string;
}

function existingAccount(): AppError {
  return new AppError(
    'This email or phone already belongs to an account. Sign in or contact support to set up your organization.',
    'EXISTING_ACCOUNT',
    409,
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const input = RegisterOrganizationSchema.parse(await readOrganizationSignupJson(request));
    if (!(await consumeOrganizationSignupCode(input.email, input.verificationCode))) {
      throw new ValidationError('The code is invalid or expired. Request a new code and try again.');
    }

    const phone = normalizePhone(input.phone);
    const organizationPhone = input.organizationPhone ? normalizePhone(input.organizationPhone) : '';
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const { verificationCode: _code, password: _password, planType, ...signup } = input;

    const result = await withAdminDb(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['enterprise-signup:' + input.email]);
      const existing = await db.query('SELECT 1 FROM members WHERE lower(email) = $1 OR phone = $2 LIMIT 1', [
        input.email,
        phone,
      ]);
      if (existing.rows.length) throw existingAccount();

      const { rows } = await db.query<{ registration: RegisteredOrganization }>(
        'SELECT register_organization($1::jsonb) AS registration',
        [JSON.stringify({ ...signup, phone, organizationPhone, passwordHash })],
      );
      const { registration } = rows[0];
      await db.query('UPDATE members SET email_verified = true WHERE id = $1', [registration.member_id]);
      await assignOrganizationPlanInTx(db, registration.organization_id, planType, registration.member_id, {
        notes: 'Self-serve signup',
      });
      return registration;
    });

    await emitActivity({
      type: ActivityEventType.ORGANIZATION_CREATED,
      dedupKey: `org-register:${result.organization_id}`,
      actor: { userId: result.member_id, role: 'organization_coordinator' },
      organization: { id: result.organization_id, name: result.organization_name },
      notify: false,
      metadata: {
        organizationType: input.organizationType,
        planType,
        registrationMethod: 'Enterprise self-serve signup',
      },
    }).catch(() => logger.warn('[register-organization] could not record signup activity'));

    return created({
      organizationId: result.organization_id,
      organizationName: result.organization_name,
      planType,
      nextStep: 'enterprise_login',
    });
  } catch (error) {
    const databaseError = error as { code?: string; constraint?: string };
    if (databaseError?.code === '23505' && /^members_.*(?:phone|email)/.test(databaseError.constraint ?? '')) {
      return handleError(existingAccount());
    }
    return handleError(error);
  }
}
