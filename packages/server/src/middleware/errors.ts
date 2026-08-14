// Central error type + Express error-handling middleware. Every service
// function throws AppError for expected failure modes (not found, forbidden,
// validation, conflict); the handler below maps those to the stable
// { error: { code, message, details } } envelope and the right HTTP status.
// Express 5 forwards rejected promises from async handlers to this
// middleware automatically, so route handlers don't need a try/catch or an
// asyncHandler wrapper.

import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'NOT_CAMPAIGN_MEMBER'
  | 'FORBIDDEN_ROLE'
  | 'FORBIDDEN_NOT_OWNER'
  | 'NOT_IN_BESTIARY'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  NOT_CAMPAIGN_MEMBER: 403,
  FORBIDDEN_ROLE: 403,
  FORBIDDEN_NOT_OWNER: 403,
  NOT_IN_BESTIARY: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export function notFound(what: string): AppError {
  return new AppError('NOT_FOUND', `${what} not found`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details ?? null } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request failed validation',
        details: err.issues,
      },
    });
    return;
  }

  console.error('[error]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error', details: null } });
}
