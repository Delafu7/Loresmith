// CSRF defense-in-depth per PLAN.md §4.1: "SameSite=Lax + a custom header
// check on state-changing routes". SameSite=Lax already blocks cross-site
// POSTs from being sent with the cookie in modern browsers, but this is a
// second, independent layer — a plain HTML form or <img>/<script> cross-site
// request cannot attach a custom header at all (only same-origin fetch/XHR
// can), so requiring one catches the case even if a browser's SameSite
// handling is ever weakened or misconfigured.
import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method) || req.headers['x-requested-with']) {
    next();
    return;
  }
  next(new AppError('VALIDATION_ERROR', 'Missing required X-Requested-With header on a state-changing request'));
}
