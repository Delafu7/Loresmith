// Multer configuration for campaign asset uploads (PLAN.md §3.5/§4.4,
// Phase 3.1 — images/file-upload foundation). Local disk storage under a
// gitignored packages/server/uploads/ directory, matching the project's
// existing no-cloud-dependency posture (Postgres+Redis are both local
// containers already).
//
// Security requirements (not a nice-to-have — path-traversal/collision risk
// is real if either of these is skipped):
//   1. The mime-type allowlist is enforced in `fileFilter`, which multer runs
//      BEFORE the file is written to disk — an unsupported mime type never
//      touches the filesystem.
//   2. Filenames are always crypto.randomUUID()-based, never the client-
//      supplied original filename.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AppError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// From src/middleware (or dist/middleware) up to the packages/server package
// root, then into uploads/ — same relative-path-from-this-file pattern as
// db/seeds/catalog.ts's SRD_DATA_ROOT.
export const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads');

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const ALLOWED_IMAGE_MIME_TYPES = Object.keys(MIME_EXTENSIONS);

// Default 5 MiB when unset, per the task brief; documented in .env.example
// and README's environment variables table.
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024;

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    // Mounted at /campaigns/:id/assets, so :id is always present by the time
    // multer runs (requireCampaignMember already validated it upstream).
    const campaignId = req.params.id;
    const dir = path.join(UPLOAD_ROOT, 'campaigns', String(campaignId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    // Never trust the client's original filename — extension is derived
    // from the already mime-allowlisted type, not from `file.originalname`.
    const ext = MIME_EXTENSIONS[file.mimetype];
    cb(null, `${crypto.randomUUID()}.${ext}`);
  },
});

export const assetUpload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter(_req, file, cb) {
    if (!MIME_EXTENSIONS[file.mimetype]) {
      cb(new AppError('VALIDATION_ERROR', `Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

// multer surfaces both fileFilter's thrown AppError and its own internal
// errors (e.g. MulterError LIMIT_FILE_SIZE for an oversized upload) via a
// callback, not a thrown/rejected promise — Express 5's automatic async
// rejection forwarding doesn't apply here, so this wrapper is what actually
// gets those errors to the shared errorHandler in the right shape.
export function handleAssetUpload(req: Request, res: Response, next: NextFunction): void {
  assetUpload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof AppError) {
      next(err);
      return;
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      next(new AppError('VALIDATION_ERROR', `File exceeds the ${MAX_UPLOAD_BYTES} byte upload limit`));
      return;
    }
    next(new AppError('VALIDATION_ERROR', err instanceof Error ? err.message : 'Upload failed'));
  });
}
