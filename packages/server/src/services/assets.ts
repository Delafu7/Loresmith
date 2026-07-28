// campaign_assets service (PLAN.md §3.5/§4.4, Phase 3.1 — images/file-upload
// foundation only; creatures/battle-map/dice-roller/armor are later phases
// and are not touched here).

import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { UPLOAD_ROOT } from '../middleware/upload.js';
import { requireMembership, type CampaignRole } from './authz.js';
import { fetchCharacterOrThrow, authorizeCharacterMutation } from './characters.js';
import type { CreateAssetFieldsInput } from '../schemas/assets.js';

interface AssetRow {
  id: string;
  campaign_id: string;
  uploaded_by_user_id: string;
  asset_type: 'image' | 'handout';
  file_url: string;
  mime_type: string;
  file_size_bytes: number;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export async function listAssets(pool: Pool, campaignId: string, _role: CampaignRole): Promise<AssetRow[]> {
  const result = await pool.query<AssetRow>(
    `SELECT * FROM campaign_assets WHERE campaign_id = $1 ORDER BY created_at DESC`,
    [campaignId],
  );
  return result.rows;
}

export interface UploadedFileInfo {
  path: string; // absolute path on disk, e.g. .../uploads/campaigns/3/<uuid>.png
  mimeType: string;
  sizeBytes: number;
}

/**
 * Layer 2+3+4 for POST /campaigns/:id/assets: DM is always allowed. A player
 * is allowed only when explicitly targeting their OWN character's portrait
 * (characterId must be present and owned by them) — never a bare upload with
 * no target, and never someone else's character. Called BEFORE the file is
 * written to disk by the route (see routes/assets.ts), so an unauthorized
 * request never leaves a file behind.
 */
export async function authorizeAssetUpload(
  pool: Pool,
  campaignId: string,
  actorId: string,
  role: CampaignRole,
  fields: CreateAssetFieldsInput,
): Promise<void> {
  if (role === 'dm') return;

  if (fields.characterId === undefined) {
    throw new AppError('FORBIDDEN_ROLE', 'Players may only upload an image for their own character\'s portrait');
  }
  const character = await fetchCharacterOrThrow(pool, fields.characterId);
  if (character.campaign_id !== campaignId) {
    // Cross-campaign consistency (characterId's row must belong to this
    // same campaign) is a service-layer check, not a DB constraint — same
    // "app-layer, not declarative" precedent as PLAN.md §3.5's
    // art_asset_id/owning_campaign_id note for homebrew monsters.
    throw notFound('Character');
  }
  // Throws FORBIDDEN_NOT_OWNER unless actorId owns this character (DMs
  // already returned above, so this only ever runs for a player).
  await authorizeCharacterMutation(pool, actorId, character);
}

export async function createAsset(
  pool: Pool,
  campaignId: string,
  actorId: string,
  _role: CampaignRole,
  fields: CreateAssetFieldsInput,
  file: UploadedFileInfo,
): Promise<AssetRow> {
  const fileUrl = `/uploads/campaigns/${campaignId}/${path.basename(file.path)}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query<AssetRow>(
      `INSERT INTO campaign_assets
         (campaign_id, uploaded_by_user_id, asset_type, file_url, mime_type, file_size_bytes, title)
       VALUES ($1,$2,'image',$3,$4,$5,$6)
       RETURNING *`,
      [campaignId, actorId, fileUrl, file.mimeType, file.sizeBytes, fields.title ?? null],
    );
    const asset = inserted.rows[0]!;

    // A characterId targeting an image upload is always a portrait set in
    // this phase (there is no other character-targeted asset use yet).
    if (fields.characterId !== undefined) {
      await client.query(`UPDATE characters SET portrait_asset_id = $1, updated_at = now() WHERE id = $2`, [
        asset.id,
        fields.characterId,
      ]);
    }

    await client.query('COMMIT');
    return asset;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function fetchAssetOrThrow(pool: Pool, assetId: string): Promise<AssetRow> {
  const result = await pool.query<AssetRow>(`SELECT * FROM campaign_assets WHERE id = $1`, [assetId]);
  const row = result.rows[0];
  if (!row) throw notFound('Asset');
  return row;
}

export async function updateAssetTitle(pool: Pool, actorId: string, assetId: string, title: string): Promise<AssetRow> {
  const asset = await fetchAssetOrThrow(pool, assetId);
  const role = await requireMembership(pool, asset.campaign_id, actorId);
  // Same rule as deleteAsset: DM of the owning campaign, OR the original
  // uploader, may rename.
  if (role !== 'dm' && asset.uploaded_by_user_id !== actorId) {
    throw new AppError('FORBIDDEN_NOT_OWNER', 'Only the DM or the original uploader can rename this asset');
  }

  const result = await pool.query<AssetRow>(
    `UPDATE campaign_assets SET title = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [title, assetId],
  );
  return result.rows[0]!;
}

export async function deleteAsset(pool: Pool, actorId: string, assetId: string): Promise<void> {
  const asset = await fetchAssetOrThrow(pool, assetId);
  const role = await requireMembership(pool, asset.campaign_id, actorId);
  // DM of the owning campaign, OR the original uploader, may delete.
  if (role !== 'dm' && asset.uploaded_by_user_id !== actorId) {
    throw new AppError('FORBIDDEN_NOT_OWNER', 'Only the DM or the original uploader can delete this asset');
  }

  await pool.query(`DELETE FROM campaign_assets WHERE id = $1`, [assetId]);
  // characters.portrait_asset_id is ON DELETE SET NULL, so no extra cleanup
  // needed there once the row above is gone.

  // Best-effort disk cleanup: a dangling file is not worth failing the whole
  // delete for (deliberate simplicity tradeoff, not an oversight) — the DB
  // row is the source of truth and is already gone either way.
  const relativePath = asset.file_url.replace(/^\/uploads\//, '');
  const absolutePath = path.join(UPLOAD_ROOT, ...relativePath.split('/'));
  fs.unlink(absolutePath, (err) => {
    if (err) {
      console.warn(`[assets] Failed to unlink ${absolutePath} for deleted asset ${assetId}:`, err.message);
    }
  });
}
