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
