import { PRODUCT_LABEL, type SubscriptionProduct } from '@/types/enums';

export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} with id '${id}' not found` : `${resource} not found`,
      'NOT_FOUND',
      404,
    );
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'ForbiddenError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 422);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
  }
}

export class PaymentRequiredError extends AppError {
  constructor(message: string) {
    super(message, 'PAYMENT_REQUIRED', 402);
    this.name = 'PaymentRequiredError';
  }
}

/**
 * The group is paying — just not for the product this route belongs to
 * (migration 140 / lib/auth/subscription-gate.ts).
 *
 * 402 rather than 403 because this is an entitlement condition with the same
 * remedy as PAYMENT_REQUIRED — pay — and 403 would collide with
 * requirePermission's ForbiddenError and read as an RBAC bug in triage. The
 * distinct code is what lets a client route a Chama Reminder user to their own
 * subscribe page instead of Kitabu Yetu's billing page.
 */
export class ProductNotEntitledError extends AppError {
  constructor(product: SubscriptionProduct) {
    super(
      `This area requires an active ${PRODUCT_LABEL[product]} subscription.`,
      'PRODUCT_NOT_ENTITLED',
      402,
    );
    this.name = 'ProductNotEntitledError';
  }
}

export class FeatureGatedError extends AppError {
  constructor(feature: string, requiredPlan: string) {
    super(
      `'${feature}' requires the ${requiredPlan} plan or higher`,
      'FEATURE_GATED',
      403,
    );
    this.name = 'FeatureGatedError';
  }
}

export class MemberCapError extends AppError {
  constructor(cap: number) {
    super(
      `Your plan allows a maximum of ${cap} members. Upgrade to add more.`,
      'MEMBER_CAP_REACHED',
      403,
    );
    this.name = 'MemberCapError';
  }
}

/**
 * Organization plan cap — deliberately NOT MemberCapError's wording reused.
 * "Upgrade to add more" is wrong here: an organization can never self-serve
 * upgrade (only super_admin assigns/changes an organization's plan), so the
 * remedy has to say so.
 */
export class OrganizationCapError extends AppError {
  constructor(resource: string, cap: number) {
    super(
      `Your organization's plan allows a maximum of ${cap} ${resource}. Contact Kitabu Yetu to change your plan.`,
      'ORGANIZATION_CAP_REACHED',
      403,
    );
    this.name = 'OrganizationCapError';
  }
}

/** Same reasoning as OrganizationCapError — mirrors FeatureGatedError with organization-correct remedy wording. */
export class OrganizationFeatureGatedError extends AppError {
  constructor(feature: string, requiredPlan: string) {
    super(
      `'${feature}' requires the ${requiredPlan} plan. Contact Kitabu Yetu to change your plan.`,
      'ORGANIZATION_FEATURE_GATED',
      403,
    );
    this.name = 'OrganizationFeatureGatedError';
  }
}

export class InsufficientSmsCreditsError extends AppError {
  constructor() {
    super('Insufficient SMS credits. Please top up your balance.', 'INSUFFICIENT_SMS_CREDITS', 402);
    this.name = 'InsufficientSmsCreditsError';
  }
}

export class NotImplementedError extends AppError {
  constructor(message = 'This feature is not configured yet.') {
    super(message, 'NOT_IMPLEMENTED', 501);
    this.name = 'NotImplementedError';
  }
}

/**
 * The caller is over a quota or velocity ceiling. Matches the code/status the
 * route-level SMS limiter already returns (lib/sms/rate-limit.ts), so a cap
 * hit looks the same to a client whether it was caught at the route or deeper
 * in the service layer.
 */
export class RateLimitedError extends AppError {
  constructor(message = 'Rate limit exceeded. Please try again later.') {
    super(message, 'RATE_LIMITED', 429);
    this.name = 'RateLimitedError';
  }
}

/**
 * A capability is deliberately, temporarily unavailable — an operator halt,
 * not a fault and not the caller's problem.
 *
 * 503 rather than 402 matters beyond correctness of the status line:
 * lib/sms/trigger-engine.ts fail-fasts on statusCode 402 (billing failures
 * are deterministic, so retrying wastes the attempt budget) and
 * sms_trigger_executions is append-only, so an execution settled terminal can
 * never be retried or corrected. Mapping an operator halt to 402 would
 * therefore burn every automation that fired during the halt, permanently.
 * 503 keeps it transient, which is exactly what a halt is.
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'This service is temporarily unavailable. Please try again later.') {
    super(message, 'SERVICE_UNAVAILABLE', 503);
    this.name = 'ServiceUnavailableError';
  }
}
