import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  PaymentRequiredError,
  FeatureGatedError,
  MemberCapError,
} from '@/lib/utils/errors';

describe('AppError', () => {
  it('sets message, code, and statusCode', () => {
    const err = new AppError('test error', 'TEST', 400);
    expect(err.message).toBe('test error');
    expect(err.code).toBe('TEST');
    expect(err.statusCode).toBe(400);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('NotFoundError', () => {
  it('returns 404 with resource and id', () => {
    const err = new NotFoundError('Loan', 'abc-123');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('abc-123');
  });

  it('returns 404 without id', () => {
    const err = new NotFoundError('Member');
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('Member');
  });
});

describe('UnauthorizedError', () => {
  it('returns 401', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('accepts custom message', () => {
    const err = new UnauthorizedError('Token expired');
    expect(err.message).toBe('Token expired');
  });
});

describe('ForbiddenError', () => {
  it('returns 403', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });
});

describe('ValidationError', () => {
  it('returns 422', () => {
    const err = new ValidationError('Amount must be positive');
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('Amount must be positive');
  });
});

describe('ConflictError', () => {
  it('returns 409', () => {
    const err = new ConflictError('Duplicate M-Pesa receipt');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
  });
});

describe('PaymentRequiredError', () => {
  it('returns 402', () => {
    const err = new PaymentRequiredError('Subscription required');
    expect(err.statusCode).toBe(402);
    expect(err.code).toBe('PAYMENT_REQUIRED');
  });
});

describe('FeatureGatedError', () => {
  it('returns 403 and includes feature and plan names', () => {
    const err = new FeatureGatedError('SMS campaigns', 'Pro');
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('SMS campaigns');
    expect(err.message).toContain('Pro');
  });
});

describe('MemberCapError', () => {
  it('returns 403 and includes the cap number', () => {
    const err = new MemberCapError(50);
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('50');
  });
});

describe('Error hierarchy', () => {
  it('all custom errors are instances of AppError and Error', () => {
    const errors = [
      new NotFoundError('X'),
      new UnauthorizedError(),
      new ForbiddenError(),
      new ValidationError('x'),
      new ConflictError('x'),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toBeInstanceOf(Error);
    }
  });
});
