import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from './errors';
import type { ApiSuccess, ApiError } from '@/types/api.types';

export function ok<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

export function created<T>(data: T): NextResponse<ApiSuccess<T>> {
  return ok(data, 201);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function errorResponse(
  message: string,
  code: string,
  status = 400,
): NextResponse<ApiError> {
  return NextResponse.json({ success: false, error: message, code }, { status });
}

export function badRequest(message = 'Bad request'): NextResponse<ApiError> {
  return errorResponse(message, 'BAD_REQUEST', 400);
}

export function notFound(message = 'Not found'): NextResponse<ApiError> {
  return errorResponse(message, 'NOT_FOUND', 404);
}

export function handleError(err: unknown): NextResponse<ApiError> {
  if (err instanceof AppError) {
    return errorResponse(err.message, err.code, err.statusCode);
  }

  if (err instanceof ZodError) {
    const message = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    return errorResponse(message, 'VALIDATION_ERROR', 422);
  }

  // PostgreSQL unique violation
  if (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === '23505'
  ) {
    return errorResponse('A record with these details already exists', 'DUPLICATE', 409);
  }

  // PostgreSQL foreign key violation
  if (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === '23503'
  ) {
    return errorResponse('Referenced record does not exist', 'FOREIGN_KEY', 400);
  }

  console.error('[unhandled error]', err);
  return errorResponse('An unexpected error occurred', 'INTERNAL_ERROR', 500);
}
