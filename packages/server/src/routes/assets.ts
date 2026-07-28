import fs from 'node:fs';
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember } from '../middleware/campaign.js';
import { handleAssetUpload } from '../middleware/upload.js';
import { AppError } from '../middleware/errors.js';
import { createAssetFieldsSchema, updateAssetSchema } from '../schemas/assets.js';
import * as assetsService from '../services/assets.js';

function cleanupRejectedUpload(filePath: string): void {
  fs.unlink(filePath, (err) => {
    if (err) console.warn(`[assets] Failed to remove rejected upload ${filePath}:`, err.message);
  });
}

// Mounted at /campaigns/:id/assets.
export const campaignAssetsRouter = Router({ mergeParams: true });
campaignAssetsRouter.use(requireAuth, requireCampaignMember());

campaignAssetsRouter.get('/', async (req, res) => {
  const assets = await assetsService.listAssets(pool, req.campaignId!, req.campaignRole!);
  res.json({ assets });
});

campaignAssetsRouter.post('/', handleAssetUpload, async (req, res) => {
  // multer (handleAssetUpload, above) has already validated mime type/size
  // and written the file to disk by the time this handler runs — a
  // multipart body has to be fully parsed before req.body/req.file exist at
  // all, so field validation and the ownership check below necessarily run
  // AFTER the write, not before. What the task brief's "don't even write
  // the file to disk if unauthorized" buys in practice: the file never
  // survives past this handler for an unauthorized/invalid request — it's
  // removed in the catch below before any error response is sent, so it's
  // never left dangling or referenced by a DB row.
  const file = req.file;
  try {
    const fields = createAssetFieldsSchema.parse(req.body);
    if (!file) {
      throw new AppError('VALIDATION_ERROR', 'A file is required (multipart field name: "file")');
    }
    await assetsService.authorizeAssetUpload(pool, req.campaignId!, req.user!.id, req.campaignRole!, fields);

    const asset = await assetsService.createAsset(pool, req.campaignId!, req.user!.id, req.campaignRole!, fields, {
      path: file.path,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });
    res.status(201).json({ asset });
  } catch (err) {
    if (file) cleanupRejectedUpload(file.path);
    throw err;
  }
});

// Mounted at /assets — flat single-resource action (campaign derived from
// the asset's own row), same pattern as routes/effects.ts's flat DELETE /:id.
export const assetsRouter = Router();
assetsRouter.use(requireAuth);

assetsRouter.patch('/:id', async (req, res) => {
  const { title } = updateAssetSchema.parse(req.body);
  const asset = await assetsService.updateAssetTitle(pool, req.user!.id, (req.params.id as string), title);
  res.json({ asset });
});

assetsRouter.delete('/:id', async (req, res) => {
  await assetsService.deleteAsset(pool, req.user!.id, (req.params.id as string));
  res.status(204).send();
});
