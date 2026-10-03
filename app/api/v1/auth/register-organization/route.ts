export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import bcrypt from 'bcryptjs';
import { withAdminDb } from '@/lib/db';
import { RegisterOrganizationSchema } from '@/lib/validators/auth.schema';
import { normalizePhone } from '@/lib/utils/phone';
import { created, handleError, errorResponse } from '@/lib/utils/response';
import { AppError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import { emitActivity, ActivityEventType } from '@/lib/notifications';
import { assignOrganizationPlan } from '@/lib/services/organization-plan.service';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? '10', 10);

type Stage = 'validate_input' | 'normalize_phone' | 'hash_password' | 'call_register_organization_rpc' | 'assign_plan';

interface RegisterOrganizationResult {
  success: true;
  organization_id: string;
  organization_name: string;
  member_id: string;
  organization_member_id: string;
  platform_role: string;
}

/**
 * POST /api/v1/auth/register-organization - Enterprise self-serve signup.
 *
 * True instant self-serve, by deliberate choice: organization_subscriptions'
 * own RLS policy documents "organizations never self-serve a plan... only
 * super_admin creates organizations" - this route reverses that for the
 * public signup path specifically, reaching the RLS-protected tables the
 * same way register_group already does for an anonymous registrant
 * (SECURITY DEFINER RPC via withAdminDb's privileged connection, not by
 * broadening the RLS policy text itself).
 *
 * Does NOT issue a session token. Organization-coordinator login is a
 * separate, mandatory-MFA backoffice flow (app/(auth)/enterprise/login) that
 * this route doesn't replicate - first-time MFA enrollment happens there.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let stage: Stage = 'validate_input';
  try {
    const body = await req.json();
    const input = RegisterOrganizationSchema.parse(body);

    stage = 'normalize_phone';
    const phone = normalizePhone(input.phone);
    const organizationPhone = input.organizationPhone ? normalizePhone(input.organizationPhone) : null;

    stage = 'hash_password';
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    // ── Atomic RPC: organization + coordinator account + organization_members
    //    link. Plan assignment is deliberately a separate step below - see
    //    this route's and the RPC's own comments.
    stage = 'call_register_organization_rpc';
    const rpcPayload = {
      organizationName: input.organizationName,
      organizationType: input.organizationType,
      registrationNumber: input.registrationNumber || '',
      organizationPhone: organizationPhone ?? '',
      organizationEmail: input.organizationEmail || '',
      county: input.county || '',
      address: input.address || '',
      firstName: input.firstName,
      lastName: input.lastName,
      phone,
      email: input.email,
      passwordHash,
    };

    const result = await withAdminDb(async (client) => {
      const { rows } = await client.query<{ register_organization: RegisterOrganizationResult }>(
        'SELECT register_organization($1::jsonb) AS register_organization',
        [JSON.stringify(rpcPayload)],
      );
      return rows[0].register_organization;
    });

    stage = 'assign_plan';
    await assignOrganizationPlan(result.organization_id, input.planType, result.member_id, {
      notes: 'Self-serve signup',
    });

    // Administrator alert - ORGANIZATION_CREATED existed but had no real
    // caller yet; this is its first one.
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    await emitActivity({
      type: ActivityEventType.ORGANIZATION_CREATED,
      dedupKey: `org-register:${result.organization_id}`,
      actor: {
        userId: result.member_id,
        name: `${input.firstName} ${input.lastName}`.trim(),
        email: input.email,
        phone,
        role: 'organization_coordinator',
      },
      ipAddress: clientIp,
      userAgent: req.headers.get('user-agent'),
      metadata: {
        organizationType: input.organizationType,
        planType: input.planType,
        registrationMethod: 'Enterprise self-serve sign-up',
        smsLines: [`Organization: ${result.organization_name}`, `Plan: ${input.planType}`],
      },
    });

    return created({
      organizationId: result.organization_id,
      organizationName: result.organization_name,
      planType: input.planType,
      // No tokens - client should route the new coordinator to
      // /enterprise/login to complete MFA enrollment and sign in.
      nextStep: 'enterprise_login',
    });
  } catch (err) {
    const e = err as {
      code?: string;
      message?: string;
      detail?: string;
      hint?: string;
      constraint?: string;
      stack?: string;
    };

    logger.error('[register-organization] failed', {
      stage,
      pg_code: e?.code,
      message: e?.message,
      detail: e?.detail,
      hint: e?.hint,
      constraint: e?.constraint,
      stack: e?.stack,
    });

    if (err instanceof ZodError || err instanceof AppError) return handleError(err);

    // PG unique violation: most likely duplicate phone (members.phone is UNIQUE).
    if (e?.code === '23505') {
      if (e.constraint?.includes('phone')) {
        return errorResponse('Phone number already registered', 'DUPLICATE_PHONE', 409);
      }
      return handleError(err);
    }

    if (e?.code === '23503') return handleError(err);

    // RPC-raised invalid-input errors (SQLSTATE 22023)
    if (e?.code === '22023') {
      return errorResponse(e.message ?? 'Invalid input', 'INVALID_INPUT', 400);
    }

    return errorResponse(
      'Organization registration failed. Please try again or contact support.',
      'ORGANIZATION_REGISTRATION_FAILED',
      500,
    );
  }
}
